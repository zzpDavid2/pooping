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
