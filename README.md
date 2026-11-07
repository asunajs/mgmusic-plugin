# mgmusic-plugin —— 咪咕音乐金币中心（QuickJS / Node 插件）

`mgmusic-plugin` 是 GitHub 项目/发布包名；面板里注册的插件 id 是 **`mgmusic`**。插件提供以下能力：

- **daily 定时任务**：每天 00:05 / 12:05 / 22:05 执行 login-access、签到、qsq、zyd-sign、窗口打卡、听歌补报、领奖；任务之间随机等待 1–3 秒
- **report 手动任务**：补报一次 `song-duration` 并领取已达档位
- **macOS App 账号同步**：从已登录的咪咕 App 读取真实 uid/msisdn，自动生成 ce；不再手动抓包
- **自带配置页**：账号卡片、短信登录、签到 / 查询按钮、状态查询、立即执行、补报、签名自检；任务间隔可调

## 页面

> 设计原则：读取只用于判断状态（身份、任务进度、听歌时长），任务脚本最终必须落到写操作；不再提供“只读模式”。

面板页不再把 `config.json` 直接铺成一个大文本框，改成三块：

- **账号**：账号卡片（手机号 / uid 脱敏、登录来源、会话 cookie 有无）；「添加账号」走手机号 + 短信验证码；每个账号可单独签到、单独查询、改名、改补报目标、删除。
- **运行**：查询状态 / 立即执行 daily / 补报；会执行登录、任务上报和领奖。
- **管理设置默认隐藏**：App 同步、超时、TLS、证书、评论等属于维护者选项，普通用户看不到；维护者在 URL 后加 `?admin=1`（或 `#admin`）才会显示。
- **只读功能已移除**：不再提供普通用户或管理页的只读开关；旧配置里的 `readonly` 字段会被忽略并清掉。

uid / deviceid / ce 由短信登录或 App 同步自动维护，不需要用户手填。

页面主题由 `boot.js` 跟随面板：读取同源 localStorage 的 `panel-theme-v2`，并监听 `storage` 事件；面板切深/浅色时插件页即时同步，不需要刷新。



## 日志与推送

### 日志

`daily` 每次运行都会记录：

- 开始：账号数量
- 身份校验：uid / 昵称（脱敏）
- 期初：音符、任务数
- 每个动作：`login-access`、签到、`task-report`、评论、听歌补报、领奖
- 每个任务的跳过原因：已完成 / 非窗口时段 / 补报关闭
- 结果：音符 `before→after`、完成数、领取数、动作数、跳过数、失败数
- 汇总：账号数、失败账号数、签到数、领取数、耗时

失败行走 `fail` 日志，正常结果走 `success` / `info`。面板「运行记录 → 日志」和推送正文里都能看到这些行。

### 推送

推送是**面板级**的，不要求插件自己配 webhook：

1. 面板「设置 → 推送」里配置渠道；
2. 打开「失败时通知」；需要成功通知时再打开「成功时通知」；
3. 「正文带日志」选「仅错误」或「全部」，推送里就会带这次运行的结论和日志；
4. 面板任务卡上的摘要会由插件动态更新为：
   `1 个账号 · 音符 5→5 · 完成 3/9 · 领取 +0`

插件在**任一账号或任务动作失败**时会让 `daily` 任务失败，从而触发面板的失败推送；全部正常时不会伪造失败。手动点插件页的「立即执行 daily」走插件路由，不经过面板调度器，所以不会额外发一条面板推送；定时 `daily` 会正常触发。


## 文件

| 文件 | 作用 |
|---|---|
| `mgmusic.js` | 插件后端（QuickJS / ESM，安装到 `plugins/js/mgmusic.js`） |
| `index.html` / `app.js` / `style.css` / `boot.js` | 插件配置页（安装到 `plugins/mgmusic/`） |
| `config.example.json` | 配置模板（安装到插件数据目录，首次安装时复制） |
| `scripts/sync-macos-account.mjs` | 从已登录的 macOS 咪咕 App 同步真实 uid/msisdn 到插件数据根 |
| `install.sh` | 一键安装到本机面板 |

## 面板商城

