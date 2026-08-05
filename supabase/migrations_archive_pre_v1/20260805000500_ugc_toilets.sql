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
