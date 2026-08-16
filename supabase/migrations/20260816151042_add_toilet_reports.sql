-- 上报"这个厕所点位有问题"（不存在了/店家关了），跟举报评价内容是两回事，
-- 单独一张表——理由枚举不一样，reason 还允许为空（用户可以什么都不填，
-- 就是想说"这里不对劲"）。

create table if not exists toilet_reports (
  id          uuid primary key default gen_random_uuid(),
  toilet_id   uuid not null references toilets(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,
  reason      text check (reason in ('not_exist', 'closed', 'other')),
  note        text,
  created_at  timestamptz not null default now(),
  unique (toilet_id, user_id)
);

create index if not exists toilet_reports_toilet_idx on toilet_reports (toilet_id);

alter table toilet_reports enable row level security;

-- 同一用户对同一个点位只能报一次，跟评价举报的策略一致（CLAUDE.md 第 9 节：先只收集）
drop policy if exists "insert own toilet report" on toilet_reports;
create policy "insert own toilet report" on toilet_reports
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "read own toilet report" on toilet_reports;
create policy "read own toilet report" on toilet_reports
  for select to authenticated
  using (auth.uid() = user_id);

-- 审核视图，思路跟 flagged_reviews 一样（见 add_flagged_reviews_view migration）：
-- 没有管理后台，人工在 Supabase Studio 的 Table Editor 里看这张视图、决定删不删。
-- 同样要撤掉 anon/authenticated 的读权限，不然会通过 REST API 把举报数据暴露出去。
create or replace view flagged_toilets as
select
  t.id as toilet_id,
  t.name as toilet_name,
  t.address,
  t.source,
  t.review_count,
  count(tr.id) as report_count,
  array_agg(distinct tr.reason) filter (where tr.reason is not null) as reasons,
  array_agg(tr.note) filter (where tr.note is not null) as notes,
  max(tr.created_at) as last_reported_at
from toilet_reports tr
join toilets t on t.id = tr.toilet_id
group by t.id, t.name, t.address, t.source, t.review_count
order by max(tr.created_at) desc;

revoke all on flagged_toilets from public, anon, authenticated;
