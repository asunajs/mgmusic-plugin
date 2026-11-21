#!/usr/bin/env bash
# 把 mgmusic 安装到一个面板实例的插件目录（LLRT 版，新面板）。
#
# 仓库/发布包名叫 mgmusic-plugin；面板里注册的插件名是 mgmusic。
# 默认目录是 macOS 安装版：
#   PLUGINS_DIR     = ~/Library/Application Support/plugin-panel/plugins
#   PLUGIN_DATA_DIR = ~/Library/Application Support/plugin-panel/data/plugin-data
#
# 其他部署方式直接覆盖环境变量：
#   PLUGINS_DIR=/opt/panel/plugins PLUGIN_DATA_DIR=/opt/panel/plugin-data ./install.sh
#
# ⚠ 装的是 `dist/panel-llrt/`（`npm run build` 的产物），不是仓库源码目录。
#    旧面板（0.3.x / QuickJS）那套布局已经不再支持，仓库里也不保留。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGINS_DIR="${PLUGINS_DIR:-$HOME/Library/Application Support/plugin-panel/plugins}"
PLUGIN_DATA_DIR="${PLUGIN_DATA_DIR:-$HOME/Library/Application Support/plugin-panel/data/plugin-data}"
PLUGIN="mgmusic"
OLD_PLUGIN="mgmusic-plugin"
DIST="$HERE/dist/panel-llrt"

echo "PLUGINS_DIR     = $PLUGINS_DIR"
echo "PLUGIN_DATA_DIR = $PLUGIN_DATA_DIR"

if [ ! -f "$DIST/$PLUGIN.js" ]; then
  echo "❌ 没有 $DIST/$PLUGIN.js —— 先跑 npm run build" >&2
  exit 1
fi

mkdir -p "$PLUGINS_DIR"
cp "$DIST/$PLUGIN.js" "$PLUGINS_DIR/$PLUGIN.js"
cp "$DIST/$PLUGIN.panel.json" "$PLUGINS_DIR/$PLUGIN.panel.json"
rm -rf "$PLUGINS_DIR/$PLUGIN.webui"
cp -R "$DIST/$PLUGIN.webui" "$PLUGINS_DIR/$PLUGIN.webui"

# 旧 id 的产物不能继续被扫描，否则会同时加载两个插件。
if [ -f "$PLUGINS_DIR/js/$OLD_PLUGIN.js" ]; then
  mv "$PLUGINS_DIR/js/$OLD_PLUGIN.js" "$PLUGINS_DIR/js/$OLD_PLUGIN.js.bak-rename"
  echo "已停用旧后端：$PLUGINS_DIR/js/$OLD_PLUGIN.js -> .bak-rename"
fi
if [ -d "$PLUGINS_DIR/$OLD_PLUGIN" ]; then
  mv "$PLUGINS_DIR/$OLD_PLUGIN" "$PLUGINS_DIR/$OLD_PLUGIN.bak-rename"
  echo "已停用旧 UI：$PLUGINS_DIR/$OLD_PLUGIN -> .bak-rename"
fi

# 数据目录从 mgmusic-plugin 迁到 mgmusic；已有新目录时只补缺文件，不覆盖。
OLD_DATA="$PLUGIN_DATA_DIR/$OLD_PLUGIN"
NEW_DATA="$PLUGIN_DATA_DIR/$PLUGIN"
if [ -d "$OLD_DATA" ]; then
  if [ ! -e "$NEW_DATA" ]; then
    mv "$OLD_DATA" "$NEW_DATA"
    echo "已迁移数据目录：$OLD_DATA -> $NEW_DATA"
  else
    for f in config.json app-account.json; do
      if [ -f "$OLD_DATA/$f" ] && [ ! -e "$NEW_DATA/$f" ]; then
        cp "$OLD_DATA/$f" "$NEW_DATA/$f"
        echo "已补迁文件：$OLD_DATA/$f -> $NEW_DATA/$f"
      fi
    done
  fi
fi
mkdir -p "$NEW_DATA"

# 更早的 cmusic-plugin 配置也兼容。
OLD_CMUSIC_DATA="$PLUGIN_DATA_DIR/cmusic-plugin"
if [ ! -f "$NEW_DATA/config.json" ] && [ -f "$OLD_CMUSIC_DATA/config.json" ]; then
  cp "$OLD_CMUSIC_DATA/config.json" "$NEW_DATA/config.json"
  echo "已从旧名迁移配置：$OLD_CMUSIC_DATA/config.json -> $NEW_DATA/config.json"
fi

echo
echo "✅ 已安装到 $PLUGINS_DIR（$PLUGIN.js + $PLUGIN.panel.json + $PLUGIN.webui/）"
echo "下一步：面板「插件」页点「重载」，或重启面板服务。"
