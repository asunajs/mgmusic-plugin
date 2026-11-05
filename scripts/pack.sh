#!/usr/bin/env bash
# 打面板能直接安装的 zip：
#   js/mgmusic.js + mgmusic/{index.html,app.js,style.css,boot.js}
# 仓库/发布包仍叫 mgmusic-plugin；面板插件 id 是 mgmusic。
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION=$(node -p "require('$HERE/package.json').version")
OUT="$HERE/dist/mgmusic"
rm -rf "$OUT"
mkdir -p "$OUT/js" "$OUT/mgmusic"
cp "$HERE/mgmusic.js" "$OUT/js/"
cp "$HERE/index.html" "$HERE/app.js" "$HERE/style.css" "$HERE/boot.js" "$OUT/mgmusic/"
ZIP="$HERE/dist/mgmusic-plugin-$VERSION.zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr "$ZIP" js mgmusic)
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$HERE/dist" && sha256sum "mgmusic-plugin-$VERSION.zip" > SHA256SUMS)
else
  (cd "$HERE/dist" && shasum -a 256 "mgmusic-plugin-$VERSION.zip" > SHA256SUMS)
fi
echo "$ZIP"
