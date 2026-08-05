# CLAUDE.md — 厕评 / pooping

给 Claude Code 的项目说明。开始任何编码前先读完本文件。

---

## 1. 项目是什么

**厕评** —— 厕所版大众点评。快速找到附近的厕所，并看到别人写的（AI 润色过的）搞笑锐评。

- 中文名：厕评（备用：评厕）
- 英文名：**pooping**
- 域名：**pooping.me**
- 双属性：**搞笑负责传播，结构化数据负责留存**。任何功能设计都要落在其中一边

**当前定位：美国优先的个人项目**（Portland 起步），但代码要保持在国内不翻墙也能打开。见第 8 节。

### 护城河在哪

厕所位置数据在美国是免费的（OSM，见第 6 节），所以数据不是壁垒。
**壁垒是评价内容本身好不好笑、值不值得截图转发。**
一切工程决策都要服务于这一点。

---

## 2. 技术栈（已定，不要更换）

| 层 | 选型 |
|---|---|
| 前端 | **Vite + React 18 + TypeScript** |
| 样式 | Tailwind CSS |
| 后端 / 数据库 | **Supabase**（Postgres + PostGIS + Auth + Storage + RLS） |
| 地图 | **MapLibre GL JS**（矢量），瓦片走 Protomaps / MapTiler |
| LLM | Anthropic 或 OpenAI API，**在 Supabase Edge Function 里调** |
| 部署 | Vercel 或 Cloudflare Pages，绑自有 `.com` 域名 |
| 包管理 | pnpm |

### 明确不做

- ❌ 不用 Taro / uni-app（微信小程序 UGC 需要企业主体 + 增值电信业务经营许可证，短期不可能）
- ❌ 不做 iOS 原生 App，**做 PWA**（manifest + service worker，iPhone 加到主屏即可，省掉 App Store 审核和年费）
- ❌ 不引入任何后端框架（Express / Nest）。需要服务端逻辑就写 Edge Function

---

## 3. 三条架构铁律

违反这三条的 PR 一律打回。

### 3.1 所有数据访问走 `src/api/`

```
src/api/
  client.ts      # Supabase 客户端，唯一实例
  toilets.ts     # getNearbyToilets() / getToiletById() ...
  reviews.ts     # getReviews() / createReview() ...
```

组件和页面里**绝不允许**出现 `supabase.from(...)`。UI 只 import `src/api/` 导出的函数。
所有函数返回 `{ data, error }`，不向 UI 层抛异常。

### 3.2 所有地图操作走 `src/map/`

```
src/map/
  adapter.ts     # renderMap() / addMarkers() / moveTo() / fitBounds()
  tiles.ts       # 瓦片源配置，按地区切换
  coords.ts      # 坐标系转换
```

组件里不直接调 MapLibre API。理由见 8.2 —— 国内要换成高德瓦片时只改这一层。

### 3.3 零外部 CDN

**唯一允许的外部请求是 Supabase API 和地图瓦片服务。**

- 禁止在 `index.html` 或任何组件中引用外部 CDN
- 字体用 `@fontsource/*` 通过 npm 安装打包，**绝不用 Google Fonts 的 `<link>`**
- 图标用 `lucide-react`（npm 包），不用 Font Awesome CDN
- 不引 Google Analytics、reCAPTCHA、Google 登录

构建后自查：

```bash
pnpm build
grep -rhoE 'https?://[^"'"'"' )]+' dist/ | sort -u
```

除 Supabase 地址和瓦片服务器外不应出现任何域名。这条已写成 `scripts/check-external.sh`，CI 里要跑。

---

## 4. 数据模型（Postgres）

### `toilets`

