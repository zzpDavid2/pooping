-- 点位修正：把标错的厕所挪到对的地方。
--
-- 两种人能挪：
--   1. 普通用户 —— 只能挪自己报的那个点（source='ugc' 且 created_by = 自己）
--   2. 管理员   —— 谁的点都能挪，包括 OSM 导进来的
--
-- 为什么不靠 RLS 的 "update own toilet" 策略直接 update：那条策略放行的是整行，
-- 用户能顺手把名字、设施、来源一起改掉。这里收成一个只碰 location 的 RPC，
-- 顺便把"挪了多远""谁挪的"记下来 —— 位置是这个产品最容易被搞坏的字段。

-- ================================================================ 管理员名单
create table if not exists app_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table app_admins enable row level security;
-- 故意一条 policy 都不写 = anon/authenticated 既读不到也写不了。
-- 管理员名单不该在客户端可见，只有 service_role / Studio 能管。

create or replace function is_admin() returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from app_admins a where a.user_id = auth.uid());
$$;

-- 前端要用它决定"要不要显示管理员那一块"，所以放行给登录用户。
-- 它只回自己是不是管理员，泄露不了名单。
-- anon 也要给：详情页 toilet_by_id 内部会调它，而没登录的访客用的是 anon 角色，
-- 不给的话整个详情页会因为"函数无权限"直接报错。它对 anon 恒返回 false。
grant execute on function is_admin() to anon, authenticated;

-- 给自己开管理员用。在 Supabase Studio 的 SQL Editor 里跑一句：
--   select grant_admin_by_email('你的邮箱@example.com');
-- 注意：必须是**已经用邮箱登录过**的账号，匿名账号没有 email。
create or replace function grant_admin_by_email(p_email text) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email));

  if v_id is null then
    raise exception 'no_such_user: 没找到这个邮箱的用户 / no user with that email';
  end if;

  insert into app_admins (user_id, note) values (v_id, p_email)
  on conflict (user_id) do nothing;

  return v_id;
end;
$$;

-- 只给 Studio / service_role 用，前端永远不该调它
revoke execute on function grant_admin_by_email(text) from public, anon, authenticated;

