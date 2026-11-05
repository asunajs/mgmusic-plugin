# mgmusic-plugin —— 咪咕音乐金币中心（QuickJS / Node 插件）

`mgmusic-plugin` 是插件面板的 JS 插件，提供以下能力：

- **daily 定时任务**：每天 00:05 / 12:05 / 22:05 执行 login-access、qsq、zyd-sign、窗口打卡、听歌补报、领奖
- **report 手动任务**：补报一次 `song-duration` 并领取已达档位
- **macOS App 账号同步**：从已登录的咪咕 App 读取真实 uid/msisdn，自动生成 ce；不再手动抓包
- **自带配置页**：设备列表、状态查询、立即执行、补报、签名自检

## 文件

| 文件 | 作用 |
|---|---|
| `mgmusic-plugin.js` | 插件后端（QuickJS / ESM，安装到 `plugins/js/`） |
| `index.html` / `app.js` / `style.css` | 插件配置页（安装到 `plugins/mgmusic-plugin/`） |
| `config.example.json` | 配置模板（安装到插件数据目录，首次安装时复制） |
| `scripts/sync-macos-account.mjs` | 从已登录的 macOS 咪咕 App 同步真实 uid/msisdn 到插件数据根 |
| `install.sh` | 一键安装到本机面板 |

## 面板商城

