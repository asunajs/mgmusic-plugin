# mgmusic-plugin —— 咪咕音乐金币中心（QuickJS 插件）

`mgmusic-plugin` 是插件面板的 QuickJS 插件，提供以下能力：

- **daily 定时任务**：每天 00:05 / 12:05 / 22:05 执行 login-access、qsq、zyd-sign、窗口打卡、听歌补报、领奖
- **report 手动任务**：补报一次 `song-duration` 并领取已达档位
- **自带配置页**：设备列表、状态查询、立即执行、补报、签名自检

## 文件

| 文件 | 作用 |
|---|---|
| `mgmusic-plugin.js` | 插件后端（QuickJS / ESM，安装到 `plugins/js/`） |
| `index.html` / `app.js` / `style.css` | 插件配置页（安装到 `plugins/mgmusic-plugin/`） |
| `config.example.json` | 配置模板（安装到插件数据目录，首次安装时复制） |
| `install.sh` | 一键安装到本机面板 |

## 面板商城

已收录到 `rust-plugin-panel` 的插件商城：打开「插件列表 → 插件商城」，找到
「咪咕音乐金币中心」点安装即可。条目 id 是 `mgmusic-plugin`，仓库是
[`asunajs/mgmusic-plugin`](https://github.com/asunajs/mgmusic-plugin)，Release 里挂的是
面板能直接解压的 zip。

也可以手动下载 [`mgmusic-plugin-0.1.0.zip`](https://github.com/asunajs/mgmusic-plugin/releases/download/v0.1.0/mgmusic-plugin-0.1.0.zip)
后在「插件管理 → 上传」里安装。

## 安装

面板默认目录（macOS 安装版）：

```text
PLUGINS_DIR      = ~/Library/Application Support/plugin-panel/plugins
PLUGIN_DATA_DIR  = ~/Library/Application Support/plugin-panel/data/plugin-data
```

一键：

```bash
./install.sh
```

或者手动：

```bash
# 1) 后端
cp mgmusic-plugin.js  "$PLUGINS_DIR/js/"
# 2) 配置页
mkdir -p "$PLUGINS_DIR/mgmusic-plugin"
cp index.html app.js style.css "$PLUGINS_DIR/mgmusic-plugin/"
# 3) 配置（首次）
mkdir -p "$PLUGIN_DATA_DIR/mgmusic-plugin"
cp config.example.json "$PLUGIN_DATA_DIR/mgmusic-plugin/config.json"
```

面板会在 30 秒内（通常更快）扫描到新插件；也可以在「插件列表」里点重载。
打开侧边栏「咪咕音乐」即可进入配置页。

> 只上传后端 `mgmusic-plugin.js`（单文件安装）也能跑定时任务；此时侧边栏入口会 404，
> 配置请用面板「插件列表 → 配置」的通用编辑器。要配置页就一起装 UI 目录。

### 从旧名迁移

旧版叫 `cmusic-plugin`。`install.sh` 会在新配置不存在时，把
`<PLUGIN_DATA_DIR>/cmusic-plugin/config.json` 复制到
`<PLUGIN_DATA_DIR>/mgmusic-plugin/config.json`，旧目录不删。装完新插件后，
到面板「插件列表」里把旧的 `cmusic-plugin` 删掉即可。

## 配置

`<PLUGIN_DATA_DIR>/mgmusic-plugin/config.json`：

```json
{
  "devices": [
    {
      "label": "account-1",
      "uid": "<H5 页 uid 头>",
      "deviceid": "<deviceid 头>",
      "msisdn": "<手机号>",
      "ip": "127.0.0.1",
      "ce": "",
      "topup_min": 30,
      "cookie": ""
    }
  ],
  "topup_min": 30,
  "report_ms": 60000,
  "timeout_ms": 15000,
  "cert": "",
  "tls": ""
}
```

| 字段 | 说明 |
|---|---|
| `uid` / `deviceid` / `msisdn` | 真机抓包的 H5 身份三件套；`deviceid` 必填 |
| `ce` | 可留空，由 `uid + ip + msisdn + deviceid` 按加法 Vigenère 自铸 |
| `ip` | 自铸 ce 时用的 IP，默认 `127.0.0.1` |
| `topup_min` | 每账号听歌补报目标（分钟），`0` = 关闭；账号级覆盖全局 |
| `cookie` | 可选；H5 任务通常不需要 |
| `report_ms` | report 模式默认补报毫秒数（默认 60000） |
| `timeout_ms` | 单次 HTTP 超时（1000–60000） |
| `cert` | 可选；默认用内置证书 hex 前 32 字符；换证书时填完整 hex |
| `tls` | 空 = 默认 rustls；`native` = 平台 TLS（老网关） |

配置页里的「填入模板」会生成一份占位配置；把 `uid` / `deviceid` / `msisdn` 换成真机值后保存。

## 任务

| 任务 | 调度 | 说明 |
|---|---|---|
| `daily` | `0 5 0,12,22 * * *` | 00:05 / 12:05 / 22:05；qsq + zyd-sign + 窗口打卡 + 听歌补报 + 领奖；未配置 devices 时记一条 warn 并跳过 |
| `report` | 手动（面板建任务或配置页按钮） | 补报一次 `song-duration`，随后领奖 |

协议事实（2026-10-15 实测）：

- `songTime` 按 `ce` 记账；上报/领奖必须同一 `ce`
- 所有接口幂等，重复 report 无副作用
- 领取/查询接口不需要 sign；`song-duration` 需要 V005 sign
- `qsq` / `zyd-sign` 是纯上报即发币；打卡窗口外静默不记

## 验证

- 签名向量 10/10（QuickJS 26ms）
- 面板内实测：dummy 设备完成 `login-access`、qsq、zyd-sign、30 分钟补报、7 档领奖
- 配置页「签名自检」：`mgSign("hello") = 0B646EAD2072F5A932D2F0A742BE72ED`

## 说明 / 边界

- 咪咕接口对 `Accept-Encoding` 敏感：插件统一发 `identity`；如果上游仍回 gzip，会明确报错而不是静默乱码。
- 配置里有 `ce` / `msisdn` / `cookie`，属于敏感信息；它放在插件数据目录（不会被 `/plugins/` 静态服务），不要提交到 git。
- 该插件只用 ECMAScript + `host-api` + `node:fs`（QuickJS 内置）；不要引入 `fetch` / `URL` / `TextEncoder` / `crypto`，QuickJS 没有。
- 面板版本要求：`host-api` 带 `register_route` / `register_nav` 的版本（本仓库 0.2.2 实测）。
