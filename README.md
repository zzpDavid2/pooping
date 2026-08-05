# 厕评 · pooping

厕所点评。找到附近的厕所，看别人写的（AI 润色过的）搞笑锐评。

- 双语：中文 / English，右上角一键切换
- 双地图：国内版走高德栅格瓦片 + GCJ-02 偏移，海外版走矢量瓦片
- PWA，加到主屏即用，无需下载

产品设计和架构铁律见 [CLAUDE.md](CLAUDE.md)。**动代码前先读它。**

---

## 快速开始

```bash
pnpm install
cp .env.example .env.local

# 起本地 Supabase（需要 Docker），输出的 API URL / anon key / service_role key 填进 .env.local
pnpm db:start
pnpm db:reset          # 建表 + RLS + RPC

# 导入点位。先做国内，密度 > 覆盖
pnpm import:osm -- --city=beijing
pnpm import:osm -- --city=shanghai

# 生成开发用假评价（会真的调 LLM，需要先配 key，见下）
pnpm seed:reviews -- --limit=15 --per=3

pnpm dev
```

打开 http://localhost:5173

---

## 当前阶段：先跑国内版

产品长期是美国优先（Portland 起步），但**现阶段先在北京 / 上海实测国内版**，
所以 `.env.example` 里 `VITE_DEFAULT_REGION=cn`。

### 真机上怎么切

不用改代码重新部署，直接在 URL 上带参数：

| 想要什么 | 加什么 |
|---|---|
| 国内版地图（高德 + GCJ-02） | `?region=cn` |
| 海外版地图 | `?region=intl` |
| 英文界面 | `?lang=en` |
| 中文界面 | `?lang=zh` |

例：`http://<你的内网 IP>:5173/?region=cn&lang=en`

选择会存进 localStorage，之后打开就是这个设置。界面右上角也有两个切换按钮。

手机连同一 WiFi 测试：`pnpm dev --host`，然后访问电脑的内网 IP。

### 在北京 / 上海要重点看什么

1. **点位有没有偏。** 打开一个你知道确切位置的厕所，看图钉是不是落在正确的建筑上。
   偏 300–600 米 = GCJ-02 没生效；偏一点点 = 正常的 OSM 数据误差。
2. **瓦片加载快不快。** 高德是境内 CDN，应该秒开。如果卡，检查是不是误切到了 `intl`。
3. **中英文切换。** 两种语言下 UI 都不该出现串行、截断、或者半中半英。
4. **生成的锐评好不好笑。** 这是产品最核心的假设，其它都是它的配套设施。

---

## 环境变量

前端只认 `VITE_` 前缀的（见 `.env.example`）。

**LLM 的 key 绝对不能加 `VITE_` 前缀** —— 那会被打进 bundle 公开出去。
它只属于 Edge Function。

### LLM provider

Edge Function 统一走 OpenAI-compatible `/chat/completions` 标准。OpenAI、阿里云百炼 compatible mode、OpenRouter、DeepSeek、自建网关都填同一组三个环境变量。

```bash
# 本地：写进 supabase/functions/.env（已在 .gitignore 里）
LLM_API_KEY=sk-xxxxxxxx
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1

# 云端
npx supabase secrets set LLM_API_KEY=sk-xxx LLM_MODEL=gpt-4o-mini LLM_BASE_URL=https://api.openai.com/v1
```

阿里云百炼 compatible mode 示例：

```bash
LLM_API_KEY=sk-xxxxxxxx
LLM_MODEL=deepseek-v3.2
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

**选模型时注意：**

推理模型如 `deepseek-r1` / OpenAI `o-series` 可能不接受 `temperature`。代码检测到会跳过 `temperature`，但这个产品靠 `temperature=1.25` 出效果，聊天模型通常更适合写好笑锐评。兼容 API 如果返回 `reasoning_content`，函数只取 `content`，不会把思考过程漏进前端。

本地跑 Edge Function：

```bash
pnpm fn:serve            # 会自动读 supabase/functions/.env
```

---

## 常用命令

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 开发服务器 |
| `pnpm build` | 类型检查 + 构建 |
| `pnpm check:external` | **扫构建产物里的外部域名**，CI 必跑 |
| `pnpm db:start` / `db:stop` | 本地 Supabase 起停 |
| `pnpm db:reset` | 重置到 migrations 的状态 |
| `pnpm import:osm -- --city=beijing` | 导入 OSM 点位 |
| `pnpm seed:reviews` | 生成开发用假评价 |
| `pnpm prebuild:static` | 烤首屏静态数据 |
| `pnpm icons` | 从 SVG 重新生成 PWA 图标 |

可用城市：`beijing` `shanghai` `portland` `reed`，或 `--bbox=south,west,north,east`。

---

## 目录结构

```
src/
  api/          数据访问的唯一入口。组件里不许出现 supabase.from()
  map/          地图的唯一出口。组件里不许 import maplibre-gl
    coords.ts     WGS-84 ↔ GCJ-02
    tiles.ts      瓦片源，换底图只改这里
    adapter.ts    MapLibre 封装
  i18n/         语言上下文
  constants/    copy.ts（全部文案，中英双语）/ tags.ts / styles.ts
  components/
  pages/
  hooks/
  lib/

supabase/
  migrations/   所有表结构变更。禁止在 Dashboard 上直接改表
  functions/
    _shared/quick-tags.ts    标签的唯一定义，前端和 Edge Function 共用
    generate-review/         唯一调 LLM 的地方

scripts/        导入 / seed / 检查
```

坐标一律以 **WGS-84** 入库。GCJ-02 偏移只发生在 `src/map/coords.ts`，
渲染时做，数据库里绝不存偏移坐标。

---

## 上线前 checklist

- [ ] `pnpm build && pnpm check:external` 通过
- [ ] **清掉假评价**：`delete from reviews where is_seed = true;`
- [ ] 绑自有域名（`pooping.me`），不要用 `*.vercel.app` / `*.pages.dev` 当主域名
- [ ] `supabase db push` 把 migrations 同步到云端
- [ ] `supabase secrets set` 配好 LLM key
- [ ] 手机上装一次 PWA，确认图标和启动画面正常

---

## 数据来源

厕所点位来自 [OpenStreetMap](https://www.openstreetmap.org/)，ODbL 协议。
