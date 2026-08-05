-- 评论和厕所详情的搞笑程度赞踩。
-- 一人一票，缓存 up/down/score 到主表，列表排序不用每次 count。

alter table reviews
  add column if not exists funny_up integer not null default 0,
  add column if not exists funny_down integer not null default 0,
  add column if not exists funny_score integer not null default 0;

alter table toilets
  add column if not exists funny_up integer not null default 0,
  add column if not exists funny_down integer not null default 0,
  add column if not exists funny_score integer not null default 0;

create table if not exists review_funny_votes (
  review_id uuid not null references reviews(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  value     smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (review_id, user_id)
);

create table if not exists toilet_funny_votes (
  toilet_id uuid not null references toilets(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  value     smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (toilet_id, user_id)
);

create index if not exists review_funny_votes_review_idx on review_funny_votes (review_id);
create index if not exists toilet_funny_votes_toilet_idx on toilet_funny_votes (toilet_id);
create index if not exists reviews_funny_score_idx on reviews (funny_score desc, created_at desc);
create index if not exists toilets_funny_score_idx on toilets (funny_score desc, review_count desc);

alter table review_funny_votes enable row level security;
alter table toilet_funny_votes enable row level security;

drop policy if exists "review funny votes readable" on review_funny_votes;
create policy "review funny votes readable" on review_funny_votes for select using (true);

drop policy if exists "insert own review funny vote" on review_funny_votes;
create policy "insert own review funny vote" on review_funny_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own review funny vote" on review_funny_votes;
create policy "update own review funny vote" on review_funny_votes for update
  using (auth.uid() = user_id);

drop policy if exists "toilet funny votes readable" on toilet_funny_votes;
create policy "toilet funny votes readable" on toilet_funny_votes for select using (true);

drop policy if exists "insert own toilet funny vote" on toilet_funny_votes;
create policy "insert own toilet funny vote" on toilet_funny_votes for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own toilet funny vote" on toilet_funny_votes;
create policy "update own toilet funny vote" on toilet_funny_votes for update
  using (auth.uid() = user_id);

create or replace function refresh_review_funny(p_review_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update reviews r set
    funny_up = s.up,
    funny_down = s.down,
    funny_score = s.up - s.down
  from (
    select
      count(*) filter (where value = 1)::integer as up,
      count(*) filter (where value = -1)::integer as down
    from review_funny_votes
    where review_id = p_review_id
  ) s
  where r.id = p_review_id;
$$;

create or replace function refresh_toilet_funny(p_toilet_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update toilets t set
    funny_up = s.up,
    funny_down = s.down,
    funny_score = s.up - s.down
  from (
    select
      count(*) filter (where value = 1)::integer as up,
      count(*) filter (where value = -1)::integer as down
    from toilet_funny_votes
    where toilet_id = p_toilet_id
  ) s
  where t.id = p_toilet_id;
$$;

create or replace function review_funny_votes_touch() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  perform refresh_review_funny(coalesce(new.review_id, old.review_id));
  return coalesce(new, old);
end;
$$;

create or replace function toilet_funny_votes_touch() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  perform refresh_toilet_funny(coalesce(new.toilet_id, old.toilet_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists review_funny_votes_refresh on review_funny_votes;
create trigger review_funny_votes_refresh
  after insert or update or delete on review_funny_votes
  for each row execute function review_funny_votes_touch();

drop trigger if exists toilet_funny_votes_refresh on toilet_funny_votes;
create trigger toilet_funny_votes_refresh
  after insert or update or delete on toilet_funny_votes
  for each row execute function toilet_funny_votes_touch();

create or replace function vote_review_funny(p_review_id uuid, p_value smallint)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthorized: 需要登录 / sign-in required';
  end if;
  if p_value not in (-1, 1) then
    raise exception 'invalid_input: vote must be -1 or 1';
  end if;

  insert into review_funny_votes (review_id, user_id, value)
  values (p_review_id, v_user, p_value)
  on conflict (review_id, user_id)
  do update set value = excluded.value;
end;
$$;

create or replace function vote_toilet_funny(p_toilet_id uuid, p_value smallint)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthorized: 需要登录 / sign-in required';
  end if;
  if p_value not in (-1, 1) then
    raise exception 'invalid_input: vote must be -1 or 1';
  end if;

  insert into toilet_funny_votes (toilet_id, user_id, value)
  values (p_toilet_id, v_user, p_value)
  on conflict (toilet_id, user_id)
  do update set value = excluded.value;
end;
$$;

create or replace function toilet_reviews(p_toilet_id uuid, p_limit integer default 50)
returns table (
  id uuid, toilet_id uuid, user_id uuid,
  clean smallint, smell smallint, queue smallint, privacy smallint,
  quick_tags text[], raw_note text, ai_text text, ai_style text, is_ai boolean,
  lang text, edited_by_user boolean, is_seed boolean, nickname text,
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    r.id, r.toilet_id, r.user_id,
    r.clean, r.smell, r.queue, r.privacy,
    r.quick_tags, r.raw_note, r.ai_text, r.ai_style, r.is_ai,
    r.lang, r.edited_by_user, r.is_seed, r.nickname,
    r.funny_up, r.funny_down, r.funny_score,
    coalesce(v.value, 0)::smallint as funny_vote,
    r.created_at
  from reviews r
  left join review_funny_votes v
    on v.review_id = r.id and v.user_id = auth.uid()
  where r.toilet_id = p_toilet_id
  order by r.funny_score desc, r.created_at desc
  limit greatest(least(p_limit, 100), 1);
$$;

create or replace function review_by_id(p_review_id uuid)
returns table (
  id uuid, toilet_id uuid, user_id uuid,
  clean smallint, smell smallint, queue smallint, privacy smallint,
  quick_tags text[], raw_note text, ai_text text, ai_style text, is_ai boolean,
  lang text, edited_by_user boolean, is_seed boolean, nickname text,
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint,
  created_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    r.id, r.toilet_id, r.user_id,
    r.clean, r.smell, r.queue, r.privacy,
    r.quick_tags, r.raw_note, r.ai_text, r.ai_style, r.is_ai,
    r.lang, r.edited_by_user, r.is_seed, r.nickname,
    r.funny_up, r.funny_down, r.funny_score,
    coalesce(v.value, 0)::smallint as funny_vote,
    r.created_at
  from reviews r
  left join review_funny_votes v
    on v.review_id = r.id and v.user_id = auth.uid()
  where r.id = p_review_id;
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
  source text,
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint
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
    t.source,
    t.funny_up, t.funny_down, t.funny_score,
    coalesce(v.value, 0)::smallint
  from toilets t
  cross join origin o
  left join toilet_funny_votes v
    on v.toilet_id = t.id and v.user_id = auth.uid()
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
  source text,
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint
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
    t.source,
    t.funny_up, t.funny_down, t.funny_score,
    coalesce(v.value, 0)::smallint
  from toilets t
  left join toilet_funny_votes v
    on v.toilet_id = t.id and v.user_id = auth.uid()
  where t.id = p_id and t.status = 'published';
$$;

grant execute on function vote_review_funny(uuid, smallint) to authenticated;
grant execute on function vote_toilet_funny(uuid, smallint) to authenticated;
grant execute on function toilet_reviews(uuid, integer) to anon, authenticated;
grant execute on function review_by_id(uuid) to anon, authenticated;
grant execute on function nearby_toilets(
  double precision, double precision, integer, integer,
  boolean, boolean, boolean, boolean
) to anon, authenticated;
grant execute on function toilet_by_id(uuid) to anon, authenticated;
