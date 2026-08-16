-- 用户自己记的厕所门锁密码。**只对本人可见**。
--
-- 美国不少商家厕所要密码（消费后给小票、或者店员口头告知），用户记不住，
-- 但这是"我自己记的东西"，不是公开信息：
--   1. 公开出去等于帮人白嫖商家，商家改密码，功能反而失效
--   2. 密码常变，公开的旧密码会误导人
-- 所以 RLS 只放行本人，连读带写都锁死在 auth.uid() 上。
--
-- 没有专门的审核视图：这是私密数据，管理员也不该翻。

create table if not exists toilet_pins (
  id          uuid primary key default gen_random_uuid(),
  toilet_id   uuid not null references toilets(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  pin         text not null check (char_length(btrim(pin)) between 1 and 40),
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- 一个人对一个厕所只存一条，改密码是 update 不是新增
  unique (toilet_id, user_id)
);

create index if not exists toilet_pins_user_idx on toilet_pins (user_id);

create trigger toilet_pins_touch_updated_at
  before update on toilet_pins
  for each row execute function touch_updated_at();

alter table toilet_pins enable row level security;

-- 四条策略都锁在本人身上。特别注意 select：没有这一条的话，
-- 任何登录用户都能读到所有人存的密码。
drop policy if exists "read own pin" on toilet_pins;
create policy "read own pin" on toilet_pins
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "insert own pin" on toilet_pins;
create policy "insert own pin" on toilet_pins
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "update own pin" on toilet_pins;
create policy "update own pin" on toilet_pins
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own pin" on toilet_pins;
create policy "delete own pin" on toilet_pins
  for delete to authenticated
  using (auth.uid() = user_id);