```sql
create table toilets (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  location      geography(Point, 4326) not null,  -- WGS-84
  address       text,
  building      text,
  floor         text,
  gender        text check (gender in ('male','female','unisex','both')),
  category      text check (category in ('public','mall','campus','restaurant','transit','office','park','other')),

  -- 实用信息，全部可筛选
  has_paper     boolean,
  has_soap      boolean,
  has_dryer     boolean,
  has_hook      boolean,        -- 挂钩，被严重低估的痛点
  accessible    boolean,
  baby_changing boolean,
  seat_type     text check (seat_type in ('squat','seated','both')),
  stall_count   int,
  is_free       boolean,
  needs_code    boolean,        -- 需不需要消费/密码
  open_24h      boolean,

  -- 聚合字段，避免每次读都算
  review_count  int default 0,
  avg_clean     numeric(2,1),
  avg_queue     numeric(2,1),
  avg_smell     numeric(2,1),

  source        text check (source in ('osm','refuge','seed','ugc')) default 'osm',
  osm_id        bigint unique,   -- OSM 导入去重用
  status        text check (status in ('published','pending','rejected')) default 'published',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index toilets_location_idx on toilets using gist (location);
```

**坐标系统一存 WGS-84 (SRID 4326)。** 转 GCJ-02 只在渲染层做（`src/map/coords.ts`），数据库里绝不存偏移坐标。

"附近 500 米"查询用 `ST_DWithin(location, ST_MakePoint(lng,lat)::geography, 500)`。

### `reviews`

```sql
create table reviews (
  id            uuid primary key default gen_random_uuid(),
  toilet_id     uuid references toilets(id) on delete cascade,
  user_id       uuid references auth.users(id),   -- 匿名用户也有真实 id

  -- 实用维度：用户只勾选，不打字
  clean         smallint check (clean between 1 and 5),
  smell         smallint check (smell between 1 and 5),
  queue         smallint check (queue between 1 and 5),
  privacy       smallint check (privacy between 1 and 5),
  quick_tags    text[],        -- ['没纸了','排大队','门锁坏了']

  raw_note      text,          -- 用户原始输入，可空
  ai_text       text not null, -- LLM 生成，展示用
  ai_style      text not null,
  edited_by_user boolean default false,
  is_seed       boolean default false,   -- 开发期假数据，上线前必须清理，见第 6 节

  created_at    timestamptz default now()
);
```

### RLS 策略

```sql
alter table toilets enable row level security;
alter table reviews enable row level security;

-- 所有人可读
create policy "toilets readable" on toilets for select using (status = 'published');
create policy "reviews readable" on reviews for select using (true);

-- 登录用户（含匿名）可写自己的评价
create policy "insert own review" on reviews for insert
  with check (auth.uid() = user_id);
create policy "update own review" on reviews for update
  using (auth.uid() = user_id);
```

### `ai_style` 枚举

```ts
type ReviewStyle =
  | 'wenyan'      // 文言文体
  | 'xiaohongshu' // 小红书体
  | 'waimai'      // 外卖差评体
  | 'eulogy'      // 悼词体
  | 'luxun'       // 鲁迅体
  | 'documentary' // 纪录片旁白
  | 'michelin'    // 米其林指南体
  | 'rap'         // 说唱
```

文风是玩法核心：同一条评价换个文风重新生成，本身就有可玩性，也是转发的动力。

---

## 5. 登录：V1 只做匿名

```ts
await supabase.auth.signInAnonymously()
```

- 打开即用，**不做任何注册流程**。内急的人不会为了看评价去注册
- 匿名用户有真实 `user.id`，能挂 RLS，跟正式用户在数据层无差别
- 用户自己起昵称，存在 `user_metadata`
- 以后要升级成正式账号用 `linkIdentity()`，历史评价不丢

**不要接 Google / Apple 登录**（国内直接死，见 8.1）。

做正式账号体系的唯一信号：有人开始在意"我发的评价"（想编辑、想找回）。在那之前都是过早优化。

---

## 6. 冷启动：从 OSM 导入，不要手工录入

