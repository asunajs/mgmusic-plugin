#!/usr/bin/env bash
# 把 0.4.x 插件装进某个 panel-llrt 实例的插件目录。
#
#   面板提供面板，插件归插件项目 —— 所以"上线"这一步在插件项目里做，面板仓不参与。
#
# 用法：
#   npm run deploy:panel                                  # 默认日常实例 ~/panel-3030/plugins
#   PANEL_PLUGINS_DIR=/path/to/plugins npm run deploy:panel
#   PANEL_PLUGINS_DIR=... bash scripts/deploy-panel.sh --restart   # 装完顺手重启 launchd 服务
#
# 只做三件事：构建 → 整份拷贝（判据 cmp 逐个核）→ 告诉你怎么让它生效。
# 不会去改面板的数据目录，更不会碰账号配置（账号在面板库的 state 表里）。
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEST="${PANEL_PLUGINS_DIR:-$HOME/panel-3030/plugins}"
NAME=mgmusic
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "不认识的参数：$arg" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
node scripts/build-panelllrt.mjs

# 样式门禁：面板仓的 check-plugin-style 按 cwd/plugins 扫，所以拿产物在临时目录里摆成插件目录
# 再跑它 —— 这样"插件归插件项目"之后，这道闸门也没丢。
PANEL_REPO="${PANEL_REPO:-$ROOT/../../panel-llrt}"
GATE="$PANEL_REPO/scripts/check-plugin-style.mjs"
if [ -f "$GATE" ]; then
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/plugins"
  cp -R "dist/panel-llrt/." "$TMP/plugins/"
  echo "→ 样式门禁（$GATE）"
  ( cd "$TMP" && node "$GATE" ) || { rm -rf "$TMP"; echo "❌ 样式门禁没过，没装" >&2; exit 1; }
  rm -rf "$TMP"
else
  echo "（跳过样式门禁：没找到 $GATE）"
fi

if [ ! -d "$DEST" ]; then
  echo "❌ 插件目录不存在：$DEST（面板装过吗？或者用 PANEL_PLUGINS_DIR 指定）" >&2
  exit 1
fi

echo "→ 装到 $DEST"
cp "dist/panel-llrt/$NAME.js" "$DEST/$NAME.js"
rm -rf "${DEST:?}/$NAME.webui"
cp -R "dist/panel-llrt/$NAME.webui" "$DEST/$NAME.webui"

cmp "dist/panel-llrt/$NAME.js" "$DEST/$NAME.js"
for f in index.html style.css app.js boot.js; do
  cmp "dist/panel-llrt/$NAME.webui/$f" "$DEST/$NAME.webui/$f"
done
echo "✅ 5 个文件逐个 cmp 一致"

if [ "$RESTART" = 1 ]; then
  echo "→ 重启 launchd 服务（dev.panel）"
  launchctl kickstart -k "gui/$(id -u)/dev.panel"
  echo "✅ 已重启；看日志确认真加载了："
  echo "   sqlite3 \"$HOME/panel-3030/data/panel.db\" \"select message from logs where plugin='$NAME' order by id desc limit 1\""
else
  cat <<'TIP'

下一步（二选一让它生效）：
  · 面板界面 → 插件列表 → mgmusic 卡片 → 「重载」（只影响这一个插件）
  · 或重来一次带 --restart（重启整个面板服务）
TIP
fi
