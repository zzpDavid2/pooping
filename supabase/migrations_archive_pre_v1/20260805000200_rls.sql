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