OSM 有 `amenity=toilets` 标签，全球几十万个点位，ODbL 协议，标注来源即可使用。

写一个 `scripts/import-osm.ts`：

```
[out:json][timeout:60];
node["amenity"="toilets"](45.45,-122.8,45.65,-122.5);
out body;
```

**字段映射**：

| OSM tag | 我们的字段 |
|---|---|
| `wheelchair=yes` | `accessible` |
| `fee=no` | `is_free` |
| `unisex=yes` | `gender='unisex'` |
| `toilets:position=seated` | `seat_type` |
| `changing_table=yes` | `baby_changing` |
| `opening_hours=24/7` | `open_24h` |

用 `osm_id` 唯一索引做幂等，重复跑不会产生脏数据。

**首批区域**：Reed College 校园 + Portland 市中心。密度 > 覆盖，先做透一个区域。

补充数据源：Refuge Restrooms（开源厕所数据库，有公开 API），可作为第二轮补全。

### 6.2 评价内容：UGC 优先，不做后台录入

**没有 CMS，没有管理后台。**厕所点位从 OSM 来，评价内容从用户来。

但开发期需要有内容才能测前端，所以写一个 `scripts/seed-reviews.ts`：

- 遍历已导入的 toilets，随机生成评分和 quick_tags
- 调**真实的** `generate-review` Edge Function 批量生成 `ai_text`，每个厕所 2–5 条，文风随机
- 全部标记 `is_seed = true`

这个脚本一石三鸟：填满前端、跑通整条 LLM 链路、**同时让David一次性读到几十条生成结果，直接判断梗到底好不好笑**。这是产品最核心的假设，越早验证越好。

**上线前必须清理**：

```sql
delete from reviews where is_seed = true;
```

假评价可以用来开发，但不能当成真人评价展示给用户。要么删干净，要么在 UI 上明确标注为示例。写进发布 checklist。

---

## 7. LLM 生成规则

Edge Function `generate-review`。**API key 只存 Supabase 的环境变量，绝不进前端、绝不进仓库。**

**输入**：评分、quick_tags、raw_note、ai_style、厕所基本信息
**输出**：60–120 字中文锐评

System prompt 必须包含的硬约束：

- 只能基于传入的标签和评分发挥，**不要编造未提供的事实**
- 禁止：涉政、擦边、地域歧视、人身攻击、真实人名、脏话、生理细节描写
- 可以：荒诞、自嘲、夸张、玩梗
- 输出纯文本，不要 markdown，不要引号包裹

`temperature` 设 1.2–1.3。默认值太一本正经，出不来效果。

**成本控制**：生成结果写库存 `ai_text`，读取时直接取，**绝不在渲染时重新调模型**。

**内容尺度**：厕所题材天然贴着低俗线。荒诞、自嘲、夸张可以，生理细节和擦边不行。这个尺度是产品长期能不能活的关键，不是走形式。

---

## 8. 国内可达性约束

产品面向美国，但要做到国内不翻墙也能打开。成本很低，且都是本来就该做的优化。

### 8.1 已由第 3.3 节覆盖

零外部 CDN 这条铁律，就是国内可达性的主要保障。国内打不开境外站点，八成不是被墙，是页面卡在某个 `fonts.googleapis.com` 请求上。

补充：**不要用 `*.vercel.app` / `*.pages.dev` 作为主域名**，平台默认域名在国内经常整体不稳定。绑自有 `.com`。

### 8.2 地图按地区切换瓦片源

```ts
// src/map/tiles.ts
export const tileSource = isInChina()
  ? AMAP_TILES       // 高德栅格瓦片 + GCJ-02 偏移
  : PROTOMAPS_TILES  // 海外矢量瓦片
```

矢量瓦片体积大，从境外拉到国内会明显卡。这是国内体感最差的一环。

### 8.3 首屏静态化

厕所列表数据在构建时预生成，首屏不等 Supabase（新加坡节点 200ms 起步）。

