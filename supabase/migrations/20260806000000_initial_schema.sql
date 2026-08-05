
-- ================================================================
-- Source migration: supabase/migrations/20260805000100_init_schema.sql
-- ================================================================

-- 厕评 pooping — 初始表结构
-- 坐标一律存 WGS-84 (SRID 4326)，GCJ-02 偏移只在渲染层做（src/map/coords.ts）

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- toilets

create table if not exists toilets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_en       text,                            -- OSM name:en，双语展示用
  location      geography(Point, 4326) not null,
  address       text,
  address_en    text,
  building      text,
  floor         text,
  gender        text check (gender in ('male','female','unisex','both')),
  category      text check (category in ('public','mall','campus','restaurant','transit','office','park','other')),

  -- 实用信息，全部可筛选
  has_paper     boolean,
  has_soap      boolean,
  has_dryer     boolean,
  has_hook      boolean,
  accessible    boolean,
  baby_changing boolean,
  seat_type     text check (seat_type in ('squat','seated','both')),
  stall_count   int,
  is_free       boolean,
  needs_code    boolean,
  open_24h      boolean,

  -- 聚合字段，由 reviews 上的触发器维护，避免每次读都算
  review_count  int not null default 0,
  avg_clean     numeric(2,1),
  avg_queue     numeric(2,1),
  avg_smell     numeric(2,1),

  source        text check (source in ('osm','refuge','seed','ugc')) default 'osm',
  osm_id        bigint unique,
  status        text check (status in ('published','pending','rejected')) default 'published',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists toilets_location_idx on toilets using gist (location);
create index if not exists toilets_status_idx on toilets (status);

-- ---------------------------------------------------------------- reviews

