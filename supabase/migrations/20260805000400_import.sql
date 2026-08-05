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