### 8.4 分享靠图片，不靠链接

未备案域名在微信内置浏览器里随时可能被拦，且无申诉渠道。

所以**传播单元是截图，不是链接**：

- 生成一张一屏放得下、字大、有强辨识度的分享卡图片
- 图片上印 **pooping.me** 的文字，不印二维码（二维码扫出来还是跳链接，一样被拦）
- 分享落地页必须静态托管 + CDN，别做成每次查库的动态页

### 8.5 环境变量，不要硬编码

所有 Supabase 连接配置走 `.env`，不要在代码里写死 URL，也不要用只有官方托管版才有的功能。将来要迁到自托管 Supabase 时，改的只是连接串。

---

## 9. V1 范围

### 做

- 地图页：附近厕所撒点 + 列表，按距离排序
- 详情页：facilities 图标墙 + 评价流
- 筛选：有纸 / 免费 / 无障碍 / 坐便
- 发布评价：勾选标签 → 选文风 → 生成 → **用户预览可改** → 发布
- 分享卡片图生成
- PWA（可安装到主屏）
- **举报入口**（每条评价一个按钮，写进 `reports` 表即可，先不做处理流程）
- **频率限制**（同一 user_id 每分钟最多 3 条评价，Edge Function 里挡）

### 不做

- ❌ 拍照上传（见第 10 节）
- ❌ 注册登录流程
- ❌ 社交功能：关注、私信、好友
- ❌ 支付、会员、广告

---

## 10. 硬性禁止

### 10.1 绝不实现厕所内部拍摄功能

厕所是私密空间，鼓励用户在里面举起手机是把风险转嫁给他们，平台侧一旦流出含人物的照片更是刑事级别的问题。

- 不写调起相机拍摄隔间的代码
- 未来若要加图片，**只允许入口 / 指示牌 / 外观**，且必须人工过审
- 结构化标签的信息密度本来就比照片高，一屏能扫完

### 10.2 AI 内容必须标注

评价卡片上要有可见的 `AI 润色` 标识。不要为了"看起来更真实"而隐藏。

它是卖点不是污点 —— 用户知道是 AI 写的，才敢玩那些离谱文风。

### 10.3 用户必须能编辑后再发布

流程固定：勾选 → 生成 → **预览可改** → 发布。不允许直接发布未经用户确认的生成内容。

---

## 11. 代码约定

- TypeScript strict 模式
- 函数式组件 + hooks，不写 class
- 文案集中放 `src/constants/copy.ts`，不要散落在组件里 —— 搞笑文案会频繁调整
- 提交信息用中文，说清楚改了什么
- 每加一个依赖前先想：它会不会引入外部请求？

---

## 12. 本地开发

### 12.1 数据库跑在本地，不连云端

日常开发用 Supabase CLI 在本机起全套（Postgres + Auth + Storage + Studio）：

```bash
supabase init      # 只需一次
supabase start     # 输出本地 URL 和 anon key，填进 .env.local
supabase stop
supabase db reset  # 重置到 migrations 的状态，随便折腾
```

云端项目只用于部署。本地开发零延迟、断网可用，且与开发者所在地区无关。

### 12.2 数据库变更必须走 migration

**所有表结构变更写成 `supabase/migrations/*.sql` 文件，禁止直接在云端 Dashboard 上改表。**

```bash
supabase migration new add_reports_table
# 编辑生成的 SQL 文件
supabase db reset          # 本地验证
supabase db push           # 同步到云端
```

违反这条会导致本地和线上结构不一致，是这套工具链最容易踩的坑。

### 12.3 常用命令

```bash
pnpm install
pnpm dev
pnpm build
pnpm check:external      # 扫描构建产物里的外部域名
pnpm import:osm -- --bbox=45.45,-122.8,45.65,-122.5
pnpm seed:reviews        # 生成开发用假评价，见 6.2
```
