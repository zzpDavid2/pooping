#!/usr/bin/env bash
# 从 favicon.svg 生成 PWA 需要的 PNG 图标。
# 本地一次性跑，产物提交进仓库 —— 不进构建流程，免得 CI 还要装 ImageMagick。

set -euo pipefail

cd "$(dirname "$0")/.."
SRC="public/icons/favicon.svg"

if [ ! -f "$SRC" ]; then
  echo "✗ 找不到 $SRC"
  exit 1
fi

render() {
  local size="$1" out="$2"
  if command -v rsvg-convert >/dev/null 2>&1; then
    rsvg-convert -w "$size" -h "$size" "$SRC" -o "$out"
  elif command -v magick >/dev/null 2>&1; then
    magick -background none "$SRC" -resize "${size}x${size}" "$out"
  else
    echo "✗ 需要 rsvg-convert 或 ImageMagick：brew install librsvg"
    exit 1
  fi
  echo "  ✓ $out (${size}px)"
}

render 192 public/icons/icon-192.png
render 512 public/icons/icon-512.png
render 180 public/icons/apple-touch-icon.png

# maskable 要求图形留在中间 80% 的安全区内，四周补一圈同色边
if command -v magick >/dev/null 2>&1; then
  magick public/icons/icon-512.png -resize 410x410 \
    -background '#c07540' -gravity center -extent 512x512 \
    public/icons/icon-512-maskable.png
  echo "  ✓ public/icons/icon-512-maskable.png (512px, maskable)"
else
  cp public/icons/icon-512.png public/icons/icon-512-maskable.png
  echo "  ! 没有 ImageMagick，maskable 直接复制了一份（安全区可能被裁）"
fi