已收录到 `rust-plugin-panel` 的插件商城：打开「插件列表 → 插件商城」，找到
「咪咕音乐金币中心」点安装即可。条目 id 是 `mgmusic-plugin`，仓库是
[`asunajs/mgmusic-plugin`](https://github.com/asunajs/mgmusic-plugin)，Release 里挂的是
面板能直接解压的 zip。

也可以手动下载 [`mgmusic-plugin-0.1.1.zip`](https://github.com/asunajs/mgmusic-plugin/releases/download/v0.1.1/mgmusic-plugin-0.1.1.zip)
后在「插件管理 → 上传」里安装。

> 本地开发版是 **0.1.7**（macOS App 账号同步 + 身份硬校验 + readonly，未发布到商城；商城 Release 仍是 0.1.1）。

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

## 自动获取真实 uid（推荐）

网页 passport 登录只返回 `LTToken` / `USessionID`，**不返回 uid**；用 `uid=0` 会被 H5 当成游客/其他账号，导致“任务显示已领、豆没到账”。0.1.7 改成从 **macOS 咪咕 App 的偏好设置**取当前登录账号：

```bash
# 1) 先打开 macOS 版咪咕音乐并完成登录
# 2) 把 App 当前账号同步到插件数据根（只写 uid/msisdn/deviceid，不写 passId/token）
node scripts/sync-macos-account.mjs
```

生成 `<PLUGIN_DATA_DIR>/mgmusic-plugin/app-account.json` 后，插件在 `status` / `run` 时会自动导入，并：

1. 用真实 uid + msisdn + deviceid 重新生成 `ce`；
2. 调 `/v2.0/user/getMyPage.do` 做 **身份硬校验**；
3. 服务端返回的 `userId` 与配置不一致时，**本轮拒绝任何写操作**（不会再把豆写到错账号）。

> 想让账号变化后自动刷新，可把上面这条命令放进 cron / launchd（例如每 10 分钟一次）。
> 面板把插件运行时切到 **Node** 时，插件也可以直接读 App 偏好设置；QuickJS 下走 `app-account.json` 这条稳定路径。

## 配置

`<PLUGIN_DATA_DIR>/mgmusic-plugin/config.json`：

```json
{
  "app_import": {
    "enabled": true
  },
  "devices": [
    {
      "label": "account-1",
      "uid": "<H5 页 uid 头>",
      "deviceid": "<deviceid 头>",
      "msisdn": "<手机号>",
      "ce": "",
      "topup_min": 30,
      "cookie": "",
      "source": "app-account.json"
    }
  ],
  "topup_min": 30,
  "report_ms": 60000,
  "timeout_ms": 15000,
  "cert": "",
  "tls": "",
  "comment": {
    "enabled": false,
    "song_id": "",
    "content": "好听",
    "resource_type": "2021",
    "comment_info": "",
    "target_comment_id": "",
    "log_id": "",
    "fk_token": "",
    "source": "1",
    "mode": "native",
    "path": "/user/api/comment/add/v2.0",
    "body": null,
    "extra": {}
  }
}
```

| 字段 | 说明 |
|---|---|
| `app_import.enabled` | 是否允许从 `app-account.json` / macOS App 自动同步账号（默认 true） |
| `uid` / `deviceid` / `msisdn` | H5 身份三件套；`deviceid` 必填。`source=app-account.json` 表示由同步脚本写入 |
| `ce` | 可留空，由 `deviceId + uid + msisdn` 按加法 Vigenère 自铸（2026-11-05 H5 实测顺序，无 `ip`） |
| `topup_min` | 每账号听歌补报目标（分钟），`0` = 关闭；账号级覆盖全局 |
| `cookie` | 实测 H5 头有 `mgAppH5CookieId` + `task-session-id`；插件只接受一个字符串，用 `; ` 拼接。领奖/任务上报建议带上，空值未验证 |
| `report_ms` | report 模式默认补报毫秒数（默认 60000） |
| `timeout_ms` | 单次 HTTP 超时（1000–60000） |
| `cert` | 可选；默认用内置证书 hex 前 32 字符；换证书时填完整 hex |
| `tls` | 空 = 默认 rustls；`native` = 平台 TLS（老网关） |
| `comment.enabled` | 默认 `false`；评论功能是实验性，未实测 |
| `comment.song_id` | 要评论的歌曲 contentId；开启评论时必填 |
| `comment.content` | 评论内容，默认 `好听` |
| `comment.resource_type` | 歌曲默认 `2021` |
| `comment.comment_info` | 可选；填了就直接作为 `commentInfo` 字段，覆盖 `content` |
| `comment.mode` | `native` = V005 原生头；`h5` = H5 头；默认 `native` |
| `comment.body` | 可选；填对象则直接作为请求体，便于抓包后校准 |
| `comment.extra` | 可选；合并进默认请求体的额外字段 |

配置页里的「填入模板」会生成一份占位配置；正常使用直接走上面的「短信登录」，不需要再手填 `uid` / `deviceid` / `ce`。

## 短信登录（自动凭证）

面板打开「咪咕音乐」→「短信登录」：

1. 填 11 位手机号，点「发送验证码」；
2. 收到 6 位码后填入，点「登录并保存」；
3. 插件自动请求 passport 公钥、RSA 加密手机号/验证码、校验登录；
   **必须拿到真实 uid** 才生成 `uid` / `msisdn` / `deviceid` / `ce` 写进 `devices`。
   拿不到 uid 时只报错、不保存设备，避免写错账号。

这条走的是 **passport 网页版短信登录**（`/password/publickey` +
`/login/dynamicpassword` + `/authn/dynamicpassword`），不是 App 的 DUP SDK；
不需要手动抓包，也不需要手填 uid/deviceid/ce。

说明：

- ⚠️ 不要用 `uid=0`：2026-11-05 实测 H5 会把 `uid=0` 当游客/其他账号
  （`userId=0`，返回的 msisdn/余额都不是本人），会写错账号。
- 金币中心 H5 的 `ce` 必须用真实 uid；`uid` 仍要从 passport SSO/userinfo 补。
- 登录成功后会自动用新凭证做一次 H5 查询；能查到音符/任务就说明凭证可用。
- 短信验证码只用于确认手机号归属；手机号、uid、ce 都属于敏感信息，只写插件数据目录，不要贴到聊天/仓库。
- QuickJS 内已验证 passport 公钥请求 + RSA 加密（1024-bit，输出 256 字符 hex，和网页 JS 的 RSAKey.encrypt 一致）；H5 查询用抓包 ce 变体验证过。

## 任务

| 任务 | 调度 | 说明 |
|---|---|---|
| `daily` | `0 5 0,12,22 * * *` | 00:05 / 12:05 / 22:05；qsq + zyd-sign + 窗口打卡 + 听歌补报 + 领奖；未配置 devices 时记一条 warn 并跳过 |
| `report` | 手动（面板建任务或配置页按钮） | 补报一次 `song-duration`，随后领奖 |
| `comment` | 手动「评论一次」；`daily` 里 `comment.enabled=true` 时也会执行 | 实验性；默认关闭，未实测 |

协议事实（2026-10-15 实测）：

- `songTime` 按 `ce` 记账；上报/领奖必须同一 `ce`
- 所有接口幂等，重复 report 无副作用
- 领取/查询接口不需要 sign；`song-duration` 需要 V005 sign
- `qsq` / `zyd-sign` 是纯上报即发币；打卡窗口外静默不记
- **评论任务不走 `task-report`**：2026-11-05 实测评论后 `completeTime=1`，但没有 `task-report` 请求；评论是 App 侧评论事件记账
- 评论接口按 `/user/api/comment/add/v2.0` 和 `MGFusionAddCommentDAO` 字段做了实验性实现，**尚未用真实评论请求校准**

## 验证

- 签名向量 10/10（QuickJS 26ms）
- 面板内实测：dummy 设备完成 `login-access`、qsq、zyd-sign、30 分钟补报、7 档领奖
- 配置页「签名自检」：`mgSign("hello") = 0B646EAD2072F5A932D2F0A742BE72ED`

## 评论（实验性，默认关闭）

评论任务不是 `task-report` 能完成的：2026-11-05 实测评论后任务直接变 `1/1`，没有 `task-report`。
插件按 `MGFusionAddCommentDAO` / `MGUserAddCommentNet` 的字段先做了实验性实现：

```text
POST /user/api/comment/add/v2.0
body: { resourceId, resourceType, userId, commentInfo, targetCommentId, logId, fkToken, source }
```

默认 `comment.enabled=false`，不会自动评论。新账号测试顺序：

1. 先只填 `uid/deviceid/msisdn/cookie`，保持 `comment.enabled=false`；
2. 在 App 里手动评论一次，用 Reqable 抓真实请求（路径、body、头、响应）；
3. 把真实请求体填进 `comment.body`，或按抓包修正字段后，再设 `comment.enabled=true`；
4. 点「评论一次」，只点一次；如果返回非 `000000`，不要循环重试，把 HAR 留下来校准。

`comment.mode` 先试 `native`；若服务端要 H5 头，再改 `h5`。`comment.body` 填对象时优先于默认字段。

## 说明 / 边界

- 咪咕接口对 `Accept-Encoding` 敏感：插件统一发 `identity`；如果上游仍回 gzip，会明确报错而不是静默乱码。
- 配置里有 `ce` / `msisdn` / `cookie`，属于敏感信息；它放在插件数据目录（不会被 `/plugins/` 静态服务），不要提交到 git。
- 该插件只用 ECMAScript + `host-api` + `node:fs`（QuickJS 内置）；不要引入 `fetch` / `URL` / `TextEncoder` / `crypto`，QuickJS 没有。
- 面板版本要求：`host-api` 带 `register_route` / `register_nav` 的版本（本仓库 0.2.2 实测）。
