#!/usr/bin/env bash
# 打面板能直接安装的 zip：js/mgmusic-plugin.js + mgmusic-plugin/{index.html,app.js,style.css}
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$HERE/package.json').version")"
OUT="$HERE/dist"
rm -rf "$OUT"
mkdir -p "$OUT/js" "$OUT/mgmusic-plugin"
cp "$HERE/mgmusic-plugin.js" "$OUT/js/"
cp "$HERE/index.html" "$HERE/app.js" "$HERE/style.css" "$OUT/mgmusic-plugin/"
ZIP="$HERE/mgmusic-plugin-$VERSION.zip"
rm -f "$ZIP"
(cd "$OUT" && zip -qr "$ZIP" js mgmusic-plugin)
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$HERE" && sha256sum "mgmusic-plugin-$VERSION.zip" > "$OUT/SHA256SUMS")
else
  (cd "$HERE" && shasum -a 256 "mgmusic-plugin-$VERSION.zip" > "$OUT/SHA256SUMS")
fi
echo "$ZIP"
cat "$OUT/SHA256SUMS"
