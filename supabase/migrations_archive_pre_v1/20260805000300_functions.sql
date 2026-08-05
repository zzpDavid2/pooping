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
