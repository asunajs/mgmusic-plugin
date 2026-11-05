#!/usr/bin/env bash
# 把 mgmusic-plugin 安装到本机插件面板。
#
# 默认目录是 macOS 安装版：
#   PLUGINS_DIR     = ~/Library/Application Support/plugin-panel/plugins
#   PLUGIN_DATA_DIR = ~/Library/Application Support/plugin-panel/data/plugin-data
#
# 其他部署方式直接覆盖环境变量：
#   PLUGINS_DIR=/opt/panel/plugins PLUGIN_DATA_DIR=/opt/panel/plugin-data ./install.sh
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGINS_DIR="${PLUGINS_DIR:-$HOME/Library/Application Support/plugin-panel/plugins}"
PLUGIN_DATA_DIR="${PLUGIN_DATA_DIR:-$HOME/Library/Application Support/plugin-panel/data/plugin-data}"

echo "PLUGINS_DIR     = $PLUGINS_DIR"
echo "PLUGIN_DATA_DIR = $PLUGIN_DATA_DIR"

mkdir -p "$PLUGINS_DIR/js" "$PLUGINS_DIR/mgmusic-plugin" "$PLUGIN_DATA_DIR/mgmusic-plugin"

cp "$HERE/mgmusic-plugin.js" "$PLUGINS_DIR/js/mgmusic-plugin.js"
cp "$HERE/index.html" "$HERE/app.js" "$HERE/style.css" "$PLUGINS_DIR/mgmusic-plugin/"

# 从旧名 cmusic-plugin 迁移配置：旧数据目录不删，只复制一份。
OLD_DATA_DIR="$PLUGIN_DATA_DIR/cmusic-plugin"
if [ ! -f "$PLUGIN_DATA_DIR/mgmusic-plugin/config.json" ] \
   && [ -f "$OLD_DATA_DIR/config.json" ]; then
  cp "$OLD_DATA_DIR/config.json" "$PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
  echo "已从旧名迁移配置：$OLD_DATA_DIR/config.json -> $PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
elif [ ! -f "$PLUGIN_DATA_DIR/mgmusic-plugin/config.json" ]; then
  cp "$HERE/config.example.json" "$PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
  echo "已写入配置模板：$PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
else
  echo "保留已有配置：$PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
fi

echo
echo "完成。面板会在 30 秒内扫描到插件；也可以在「插件列表」里点重载。"
echo "然后打开侧边栏「咪咕音乐」；推荐先运行 node scripts/sync-macos-account.mjs 自动导入 App 账号。"