已收录到 `rust-plugin-panel` 的插件商城：打开「插件列表 → 插件商城」，找到
「咪咕音乐金币中心」点安装即可。条目 id 是 `mgmusic`，仓库是
[`asunajs/mgmusic-plugin`](https://github.com/asunajs/mgmusic-plugin)，Release 里挂的是
面板能直接解压的 zip。

也可以手动下载 [`mgmusic-plugin-0.1.1.zip`](https://github.com/asunajs/mgmusic-plugin/releases/download/v0.1.1/mgmusic-plugin-0.1.1.zip)
后在「插件管理 → 上传」里安装。

> 本地开发版是 **0.3.3**（短信登录 + 签到 + 评论 + 随机任务间隔；已发布到商城）。

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
cp mgmusic.js  "$PLUGINS_DIR/js/"
# 2) 配置页
mkdir -p "$PLUGINS_DIR/mgmusic"
cp index.html app.js style.css boot.js "$PLUGINS_DIR/mgmusic/"
# 3) 配置（首次）
mkdir -p "$PLUGIN_DATA_DIR/mgmusic"
cp config.example.json "$PLUGIN_DATA_DIR/mgmusic/config.json"
```

面板会在 30 秒内（通常更快）扫描到新插件；也可以在「插件列表」里点重载。
打开侧边栏「咪咕音乐」即可进入配置页。

> 只上传后端 `mgmusic.js`（单文件安装）也能跑定时任务；此时侧边栏入口会 404，
> 配置请用面板「插件列表 → 配置」的通用编辑器。要配置页就一起装 UI 目录。

### 从旧名迁移

旧版叫 `cmusic-plugin`，上一版面板 id 叫 `mgmusic-plugin`。现在面板 id 统一为
`mgmusic`，`install.sh` 会自动：

- 把旧后端 `mgmusic-plugin.js` 停用为 `.bak-rename`；
- 把旧 UI 目录 `plugins/mgmusic-plugin/` 停用为 `.bak-rename`；
- 把数据目录 `plugin-data/mgmusic-plugin/` 迁到 `plugin-data/mgmusic/`；
- 更早的 `cmusic-plugin/config.json` 也会兼容迁移。

仓库名、GitHub Release 资产名仍可以是 `mgmusic-plugin-*`；那是项目和发布包的名字，
不是面板里的插件 id。

## 自动获取真实 uid（短信登录，默认）

网页 passport 登录只返回 `LTToken` / `USessionID`，**不返回 uid**；用 `uid=0` 会被 H5 当成游客/其他账号，导致“任务显示已领、豆没到账”。0.1.8 的短信登录流程是：

1. 手机号 + 验证码走 passport `/authn/dynamicpassword`，确认号码归属；
2. 登录成功后，用 `msisdn` 生成临时 `ce` 调 `/v2.0/user/getMyPage.do`，由服务端返回真实 `userId`；
3. 用真实 uid + msisdn + deviceid 重建 `ce` 并保存设备；
4. 后续每次 `status` / `run` 都调 `getMyPage` 做 **身份硬校验**；服务端返回的 `userId` 与配置不一致时，**本轮拒绝任何写操作**。

这条路径不依赖 macOS App，普通用户只需要手机号和短信验证码。

### 可选：从已登录的 macOS App 同步

本机已登录 macOS 咪咕 App 时，可以跳过短信验证码：

```bash
node scripts/sync-macos-account.mjs
```

生成 `<PLUGIN_DATA_DIR>/mgmusic/app-account.json`（只写 uid/msisdn/deviceid，不写 passId/token），插件会自动导入。App 账号变化后重新运行一次即可；cron 可定时刷新，launchd 默认没有 App 容器读取权限，若用 launchd 需给 node 完全磁盘访问。

## 配置

`<PLUGIN_DATA_DIR>/mgmusic/config.json`：

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
  "task_interval": {
    "min_ms": 1000,
    "max_ms": 3000
  },
  "cert": "",
  "tls": "",
  "comment": {
    "enabled": true,
    "song_id": "600929000006498997",
    "content": "好听",
    "resource_type": "2",
    "comment_info": "",
    "target_comment_id": "",
    "log_id": "",
    "fk_token": "",
    "source": "app",
    "mode": "android",
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
| `task_interval` | 任务之间的随机等待，默认 1000–3000ms；设 `max_ms=0` 关闭；墙钟超过 45s 后自动不再等待，避免撞面板 60s 预算 |
| `cert` | 可选；默认用内置证书 hex 前 32 字符；换证书时填完整 hex |
| `tls` | 空 = 默认 rustls；`native` = 平台 TLS（老网关） |
| `comment.enabled` | 默认 `true`；Android 头已实测可发评论并完成任务，daily 会执行 |
| `comment.song_id` | 要评论的歌曲 contentId；默认 `600929000006498997` |
| `comment.content` | 评论内容，默认 `好听` |
| `comment.resource_type` | 默认 `2`（歌曲资源；用 `2021` 评论歌单不计数） |
| `comment.comment_info` | 可选；填了就直接作为 `commentInfo` 字段，覆盖 `content` |
| `comment.fk_token` | Android 头可留空；iOS 头需要 App 生成的 token |
| `comment.mode` | `android` = Android V005 头（默认、实测可用）；`ios` = iOS 头；`h5` = H5 头（回 `870001`） |
| `comment.body` | 可选；填对象则直接作为请求体，便于抓包后校准 |
| `comment.extra` | 可选；合并进默认请求体的额外字段 |

配置页里的「填入模板」会生成一份占位配置；正常使用直接走上面的「短信登录」，不需要再手填 `uid` / `deviceid` / `ce`。

## 短信登录（自动凭证）

面板打开「咪咕音乐」→「短信登录」：

1. 填 11 位手机号，点「发送验证码」；
2. 收到 6 位码后填入，点「登录并保存」；
3. 插件自动请求 passport 公钥、RSA 加密手机号/验证码、校验登录；
4. 登录成功后用手机号调 `/v2.0/user/getMyPage.do` 解析真实 uid，再用真实 uid 生成
   `uid` / `msisdn` / `deviceid` / `ce` 写进 `devices`。拿不到真实 uid 时只报错、不保存设备。

发码限流按手机号分别计算：账号 A 发过验证码，不会阻止账号 B 发码；关闭/重新打开
「添加账号」会清空上一位账号的重发倒计时。

这条走的是 **passport 网页版短信登录**（`/password/publickey` +
`/login/dynamicpassword` + `/authn/dynamicpassword`），不是 App 的 DUP SDK；
不需要手动抓包，也不需要手填 uid/deviceid/ce。

说明：

- ⚠️ 不要用 `uid=0`：2026-11-05 实测 H5 会把 `uid=0` 当游客/其他账号
  （`userId=0`，返回的 msisdn/余额都不是本人），会写错账号。
- 金币中心 H5 的 `ce` 必须用真实 uid；真实 uid 由 `getMyPage` 按手机号解析，不依赖 macOS App。
- 登录成功后会自动用新凭证做一次 H5 查询；能查到音符/任务就说明凭证可用。
- 短信验证码只用于确认手机号归属；手机号、uid、ce 都属于敏感信息，只写插件数据目录，不要贴到聊天/仓库。
- 这条路径在 QuickJS 下即可跑，不需要把面板切到 Node。
- QuickJS 内已验证 passport 公钥请求 + RSA 加密（1024-bit，输出 256 字符 hex，和网页 JS 的 RSAKey.encrypt 一致）；H5 查询用抓包 ce 变体验证过。

## 任务

| 任务 | 调度 | 说明 |
|---|---|---|
| `daily` | `0 5 0,12,22 * * *` | 00:05 / 12:05 / 22:05；签到 + qsq + zyd-sign + 窗口打卡 + 听歌补报 + 领奖；未配置 devices 时记一条 warn 并跳过 |
| `sign` | 手动「签到」按钮；`daily` 里自动执行 | 普通账号 `GET /act-jbzx/sign/status` + 未签时 `POST /act-jbzx/sign`；新号自动走 `new-user-receive/status` + `POST new-user-receive`；`200013` 最终仍无资格时记为跳过 |
| `report` | 手动（面板建任务或配置页按钮） | 补报一次 `song-duration`，随后领奖 |
| `comment` | 手动「评论一次」；`daily` 里 `comment.enabled=true` 时也会执行 | Android V005 头已实测；默认开启，任务完成即跳过 |

协议事实（2026-10-15 实测）：

- `songTime` 按 `ce` 记账；上报/领奖必须同一 `ce`
- 所有接口幂等，重复 report 无副作用
- 领取/查询接口不需要 sign；`song-duration` 需要 V005 sign
- `qsq` / `zyd-sign` 是纯上报即发币；打卡窗口外静默不记
- 签到是独立接口 `/act-jbzx/sign`，不在任务列表里；`sign/status` 返回 `isSign`、`signNum`、7 天奖励
- 新人 7 天签到走 `/act-jbzx/new-user-receive/status` + `POST /act-jbzx/new-user-receive`（body `{}`）；新账号实测返回 `scoreNum=6`，普通 `/sign` 对这类账号回 `200013 暂无法参与`
- **评论任务不走 `task-report`**：2026-11-05 实测评论后 `completeTime=1`，但没有 `task-report` 请求；评论是 App 侧评论事件记账
- 评论接口已按 2026-11-05 App 真实抓包修正 host/body；2026-11-06 用 Android V005 头实测发评论成功，任务 1/1、音符 +5

## 验证

- 签名向量 10/10（QuickJS 26ms）
- 面板内实测：普通账号完成 `login-access`、签到状态、qsq、zyd-sign、30 分钟补报、7 档领奖
- 2026-11-06 评论实测：Android V005 头 + 空 `fkToken` → `000000`，任务 1/1，音符 64→69
- 2026-11-06 签到实测：普通账号签到已签；新账号走新人签到 `new-user-receive`，`scoreNum=6`
- 配置页「签名自检」：`mgSign("hello") = 0B646EAD2072F5A932D2F0A742BE72ED`

## 评论（Android V005 头，实测可用，不单独放按钮）

2026-11-05 抓到 App 真实评论请求；2026-11-06 在测试账号上实测成功：

```text
POST https://app.pd.nf.migu.cn/user/api/comment/add/v2.0
{"code":"000000","info":"操作成功","data":{"reportId":"<uuid>"}}
```

随后 `每日评论任意歌曲: 1/1`，音符 `64→69`（+5），没有 `task-report` 请求。

真实 body（顶层评论）：

```json
{
  "source": "app",
  "userId": "<H5 uid>",
  "fkToken": "",
  "resourceId": "600929000006498997",
  "resourceType": "2",
  "commentInfo": "好听"
}
```

要点：

- host 是 `app.pd.nf.migu.cn`，不是 `app.c.nf.migu.cn`；
- `source` 固定 `app`，body 不塞 `logId`；
- **Android 头 + 内置 `mgSign(path+ce+ts+body)` 可用**，`fkToken` 留空也能过；
- `resourceType` 用 `2`（歌曲）；用 `2021` 评论歌单时接口成功但不计任务；
- `userId` 用 H5 uid 即可，不需要 App 的 19 位用户域 id；
- 回复评论才需要 `targetCommentId` / `mainCommentId`。

`comment.mode=android` 是默认路径；`ios` 头仍需要 App 生成 `fkToken`，不作为默认。评论不再放账号卡片按钮，由 daily 在任务未完成时自动处理；任务完成后自动跳过。原 Python 把评论列为“行为核销型不可伪造”，这次走的是 Android 客户端等价请求，不是伪造客户端事件。

## 说明 / 边界

- 咪咕接口对 `Accept-Encoding` 敏感：插件统一发 `identity`；如果上游仍回 gzip，会明确报错而不是静默乱码。
- 配置里有 `ce` / `msisdn` / `cookie`，属于敏感信息；它放在插件数据目录（不会被 `/plugins/` 静态服务），不要提交到 git。
- 该插件只用 ECMAScript + `host-api` + `node:fs`（QuickJS 内置）；不要引入 `fetch` / `URL` / `TextEncoder` / `crypto`，QuickJS 没有。
- 面板版本要求：`host-api` 带 `register_route` / `register_nav` 的版本（本仓库 0.3.0 实测）。

- daily cron 预算 120 秒，每个阶段都会写日志，不会只在最后一次性输出。