-- ================================================================ 修改流水
-- 位置被谁挪过、从哪挪到哪、挪了多远。出了争议能翻账，也能发现有人乱挪。
create table if not exists toilet_location_edits (
  id         uuid primary key default gen_random_uuid(),
  toilet_id  uuid not null references toilets(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  from_lat   double precision,
  from_lng   double precision,
  to_lat     double precision not null,
  to_lng     double precision not null,
  moved_m    double precision,
  as_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists toilet_location_edits_toilet_idx
  on toilet_location_edits (toilet_id);
create index if not exists toilet_location_edits_user_idx
  on toilet_location_edits (user_id, created_at desc);

alter table toilet_location_edits enable row level security;
-- 同样不写 policy：审计记录只给 Studio 看

-- ================================================================ 挪点位
create or replace function fix_toilet_location(
  p_toilet_id uuid,
  p_lat       double precision,
  p_lng       double precision
)
returns table (
  lat     double precision,
  lng     double precision,
  moved_m double precision
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid    uuid := auth.uid();
  v_admin  boolean;
  v_old    geography;
  v_owner  uuid;
  v_source text;
  v_new    geography;
  v_moved  double precision;
  v_recent int;
begin
  if v_uid is null then
    raise exception 'not_signed_in: 需要先登录 / sign in first';
  end if;

  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'invalid_input: 坐标无效 / invalid coordinates';
  end if;

  select t.location, t.created_by, t.source
    into v_old, v_owner, v_source
  from toilets t
  where t.id = p_toilet_id and t.status = 'published';

  if not found then
    raise exception 'not_found: 找不到这个厕所 / toilet not found';
  end if;

  v_admin := is_admin();

  if not v_admin and (v_owner is distinct from v_uid or v_source <> 'ugc') then
    raise exception 'forbidden: 只能修正自己报的点位 / you can only fix toilets you added';
  end if;

  v_new   := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;
  v_moved := st_distance(v_old, v_new);

  -- 普通用户只能小范围纠偏。挪出 3 公里的多半不是"修正"，是把点搬去别的地方，
  -- 那属于新报一个厕所，不该走这个口子。管理员不受限（要处理跨城的错点）。
  if not v_admin and v_moved > 3000 then
    raise exception 'too_far: 一次最多挪 3 公里 / can only move up to 3km';
  end if;

  -- 频率限制跟评价、报点一样放在数据库里，前端拦不住绕过去的人
  if not v_admin then
    select count(*) into v_recent
    from toilet_location_edits
    where user_id = v_uid and created_at > now() - interval '1 hour';

    if v_recent >= 20 then
      raise exception 'rate_limited: 改得太频繁，歇一会儿 / too many edits, try again later'
        using errcode = '54000';
    end if;
  end if;

  update toilets t
  set location = v_new, updated_at = now()
  where t.id = p_toilet_id;

  insert into toilet_location_edits (
    toilet_id, user_id, from_lat, from_lng, to_lat, to_lng, moved_m, as_admin
  ) values (
    p_toilet_id, v_uid,
    st_y(v_old::geometry), st_x(v_old::geometry),
    p_lat, p_lng, v_moved, v_admin
  );

  return query select p_lat, p_lng, v_moved;
end;
$$;

grant execute on function fix_toilet_location(uuid, double precision, double precision)
  to authenticated;

-- ================================================================ 上报可以"处理掉"
-- 之前上报只进不出，管理员改完了那条上报还挂在列表上。加两个字段标记已处理。
alter table toilet_reports add column if not exists resolved_at timestamptz;
alter table toilet_reports add column if not exists resolved_by uuid
  references auth.users(id) on delete set null;

create index if not exists toilet_reports_open_idx
  on toilet_reports (created_at desc) where resolved_at is null;

-- 原来的 unique(toilet_id, user_id) 会导致"处理完之后同一个人再也报不了这个点"。
-- 换成部分唯一索引：只约束还没处理的那些，处理完就允许再报。
alter table toilet_reports drop constraint if exists toilet_reports_toilet_id_user_id_key;
create unique index if not exists toilet_reports_open_unique
  on toilet_reports (toilet_id, user_id) where resolved_at is null;

-- Studio 里看的那张视图跟着只看未处理的，并带上坐标方便核对
drop view if exists flagged_toilets;
create view flagged_toilets as
select
  t.id as toilet_id,
  t.name as toilet_name,
  t.address,
  t.source,
  st_y(t.location::geometry) as lat,
  st_x(t.location::geometry) as lng,
  t.review_count,
  count(tr.id) as report_count,
  array_agg(distinct tr.reason) filter (where tr.reason is not null) as reasons,
  array_agg(tr.note) filter (where tr.note is not null) as notes,
  max(tr.created_at) as last_reported_at
from toilet_reports tr
join toilets t on t.id = tr.toilet_id
where tr.resolved_at is null
group by t.id
order by max(tr.created_at) desc;

revoke all on flagged_toilets from public, anon, authenticated;

-- ================================================================ 管理端 RPC
-- 视图对 authenticated 是禁读的（上面 revoke 过），所以网页里的管理端走这两个
-- security definer 函数，函数第一件事就是查 is_admin()。
create or replace function admin_flagged_toilets()
returns table (
  toilet_id        uuid,
  toilet_name      text,
  address          text,
  source           text,
  lat              double precision,
  lng              double precision,
  review_count     integer,
  report_count     bigint,
  reasons          text[],
  notes            text[],
  last_reported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'forbidden: 只有管理员能看 / admins only';
  end if;

  return query
  select
    t.id,
    t.name,
    t.address,
    t.source,
    st_y(t.location::geometry),
    st_x(t.location::geometry),
    t.review_count,
    count(tr.id),
    array_agg(distinct tr.reason) filter (where tr.reason is not null),
    array_agg(tr.note) filter (where tr.note is not null),
    max(tr.created_at)
  from toilet_reports tr
  join toilets t on t.id = tr.toilet_id
  where tr.resolved_at is null
  group by t.id
  order by max(tr.created_at) desc
  limit 200;
end;
$$;

grant execute on function admin_flagged_toilets() to authenticated;

create or replace function admin_resolve_toilet_reports(p_toilet_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
begin
  if not is_admin() then
    raise exception 'forbidden: 只有管理员能操作 / admins only';
  end if;

  update toilet_reports
  set resolved_at = now(), resolved_by = auth.uid()
  where toilet_id = p_toilet_id and resolved_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

grant execute on function admin_resolve_toilet_reports(uuid) to authenticated;

-- ================================================================ 详情页要知道"我能不能改这个点"
-- 前端拿不到 created_by（toilet_by_id 不返回它，也不该返回——那是别人的用户 id），
-- 所以直接由数据库算好一个布尔值给它。
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
  funny_up integer, funny_down integer, funny_score integer, funny_vote smallint,
  can_fix_location boolean
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
    coalesce(v.value, 0)::smallint,
    -- created_by 为空时 `= auth.uid()` 会算出 null，coalesce 兜成 false；
    -- 未登录时 auth.uid() 也是 null，这里显式挡掉，别让"两个 null"变成"是本人"
    coalesce(
      is_admin()
      or (auth.uid() is not null and t.created_by = auth.uid() and t.source = 'ugc'),
      false
    )
  from toilets t
  left join toilet_funny_votes v
    on v.toilet_id = t.id and v.user_id = auth.uid()
  where t.id = p_id and t.status = 'published';
$$;

grant execute on function toilet_by_id(uuid) to anon, authenticated;