create table if not exists reviews (
  id            uuid primary key default gen_random_uuid(),
  toilet_id     uuid not null references toilets(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 实用维度：用户只勾选，不打字
  clean         smallint check (clean between 1 and 5),
  smell         smallint check (smell between 1 and 5),
  queue         smallint check (queue between 1 and 5),
  privacy       smallint check (privacy between 1 and 5),

  -- 存稳定的 tag key（如 'no_paper'），不存展示文案 —— 双语渲染要求，见 src/constants/tags.ts
  quick_tags    text[] not null default '{}',

  raw_note      text,
  ai_text       text not null,
  ai_style      text not null check (ai_style in
                  ('wenyan','xiaohongshu','waimai','eulogy','luxun','documentary','michelin','rap')),
  lang          text not null default 'zh' check (lang in ('zh','en')),
  edited_by_user boolean not null default false,
  is_seed       boolean not null default false,

  nickname      text,
  created_at    timestamptz not null default now()
);

create index if not exists reviews_toilet_idx on reviews (toilet_id, created_at desc);
create index if not exists reviews_user_recent_idx on reviews (user_id, created_at desc);

-- ---------------------------------------------------------------- reports
-- V1 只收集，不做处理流程（CLAUDE.md 第 9 节）

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  review_id   uuid not null references reviews(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  reason      text not null check (reason in ('offensive','false_info','spam','privacy','other')),
  note        text,
  created_at  timestamptz not null default now(),
  unique (review_id, user_id)
);

create index if not exists reports_review_idx on reports (review_id);

-- ---------------------------------------------------------------- updated_at

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists toilets_touch_updated_at on toilets;
create trigger toilets_touch_updated_at
  before update on toilets
  for each row execute function touch_updated_at();

-- ================================================================
-- Source migration: supabase/migrations/20260805000200_rls.sql
-- ================================================================

-- RLS：所有人可读，登录用户（含匿名）只能写自己的东西

alter table toilets enable row level security;
alter table reviews enable row level security;
alter table reports enable row level security;

-- toilets：只读已发布的。V1 没有 CMS，点位由 import 脚本用 service_role 写入
drop policy if exists "toilets readable" on toilets;
create policy "toilets readable" on toilets
  for select using (status = 'published');

-- reviews：所有人可读
drop policy if exists "reviews readable" on reviews;
create policy "reviews readable" on reviews
  for select using (true);

drop policy if exists "insert own review" on reviews;
create policy "insert own review" on reviews
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own review" on reviews;
create policy "update own review" on reviews
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own review" on reviews;
create policy "delete own review" on reviews
  for delete to authenticated
  using (auth.uid() = user_id);

-- reports：只能写，不能读别人的举报（举报内容对普通用户不可见）
drop policy if exists "insert own report" on reports;
create policy "insert own report" on reports
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "read own report" on reports;
create policy "read own report" on reports
  for select to authenticated
  using (auth.uid() = user_id);

-- ================================================================
-- Source migration: supabase/migrations/20260805000300_functions.sql
-- ================================================================

-- 附近查询 RPC + 聚合维护 + 频率限制

-- ---------------------------------------------------------------- nearby_toilets
-- geography 列走 PostgREST 序列化不友好，统一在 RPC 里拆成 lat/lng 返回。
-- 返回的坐标永远是 WGS-84，前端按地区自行转 GCJ-02。

create or replace function nearby_toilets(
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
  id            uuid,
  name          text,
  name_en       text,
  lat           double precision,
  lng           double precision,
  distance_m    double precision,
  address       text,
  address_en    text,
  building      text,
  floor         text,
  gender        text,
  category      text,
  has_paper     boolean,
  has_soap      boolean,
  has_dryer     boolean,
  has_hook      boolean,
  accessible    boolean,
  baby_changing boolean,
  seat_type     text,
  stall_count   integer,
  is_free       boolean,
  needs_code    boolean,
  open_24h      boolean,
  review_count  integer,
  avg_clean     numeric,
  avg_queue     numeric,
  avg_smell     numeric,
  source        text
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
    t.id,
    t.name,
    t.name_en,
    st_y(t.location::geometry) as lat,
    st_x(t.location::geometry) as lng,
    st_distance(t.location, o.g) as distance_m,
    t.address, t.address_en, t.building, t.floor, t.gender, t.category,
    t.has_paper, t.has_soap, t.has_dryer, t.has_hook,
    t.accessible, t.baby_changing, t.seat_type, t.stall_count,
    t.is_free, t.needs_code, t.open_24h,
    t.review_count, t.avg_clean, t.avg_queue, t.avg_smell,
    t.source
  from toilets t, origin o
  where t.status = 'published'
    and st_dwithin(t.location, o.g, greatest(p_radius, 1))
    and (p_has_paper  is not true or t.has_paper  is true)
    and (p_is_free    is not true or t.is_free    is true)
    and (p_accessible is not true or t.accessible is true)
    and (p_seated     is not true or t.seat_type in ('seated','both'))
  order by st_distance(t.location, o.g)
  limit greatest(least(p_limit, 300), 1);
$$;

-- 单点查询，同样把坐标拆开返回
create or replace function toilet_by_id(p_id uuid)
returns table (
  id            uuid,
  name          text,
  name_en       text,
  lat           double precision,
  lng           double precision,
  address       text,
  address_en    text,
  building      text,
  floor         text,
  gender        text,
  category      text,
  has_paper     boolean,
  has_soap      boolean,
  has_dryer     boolean,
  has_hook      boolean,
  accessible    boolean,
  baby_changing boolean,
  seat_type     text,
  stall_count   integer,
  is_free       boolean,
  needs_code    boolean,
  open_24h      boolean,
  review_count  integer,
  avg_clean     numeric,
  avg_queue     numeric,
  avg_smell     numeric,
  source        text
)
language sql
stable
set search_path = public, extensions
as $$
  select
    t.id, t.name, t.name_en,
    st_y(t.location::geometry), st_x(t.location::geometry),
    t.address, t.address_en, t.building, t.floor, t.gender, t.category,
    t.has_paper, t.has_soap, t.has_dryer, t.has_hook,
    t.accessible, t.baby_changing, t.seat_type, t.stall_count,
    t.is_free, t.needs_code, t.open_24h,
    t.review_count, t.avg_clean, t.avg_queue, t.avg_smell,
    t.source
  from toilets t
  where t.id = p_id and t.status = 'published';
$$;

-- ---------------------------------------------------------------- 聚合维护
-- review_count / avg_* 由触发器维护，读取时零计算（CLAUDE.md 第 4 节）

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
    avg_smell    = s.m
  from (
    select
      count(*)                          as n,
      round(avg(clean)::numeric, 1)     as c,
      round(avg(queue)::numeric, 1)     as q,
      round(avg(smell)::numeric, 1)     as m
    from reviews where toilet_id = p_toilet_id
  ) s
  where t.id = p_toilet_id;
$$;

create or replace function reviews_touch_aggregates() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform refresh_toilet_aggregates(old.toilet_id);
    return old;
  end if;

  perform refresh_toilet_aggregates(new.toilet_id);
  -- 评价改挂到别的厕所（理论上不该发生）时，老的那个也要重算
  if tg_op = 'UPDATE' and old.toilet_id is distinct from new.toilet_id then
    perform refresh_toilet_aggregates(old.toilet_id);
  end if;
  return new;
end;
$$;

drop trigger if exists reviews_aggregates on reviews;
create trigger reviews_aggregates
  after insert or update or delete on reviews
  for each row execute function reviews_touch_aggregates();

-- ---------------------------------------------------------------- 频率限制
-- Edge Function 里也挡一道，但那层只管生成成本。
-- 真正的执行点在这里：RLS 允许客户端直接 insert，绕过 Edge Function 也照样受限。

create or replace function enforce_review_rate_limit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  -- seed 脚本走 service_role，不受限
  if new.is_seed then
    return new;
  end if;

  select count(*) into recent
  from reviews
  where user_id = new.user_id
    and created_at > now() - interval '1 minute';

  if recent >= 3 then
    raise exception 'rate_limited: 每分钟最多发 3 条评价 / at most 3 reviews per minute'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists reviews_rate_limit on reviews;
create trigger reviews_rate_limit
  before insert on reviews
  for each row execute function enforce_review_rate_limit();

-- ---------------------------------------------------------------- 授权

grant execute on function nearby_toilets(
  double precision, double precision, integer, integer,
  boolean, boolean, boolean, boolean
) to anon, authenticated;

grant execute on function toilet_by_id(uuid) to anon, authenticated;

-- ================================================================
-- Source migration: supabase/migrations/20260805000400_import.sql
-- ================================================================

-- OSM 导入用的幂等 upsert。
-- 只给 service_role 用（scripts/import-osm.ts），前端拿不到也不该拿到。
--
-- 走 RPC 而不是直接 insert：geography 列要 ST_MakePoint 构造，
-- 让脚本传 WKT 字符串过来太容易写错，且一错就是错在坐标上。

create or replace function upsert_osm_toilet(
  p_osm_id        bigint,
  p_name          text,
  p_name_en       text,
  p_lat           double precision,
  p_lng           double precision,
  p_address       text default null,
  p_gender        text default null,
  p_category      text default null,
  p_has_paper     boolean default null,
  p_has_soap      boolean default null,
  p_has_dryer     boolean default null,
  p_accessible    boolean default null,
  p_baby_changing boolean default null,
  p_seat_type     text default null,
  p_is_free       boolean default null,
  p_needs_code    boolean default null,
  p_open_24h      boolean default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  insert into toilets (
    osm_id, name, name_en, location, address, gender, category,
    has_paper, has_soap, has_dryer, accessible, baby_changing,
    seat_type, is_free, needs_code, open_24h, source, status
  ) values (
    p_osm_id, p_name, p_name_en,
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    p_address, p_gender, p_category,
    p_has_paper, p_has_soap, p_has_dryer, p_accessible, p_baby_changing,
    p_seat_type, p_is_free, p_needs_code, p_open_24h, 'osm', 'published'
  )
  on conflict (osm_id) do update set
    name          = excluded.name,
    name_en       = excluded.name_en,
    location      = excluded.location,
    address       = excluded.address,
    gender        = excluded.gender,
    category      = excluded.category,
    -- OSM 侧是 null 表示"没标注"，不要用它覆盖掉已有的值
    has_paper     = coalesce(excluded.has_paper, toilets.has_paper),
    has_soap      = coalesce(excluded.has_soap, toilets.has_soap),
    has_dryer     = coalesce(excluded.has_dryer, toilets.has_dryer),
    accessible    = coalesce(excluded.accessible, toilets.accessible),
    baby_changing = coalesce(excluded.baby_changing, toilets.baby_changing),
    seat_type     = coalesce(excluded.seat_type, toilets.seat_type),
    is_free       = coalesce(excluded.is_free, toilets.is_free),
    needs_code    = coalesce(excluded.needs_code, toilets.needs_code),
    open_24h      = coalesce(excluded.open_24h, toilets.open_24h),
    updated_at    = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function upsert_osm_toilet(
  bigint, text, text, double precision, double precision, text, text, text,
  boolean, boolean, boolean, boolean, boolean, text, boolean, boolean, boolean
) from public, anon, authenticated;

-- ================================================================
-- Source migration: supabase/migrations/20260805000500_ugc_toilets.sql
-- ================================================================

-- 用户自己报新厕所（UGC）。
--
-- OSM 覆盖不到的地方很多 —— 实测北京南三环一带 1.5km 内只有 1 个点。
-- 商场三楼、写字楼、店里的厕所 OSM 基本不收，只能靠用户补。

alter table toilets
  add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists toilets_created_by_idx on toilets (created_by);

-- ---------------------------------------------------------------- RLS
-- 登录用户（含匿名）可以新增，但只能挂在自己名下，且只能建 source='ugc' 的点。
-- 不允许他们伪造成 osm 来源 —— 来源标记是数据可信度的依据。

drop policy if exists "insert own toilet" on toilets;
create policy "insert own toilet" on toilets for insert
  with check (
    auth.uid() = created_by
    and source = 'ugc'
    and status = 'published'
  );

-- 只能改自己报的点，且不能把它改成别的来源
drop policy if exists "update own toilet" on toilets;
create policy "update own toilet" on toilets for update
  using (auth.uid() = created_by and source = 'ugc')
  with check (auth.uid() = created_by and source = 'ugc');

-- ---------------------------------------------------------------- 频率限制
-- 和评价一样，真正的执行点放在数据库：RLS 允许客户端直接 insert，
-- 只在前端拦是拦不住的。

create or replace function enforce_toilet_rate_limit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent int;
begin
  -- 导入脚本走 service_role，created_by 为空，不受限
  if new.created_by is null or new.source <> 'ugc' then
    return new;
  end if;

  select count(*) into recent
  from toilets
  where created_by = new.created_by
    and created_at > now() - interval '1 hour';

  if recent >= 5 then
    raise exception 'rate_limited: 每小时最多报 5 个新厕所 / at most 5 new toilets per hour'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists toilets_rate_limit on toilets;
create trigger toilets_rate_limit
  before insert on toilets
  for each row execute function enforce_toilet_rate_limit();

-- ---------------------------------------------------------------- 新增 RPC
-- 走 RPC 而不是让前端直接 insert：geography 列要 ST_MakePoint 构造，
-- 让前端拼 WKT 字符串太容易在坐标上出错，而坐标错了这条数据就是废的。
--
-- 注意这里是 SECURITY INVOKER（默认）：RLS 照常生效，
-- 用户仍然只能以自己的身份建点。

create or replace function create_ugc_toilet(
  p_name     text,
  p_name_en  text,
  p_lat      double precision,
  p_lng      double precision,
  p_address  text default null,
  p_category text default 'public'
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_id   uuid;
  v_name text := nullif(btrim(p_name), '');
begin
  if v_name is null then
    raise exception 'invalid_input: 名字不能为空 / name is required';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_input: 坐标无效 / invalid coordinates';
  end if;

  insert into toilets (
    name, name_en, location, address, category,
    source, status, created_by
  ) values (
    left(v_name, 80),
    nullif(btrim(coalesce(p_name_en, '')), ''),
    st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
    nullif(btrim(coalesce(p_address, '')), ''),
    coalesce(nullif(btrim(p_category), ''), 'public'),
    'ugc',
    'published',
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function create_ugc_toilet(
  text, text, double precision, double precision, text, text
) to authenticated;

-- ================================================================
-- Source migration: supabase/migrations/20260806000100_rating_and_names.sql
-- ================================================================

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

-- ================================================================
-- Source migration: supabase/migrations/20260806000200_human_reviews.sql
-- ================================================================

-- 允许用户不经 AI，直接自己写评价。
--
-- 结果是 reviews 里现在有两种来源，必须能分辨：
-- CLAUDE.md 10.2 要求「AI 内容必须标注」，反过来说，
-- **不是 AI 写的就绝不能挂 AI 标**，否则那个标识就没意义了。

alter table reviews
  add column if not exists is_ai boolean not null default true;

-- 自己写的没有文风可言，ai_style 不再强制
alter table reviews alter column ai_style drop not null;

comment on column reviews.ai_text is
  '展示用正文。AI 生成或用户手写，看 is_ai。列名沿用历史，不代表一定是 AI 写的。';
comment on column reviews.is_ai is
  'true = LLM 生成（走 generate-review 的内容约束）；false = 用户手写（只受举报和频率限制约束）。';
comment on column reviews.ai_style is
  '文风。仅 is_ai = true 时有意义，手写评价为 null。';

-- 一致性：手写的不该有文风，AI 写的必须有
alter table reviews drop constraint if exists reviews_style_matches_source;
alter table reviews add constraint reviews_style_matches_source
  check (
    (is_ai = true and ai_style is not null)
    or (is_ai = false and ai_style is null)
  );

-- ================================================================
-- Source migration: supabase/migrations/20260806000300_funny_votes.sql
-- ================================================================

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

-- ================================================================
-- Source migration: supabase/migrations/20260806000400_top_toilets.sql
-- ================================================================

-- 搞笑首页的厕所榜不受当前地图视野限制。
-- 地图列表仍然用 nearby_toilets；这里读全站 published 厕所，按搞笑分和评分排序。

create or replace function top_toilets(p_limit integer default 30)
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
  where t.status = 'published'
  order by
    t.funny_score desc,
    (
      coalesce(t.avg_clean, 0)
      + coalesce(t.avg_queue, 0)
      + coalesce(t.avg_smell, 0)
      + coalesce(t.avg_privacy, 0)
    ) desc,
    t.review_count desc,
    t.created_at desc
  limit greatest(least(p_limit, 100), 1);
$$;

grant execute on function top_toilets(integer) to anon, authenticated;

-- ================================================================
-- Source migration: supabase/migrations/20260806000500_top_toilets_pagination.sql
-- ================================================================

-- top_toilets 支持分页。搞笑首页继续加载时不能重新从榜首开始。

drop function if exists top_toilets(integer);

create function top_toilets(p_limit integer default 30, p_offset integer default 0)
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
  where t.status = 'published'
  order by
    t.funny_score desc,
    (
      coalesce(t.avg_clean, 0)
      + coalesce(t.avg_queue, 0)
      + coalesce(t.avg_smell, 0)
      + coalesce(t.avg_privacy, 0)
    ) desc,
    t.review_count desc,
    t.created_at desc
  limit greatest(least(p_limit, 100), 1)
  offset greatest(p_offset, 0);
$$;

grant execute on function top_toilets(integer, integer) to anon, authenticated;

-- ================================================================
-- Source migration: supabase/migrations/20260806000600_original_name_votes.sql
-- ================================================================

-- Make each toilet's imported/original name a normal voteable proposal.
-- Users can then vote the original name back up instead of only voting new nicknames.

insert into toilet_name_proposals (toilet_id, name, created_by, created_at)
select
  t.id,
  btrim(t.name),
  null,
  coalesce(t.created_at, now())
from toilets t
where btrim(coalesce(t.name, '')) <> ''
on conflict (toilet_id, name) do nothing;

create or replace function ensure_original_toilet_name_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if btrim(coalesce(new.name, '')) <> '' then
    insert into toilet_name_proposals (toilet_id, name, created_by, created_at)
    values (new.id, btrim(new.name), null, coalesce(new.created_at, now()))
    on conflict (toilet_id, name) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists toilets_original_name_proposal on toilets;
create trigger toilets_original_name_proposal
  after insert on toilets
  for each row execute function ensure_original_toilet_name_proposal();

select refresh_voted_name(id)
from toilets;
