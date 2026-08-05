#!/usr/bin/env bash
# 零外部 CDN 自查（CLAUDE.md 3.3）。CI 里必须跑。
#
# 国内打不开境外站点，八成不是被墙，是页面卡在某个 fonts.googleapis.com 请求上。
#
# 检查分三层，因为「产物里出现某个域名」和「运行时会去请求它」不是一回事：
#   1. index.html 里的外部 <link>/<script>/<img> —— 这是最致命的一类，直接卡首屏
#   2. 已知会拖垮国内访问的域名，出现即失败
#   3. 全量域名扫描，白名单之外一律失败
#
# 第 3 层的白名单分两组：allowed（运行时真会请求，我们接受）和
# inert（打包进来的库里写死的报错文案 / 署名链接，浏览器不会去 fetch）。
# inert 里每一条都写清出处 —— 新出现的域名必须先被人看过才能加进来。

set -euo pipefail

DIST="${1:-dist}"

if [ ! -d "$DIST" ]; then
  echo "✗ 没有 $DIST/，先跑 pnpm build"
  exit 1
fi

fail=0

# ---------------------------------------------------------------- 1. index.html
echo "① index.html 里的外部资源引用"
HTML_EXT=$(grep -oE '(src|href)="https?://[^"]+"' "$DIST/index.html" 2>/dev/null || true)
if [ -n "$HTML_EXT" ]; then
  echo "  ✗ index.html 直接引了外部资源："
  echo "$HTML_EXT" | sed 's/^/    /'
  fail=1
else
  echo "  ✓ 没有"
fi
echo

# ---------------------------------------------------------------- 2. 高危域名
echo "② 已知会拖垮国内访问的域名"
BANNED='fonts\.googleapis\.com|fonts\.gstatic\.com|ajax\.googleapis\.com|cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|www\.google-analytics\.com|www\.googletagmanager\.com|recaptcha\.net|www\.gstatic\.com|use\.fontawesome\.com|api\.mapbox\.com|events\.mapbox\.com'
HITS=$(grep -rhoE "$BANNED" "$DIST" 2>/dev/null | sort -u || true)
if [ -n "$HITS" ]; then
  echo "  ✗ 命中："
  echo "$HITS" | sed 's/^/    /'
  fail=1
else
  echo "  ✓ 没有"
fi
echo

# ---------------------------------------------------------------- 3. 全量扫描

# 运行时真会请求的，只有这些
ALLOWED='\.supabase\.(co|in|net)$|\.is\.autonavi\.com$|\.basemaps\.cartocdn\.com$|^api\.maptiler\.com$|^localhost|^127\.0\.0\.1|pooping\.me$'

# 打包进来的库里写死的字符串，浏览器不会请求。每条都要有出处。
INERT='
^www\.w3\.org$                # SVG/XML 命名空间标识符，不是地址
^bit\.ly$                     # workbox 的 console 警告文案
^reactjs\.org$                # React 报错信息里的文档链接
^react\.dev$                  # 同上
^github\.com$                 # supabase-js / maplibre 报错信息里的 issue 链接
^maplibre\.org$               # 地图左下角署名的 <a href>，用户点了才跳
^openstreetmap\.org$          # 同上，OSM 数据署名
^www\.openstreetmap\.org$     # 同上
'
INERT=$(echo "$INERT" | sed 's/#.*//' | tr -d ' ' | grep -v '^$' | paste -sd'|' -)

# 瓦片地址是模板字符串（子域轮询），把 ${x} 归一成 * 而不是丢掉 ——
# 底图指向哪家是这个检查最该让人看见的信息
FOUND=$(grep -rhoE 'https?://[^"'"'"'`\\ )>,;]+' "$DIST" 2>/dev/null \
  | sed -E 's#\$\{[^}]*\}#*#g; s#^https?://##; s#[/?].*$##; s#:[0-9]+$##' \
  | grep -v '^$' \
  | sort -u || true)

echo "③ 产物里出现的全部域名"
echo "$FOUND" | sed 's/^/    /'
echo

UNKNOWN=$(echo "$FOUND" | grep -vE "$ALLOWED" | grep -vE "$INERT" || true)
if [ -n "$UNKNOWN" ]; then
  echo "  ✗ 白名单之外的域名："
  echo "$UNKNOWN" | sed 's/^/    /'
  echo
  echo "  只允许 Supabase API 和地图瓦片。字体走 npm 打包，图标用 lucide-react。"
  echo "  如果确认它只是库里的报错文案、浏览器不会去请求，"
  echo "  就加进本脚本的 INERT 列表并写明出处。"
  fail=1
else
  echo "  ✓ 白名单之外没有额外域名"
fi

echo
if [ "$fail" -ne 0 ]; then
  exit 1
fi
echo "✓ 零外部 CDN 检查通过"
