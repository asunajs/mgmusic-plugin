#!/usr/bin/env bash
# 把 mgmusic 安装到本机插件面板。
#
# 仓库/发布包名叫 mgmusic-plugin；面板里注册的插件名是 mgmusic。
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
PLUGIN="mgmusic"
OLD_PLUGIN="mgmusic-plugin"

echo "PLUGINS_DIR     = $PLUGINS_DIR"
echo "PLUGIN_DATA_DIR = $PLUGIN_DATA_DIR"

mkdir -p "$PLUGINS_DIR/js" "$PLUGINS_DIR/$PLUGIN"

# 后端：文件名就是面板里的插件 id，所以必须叫 mgmusic.js。
cp "$HERE/mgmusic.js" "$PLUGINS_DIR/js/$PLUGIN.js"
cp "$HERE/index.html" "$HERE/app.js" "$HERE/style.css" "$HERE/boot.js" "$PLUGINS_DIR/$PLUGIN/"

# 旧 id 的 backend/UI 不能继续被扫描，否则会同时加载两个插件。
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
if [ ! -f "$NEW_DATA/config.json" ]; then
  cp "$HERE/config.example.json" "$NEW_DATA/config.json"
  echo "已写入配置模板：$NEW_DATA/config.json"
else
  echo "保留已有配置：$NEW_DATA/config.json"
fi

echo
echo "完成。面板会在 30 秒内扫描到新插件；也可以在「插件列表」里点重载。"
echo "然后打开侧边栏「咪咕音乐」，用手机号 + 短信验证码添加账号即可；macOS App 同步是可选项。"
