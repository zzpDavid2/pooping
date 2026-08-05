-- 1) 私密度也进聚合，凑齐四项才好算总分
-- 2) 厕所改名投票玩法

-- ================================================================ 总分
alter table toilets add column if not exists avg_privacy numeric(2,1);

-- ================================================================ 改名投票
--
-- OSM 上 85% 的厕所叫「公共厕所」，一屏全是重名。
-- 与其等官方数据，不如让用户自己起名投票 —— 这既解决了辨识问题，本身也是个玩法。

create table if not exists toilet_name_proposals (
  id          uuid primary key default gen_random_uuid(),
  toilet_id   uuid not null references toilets(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz default now(),
  -- 同一个厕所不允许重复提同一个名字：想支持它就去投票，不是再提一次
  unique (toilet_id, name)
);

create index if not exists name_proposals_toilet_idx on toilet_name_proposals (toilet_id);

create table if not exists toilet_name_votes (
  proposal_id uuid not null references toilet_name_proposals(id) on delete cascade,
  toilet_id   uuid not null references toilets(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (proposal_id, user_id),
  -- 一个厕所一人只有一票。想改主意就投别的，旧票自动挪走（见 vote_toilet_name）
  unique (toilet_id, user_id)
);

create index if not exists name_votes_proposal_idx on toilet_name_votes (proposal_id);

-- 票选出来的名字缓存回 toilets，读列表时不用每行做子查询
alter table toilets add column if not exists voted_name text;

-- ---------------------------------------------------------------- RLS
alter table toilet_name_proposals enable row level security;
alter table toilet_name_votes enable row level security;

drop policy if exists "name proposals readable" on toilet_name_proposals;
create policy "name proposals readable" on toilet_name_proposals for select using (true);

drop policy if exists "insert own proposal" on toilet_name_proposals;
create policy "insert own proposal" on toilet_name_proposals for insert
  with check (auth.uid() = created_by);

drop policy if exists "name votes readable" on toilet_name_votes;
create policy "name votes readable" on toilet_name_votes for select using (true);

drop policy if exists "insert own vote" on toilet_name_votes;
create policy "insert own vote" on toilet_name_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "delete own vote" on toilet_name_votes;
create policy "delete own vote" on toilet_name_votes for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------- 缓存刷新
create or replace function refresh_voted_name(p_toilet_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update toilets t set voted_name = (
    select p.name
    from toilet_name_proposals p
    left join toilet_name_votes v on v.proposal_id = p.id
    where p.toilet_id = p_toilet_id
    group by p.id, p.name, p.created_at
    -- 票多的赢；票数一样时先提的赢，避免名字来回跳
    order by count(v.proposal_id) desc, p.created_at asc
    limit 1
  )
  where t.id = p_toilet_id;
$$;

create or replace function name_votes_touch() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform refresh_voted_name(coalesce(new.toilet_id, old.toilet_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists name_votes_refresh on toilet_name_votes;
create trigger name_votes_refresh
  after insert or delete on toilet_name_votes
  for each row execute function name_votes_touch();

drop trigger if exists name_proposals_refresh on toilet_name_proposals;
create trigger name_proposals_refresh
  after insert or delete on toilet_name_proposals
  for each row execute function name_votes_touch();

-- ---------------------------------------------------------------- 频率限制
create or replace function enforce_proposal_rate_limit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  if new.created_by is null then
    return new;
  end if;

  select count(*) into recent
  from toilet_name_proposals
  where created_by = new.created_by
    and created_at > now() - interval '1 hour';

  if recent >= 10 then
    raise exception 'rate_limited: 每小时最多提 10 个名字 / at most 10 name proposals per hour'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists name_proposals_rate_limit on toilet_name_proposals;
create trigger name_proposals_rate_limit
  before insert on toilet_name_proposals
  for each row execute function enforce_proposal_rate_limit();

-- ---------------------------------------------------------------- 读写 RPC

/** 某个厕所的所有候选名 + 票数 + 我投没投。 */
create or replace function toilet_names(p_toilet_id uuid)
returns table (
  id         uuid,
  name       text,
  votes      bigint,
  voted_by_me boolean,
  is_winner  boolean
)
language sql
stable
set search_path = public
as $$
  with counted as (
    select
      p.id,
      p.name,
      p.created_at,
      count(v.proposal_id) as votes,
      bool_or(v.user_id = auth.uid()) as voted_by_me
    from toilet_name_proposals p
    left join toilet_name_votes v on v.proposal_id = p.id
    where p.toilet_id = p_toilet_id
    group by p.id, p.name, p.created_at
  )
  select
    c.id, c.name, c.votes, coalesce(c.voted_by_me, false),
    row_number() over (order by c.votes desc, c.created_at asc) = 1 as is_winner
  from counted c
  order by c.votes desc, c.created_at asc;
$$;

/**
 * 投票。一个厕所一人一票 —— 投新的会把旧的挪走。
 * 走 RPC 是因为「先删旧票再插新票」必须在一个事务里，客户端做不到。
 */
create or replace function vote_toilet_name(p_proposal_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_toilet uuid;
  v_user   uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthorized: 需要登录 / sign-in required';
  end if;

  select toilet_id into v_toilet from toilet_name_proposals where id = p_proposal_id;
  if v_toilet is null then
    raise exception 'not_found: 候选名不存在 / proposal not found';
  end if;

  delete from toilet_name_votes where toilet_id = v_toilet and user_id = v_user;
  insert into toilet_name_votes (proposal_id, toilet_id, user_id)
  values (p_proposal_id, v_toilet, v_user);
end;
$$;

create or replace function unvote_toilet_name(p_proposal_id uuid)
returns void
language sql
set search_path = public
as $$
  delete from toilet_name_votes
  where proposal_id = p_proposal_id and user_id = auth.uid();
$$;

/** 提名并自动投自己一票 —— 提了不投是没有意义的。 */
create or replace function propose_toilet_name(p_toilet_id uuid, p_name text)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id   uuid;
  v_name text := btrim(p_name);
begin
  if auth.uid() is null then
    raise exception 'unauthorized: 需要登录 / sign-in required';
  end if;
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'invalid_input: 名字长度 1–40 / name must be 1-40 chars';
  end if;

  -- 已经有人提过同样的名字，就直接投它，不再新建
  select id into v_id
  from toilet_name_proposals
  where toilet_id = p_toilet_id and name = v_name;

  if v_id is null then
    insert into toilet_name_proposals (toilet_id, name, created_by)
    values (p_toilet_id, v_name, auth.uid())
    returning id into v_id;
  end if;

  perform vote_toilet_name(v_id);
  return v_id;
end;
$$;

grant execute on function toilet_names(uuid) to anon, authenticated;
grant execute on function vote_toilet_name(uuid) to authenticated;
grant execute on function unvote_toilet_name(uuid) to authenticated;
grant execute on function propose_toilet_name(uuid, text) to authenticated;

-- ================================================================ 聚合与查询更新
-- avg_privacy 和 voted_name 要跟着一起出到查询结果里。
-- 改返回类型必须先 DROP，Postgres 不允许 CREATE OR REPLACE 改签名。

create or replace function refresh_toilet_aggregates(p_toilet_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update toilets t set
    review_count = coalesce(s.n, 0),
    avg_clean    = s.c,
    avg_queue    = s.q,
    avg_smell    = s.m,
    avg_privacy  = s.p
  from (
    select
      count(*)                        as n,
      round(avg(clean)::numeric, 1)   as c,
      round(avg(queue)::numeric, 1)   as q,
      round(avg(smell)::numeric, 1)   as m,
      round(avg(privacy)::numeric, 1) as p
    from reviews where toilet_id = p_toilet_id
  ) s
  where t.id = p_toilet_id;
$$;

drop function if exists nearby_toilets(
  double precision, double precision, integer, integer,
  boolean, boolean, boolean, boolean
);

create function nearby_toilets(
  p_lat         double precision,
  p_lng         double precision,
  p_radius      integer default 1500,
  p_limit       integer default 100,
  p_has_paper   boolean default null,
  p_is_free     boolean default null,
  p_accessible  boolean default null,
  p_seated      boolean default null
)
returns table (
  id uuid, name text, name_en text, voted_name text,
  lat double precision, lng double precision, distance_m double precision,
  address text, address_en text, building text, floor text,
  gender text, category text,
  has_paper boolean, has_soap boolean, has_dryer boolean, has_hook boolean,
  accessible boolean, baby_changing boolean, seat_type text, stall_count integer,
  is_free boolean, needs_code boolean, open_24h boolean,
  review_count integer,
  avg_clean numeric, avg_queue numeric, avg_smell numeric, avg_privacy numeric,
  source text
)
language sql
stable
parallel safe
set search_path = public, extensions
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select
    t.id, t.name, t.name_en, t.voted_name,
    st_y(t.location::geometry), st_x(t.location::geometry),
    st_distance(t.location, o.g),
    t.address, t.address_en, t.building, t.floor, t.gender, t.category,
    t.has_paper, t.has_soap, t.has_dryer, t.has_hook,
    t.accessible, t.baby_changing, t.seat_type, t.stall_count,
    t.is_free, t.needs_code, t.open_24h,
    t.review_count, t.avg_clean, t.avg_queue, t.avg_smell, t.avg_privacy,
    t.source
  from toilets t, origin o
  where t.status = 'published'
    and st_dwithin(t.location, o.g, greatest(p_radius, 1))
    and (p_has_paper  is not true or t.has_paper  is true)
    and (p_is_free    is not true or t.is_free    is true)
    and (p_accessible is not true or t.accessible is true)
    and (p_seated     is not true or t.seat_type in ('seated','both'))
  order by st_distance(t.location, o.g)
  limit greatest(least(p_limit, 500), 1);
$$;

drop function if exists toilet_by_id(uuid);

create function toilet_by_id(p_id uuid)
returns table (
  id uuid, name text, name_en text, voted_name text,
  lat double precision, lng double precision,
  address text, address_en text, building text, floor text,
  gender text, category text,
  has_paper boolean, has_soap boolean, has_dryer boolean, has_hook boolean,
  accessible boolean, baby_changing boolean, seat_type text, stall_count integer,
  is_free boolean, needs_code boolean, open_24h boolean,
  review_count integer,
  avg_clean numeric, avg_queue numeric, avg_smell numeric, avg_privacy numeric,
  source text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    t.id, t.name, t.name_en, t.voted_name,
    st_y(t.location::geometry), st_x(t.location::geometry),
    t.address, t.address_en, t.building, t.floor, t.gender, t.category,
    t.has_paper, t.has_soap, t.has_dryer, t.has_hook,
    t.accessible, t.baby_changing, t.seat_type, t.stall_count,
    t.is_free, t.needs_code, t.open_24h,
    t.review_count, t.avg_clean, t.avg_queue, t.avg_smell, t.avg_privacy,
    t.source
  from toilets t
  where t.id = p_id and t.status = 'published';
$$;

grant execute on function nearby_toilets(
  double precision, double precision, integer, integer,
  boolean, boolean, boolean, boolean
) to anon, authenticated;
grant execute on function toilet_by_id(uuid) to anon, authenticated;
