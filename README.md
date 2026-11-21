# mgmusic-plugin —— 咪咕音乐金币中心（panel-llrt / LLRT 插件）

`mgmusic-plugin` 是 GitHub 项目/发布包名；面板里注册的插件 id 是 **`mgmusic`**。插件提供以下能力：

- **daily 定时任务**：每天 00:05 / 12:05 / 22:05 执行 login-access、签到、qsq、zyd-sign、窗口打卡、听歌补报、领奖；任务之间随机等待 1–3 秒
- **report 手动任务**：补报一次 `song-duration` 并领取已达档位
- **移动云盘联动（0.6.0）**：账号直接从云盘插件那拿（那边维护续期），一键同步；不想联动的账号可单独禁用；短信登录并存
- **移动云盘 auth 登录**：粘贴移动云盘登录态里的 `Authorization`，换咪咕登录并保存 uid/ce（0.6.0 起降级为手动兜底）
- **macOS App 账号同步**：从已登录的咪咕 App 读取真实 uid/msisdn，自动生成 ce；不再手动抓包
- **自带配置页**：账号卡片、短信登录 / 云盘 auth 登录、签到 / 查询按钮、状态查询、立即执行、补报、签名自检；任务间隔可调

## 页面

> 设计原则：读取只用于判断状态（身份、任务进度、听歌时长），任务脚本最终必须落到写操作；不再提供“只读模式”。

面板页不再把 `config.json` 直接铺成一个大文本框，改成三块：

- **账号**：账号卡片（手机号 / uid 脱敏、登录来源、会话 cookie 有无）；「添加账号」走手机号 + 短信验证码；每个账号可单独签到、单独查询、改名、改补报目标、删除。
- **运行**：查询状态 / 立即执行 daily / 补报；会执行登录、任务上报和领奖。
- **管理设置默认隐藏**：App 同步、超时、TLS、证书、评论等属于维护者选项，普通用户看不到；维护者在 URL 后加 `?admin=1`（或 `#admin`）才会显示。
- **只读功能已移除**：不再提供普通用户或管理页的只读开关；旧配置里的 `readonly` 字段会被忽略并清掉。

uid / deviceid / ce 由短信登录或 App 同步自动维护，不需要用户手填。

### 和移动云盘联动（0.6.0 起，替代贴 auth）

用户口径：「咪咕那边没有对 auth 的维护，但是云盘这边有」 —— 所以账号不再靠人贴，
**直接从云盘插件那拿**。云盘那套 30 天自动续期直接受益，咪咕这边一劳永逸。

- **存哪儿**：一条也不存。每次同步/重换票都**现读**云盘插件的账号表：
  `<data>/plugin-data/mcloud/shared.json` 里的 `mcloud.accounts`
  （路径是面板仓 `docs/architecture.md` §3 的约定：`join(dirname(自己的 data_dir), 'mcloud')`）。
  所以云盘续期之后，咪咕下次同步拿到的就是新凭据。
- **怎么认账号**：先按 `mcloudId`（云盘账号 id），再按手机号 —— 老账号（短信登录建的）
  没有 `mcloudId`，只按 id 找会再造一台重复的。
- **幂等**：已经同步过、身份齐全的账号，**一次上游请求都不发**；再点一次「从云盘同步」是
  `新建 0 / 认回 N`。
- **禁用某条**：`link_disabled`（云盘账号 id **或**手机号，两个都认）。语义只有一条 ——
  **跳过该账号从云盘联动**：不新建、不更新、不重换票；**已经存在的咪咕账号原样保留照旧跑**
  （禁用不是删除）。取消禁用后下次同步恢复跟随。
- **失效自救**：联动账号身份校验不过时，用云盘**当前**凭据重换一次票并重试一次。
  不做预防性换票 —— 换票会造新会话，而抓包文档写明票据重放/会话叠加**未测**。
- **读不到怎么办**：云盘插件没装/文件读不出来 ⇒ 界面说清原因，短信账号照旧可用，
  **一个账号都不动**（「云盘暂时读不到」和「云盘真删了」在文件层面长得一样）。
- 手贴 `Authorization` 那条路**保留**，降级到弹窗里的「手动兜底」折叠区 ——
  云盘插件没装时才需要。

离线自检（不联网）：`npm run check:link` —— 跑同步 / 幂等 / 禁用 / 降级四条口径。

### 移动云盘 auth 登录（0.5.1，0.6.0 起降级为手动兜底）

添加账号对话框里除了短信登录，还可以粘贴移动云盘的 `Authorization`（`Basic ...`，或解码后的
`pc:手机号:token`）。插件只在本次请求里用它换票，**不会把这段 Authorization 写进配置**；
换票成功后只保存 `msisdn` / `uid` / `deviceid` / `ce`，来源标记为「云盘授权」。

换票链路已按咪咕移动 SDK 的 CMCC 登录实测校准：

1. 用云盘 Authorization 向云盘统一认证按 `toSourceId=012008` 换临时票据；
2. 票据加 `ANDT` 前缀，调咪咕 `/user/h5/token-validate/v3.0?type=2&sourceId=220029`；
3. 返回 `userId` 后按现有规则生成 `ce` 并保存账号。

云盘 auth 失效或账号未开通相应能力时，界面会直接显示上游错误，不会静默保存半个账号。

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
| `src/mgmusic.js` | 插件后端源（LLRT / ESM） |
| `src/webui/` | 插件配置页源（`index.html` / `app.js` / `style.css` / `boot.js`） |
| `mgmusic.panel.json` | 清单（`version` / `min_panel` / 配置字段）—— 真源在仓库根 |
| `scripts/build-panelllrt.mjs` | 构建：`src/` → `dist/panel-llrt/`（`mgmusic.js` + 清单 + `mgmusic.webui/`） |
| `scripts/pack-panelllrt.mjs` | 打发布 zip：`dist/mgmusic-plugin-<ver>-panel<NN>.zip`（NN 由 `min_panel` 推） |
| `scripts/deploy-panel.sh` | 装进本机实例的插件目录（默认 `~/panel-3030/plugins`） |
| `scripts/check-link.mjs` / `scripts/test-config.mjs` | 自检：云盘账号联动 / 配置存储回归 |
| `install.sh` | 一键安装到本机面板（装的是 `dist/panel-llrt/`） |
| `types/` + `tsconfig.{webui,node}.json` | 类型检查通道（契约副本由面板同步，见 `panel-plugins/docs/UNIFY.md`） |

> **旧面板（0.3.x / QuickJS）那套布局已删除**：仓库根不再有 `mgmusic.js` / `index.html` /
> `app.js` / `style.css` / `boot.js` / `config.example.json`，也不再支持 `plugins/js/` 那种装法。
> 只有 LLRT 一条线。

## 面板商城

已收录到 `rust-plugin-panel` 的插件商城：打开「插件列表 → 插件商城」，找到
「咪咕音乐金币中心」点安装即可。条目 id 是 `mgmusic`，仓库是
[`asunajs/mgmusic-plugin`](https://github.com/asunajs/mgmusic-plugin)，Release 里挂的是
面板能直接解压的 zip。

也可以在 Release 里下载 `dist/mgmusic-plugin-<ver>-panel<NN>.zip`（`npm run pack` 的产物），
用「插件管理 → 上传」装。**不要再装 0.3.x 那套 `plugins/js/` 的老包** —— 面板已经不支持。

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

或者手动（**先构建**，再拷产物；源码目录不能直接装）：

```bash
npm run build                                  # src/ → dist/panel-llrt/
cp dist/panel-llrt/mgmusic.js           "$PLUGINS_DIR/"
cp dist/panel-llrt/mgmusic.panel.json   "$PLUGINS_DIR/"
rm -rf "$PLUGINS_DIR/mgmusic.webui"
cp -R dist/panel-llrt/mgmusic.webui     "$PLUGINS_DIR/"
```

配置不用手抄模板：插件首次运行会自己写 `$PLUGIN_DATA_DIR/mgmusic/config.json`（0600），
也可以在插件页/面板「配置」页填。

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

**唯一的一份用户配置**：`<PANEL_DATA_DIR>/plugin-data/mgmusic/config.json`（UTF-8 JSON 对象，0600）：

- 面板「插件 → 配置」表单写它（`PUT /api/plugins/mgmusic/config`，面板负责原子写 + 重载插件）；
- 插件自己的页面写它（`POST /plugins/mgmusic/api/config`，同样是原子写，不重载）；
- 插件**每次都重新读这个文件**（不缓存），所以谁写完都立刻生效，不存在"内存里还是旧值"。

顶层带 `schema_version`（当前 `1`）。`state` 表只放运行期数据（登录中间态、迁移标记），
**不再存用户配置** —— 0.4.x～0.6.x 那套「面板 config.json 只播种一次、真值藏在 state 表」的双轨制
在 0.7.0 里删掉了，升级时自动迁移（见文末「0.7.0 的配置迁移」）。

```json
{
  "schema_version": 1,
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
| `schema_version` | 配置格式版本，当前 `1`；迁移时由插件补写，不用手填 |
| `uid` / `deviceid` / `msisdn` | H5 身份三件套；`deviceid` 必填。`source` 只是来源标记（`sms` / `mcloud-auth` 等） |
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
- 这条路径在 LLRT 下即可跑（面板本身就是这个运行时）。
- LLRT 内已验证 passport 公钥请求 + RSA 加密（1024-bit，输出 256 字符 hex，和网页 JS 的 RSAKey.encrypt 一致）；H5 查询用抓包 ce 变体验证过。

## CLI（两件套的另一半）

命令行只做**同一份配置**的诊断与查看 —— 读的就是面板表单 / 插件页写的那份
`plugin-data/mgmusic/config.json`（R3：一份配置、一套行为）。

```bash
node src/cli.mjs status            # 账号 / 联动开关 / 关键参数（默认命令）
node src/cli.mjs check             # 校验配置形状；有问题退出码 1
node src/cli.mjs paths             # 配置解析顺序与最终选中的文件
node src/cli.mjs --help | --version
npm run --silent cli -- status --json   # 机器可读（--silent 去掉 npm 自己的两行头，方便管道）
# 更省事：直接 node src/cli.mjs status --json
```

配置来源（先命中先用）：
`--config` → `$MGMUSIC_CONFIG_PATH` → `$PANEL_DATA_DIR/plugin-data/mgmusic/config.json`
→ `~/panel-3030/...`（开发机示例，存在才用）→ `./data/config.json`（存在才用）。

`bin` 名是 `mgmusic`（`npm i -g` / `npx` 可用）。门禁：`npm run check:cli` 跑 6 条冒烟
（版本格式 / 帮助 / 好配置 / 状态脱敏 / paths 选中 / 坏配置退出码 1），已进 `npm run check`。

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

- 签名向量 10/10（LLRT 26ms）
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
- 该插件只用 ECMAScript + `panel:host` + LLRT 提供的 `node:` 子集（见 `types/node-llrt.d.ts`）；
  不要引入 `fetch` / `URL` / `TextEncoder` / `crypto` 这些全局，LLRT 里没有。
- 面板版本要求：见清单 `min_panel`（当前 0.7.0）。

- daily cron 预算 120 秒，每个阶段都会写日志，不会只在最后一次性输出。
## 0.4.x（panel-llrt / LLRT）变体

新面板（`panel-llrt`，Rust + LLRT）用的是**另一套宿主契约**：`import host from 'panel:host'`、
用户配置是插件数据目录里的 `config.json`（面板表单与插件页面同源）、运行期数据才走宿主 sqlite 的
`state` 表、WebUI 走 `register_web` + `/app.css` + `<p-*>` 套件。
差异有 200 多处且不机械，所以 **单独维护一份源**（`src/`），不做构建期转换。

```text
src/mgmusic.js                       唯一实现（LLRT；0.3.x 那份已随旧面板删除）
src/webui/{index.html,style.css,app.js,boot.js}
scripts/build-panelllrt.mjs           src/ → dist/panel-llrt/{mgmusic.js, mgmusic.webui/}
scripts/deploy-panel.sh               dist/ → 面板实例的 plugins/（含样式门禁 + 逐个 cmp）
```

**分工**：面板提供面板，插件（源码/构建/部署）归本仓 —— 面板仓 `panel-llrt` 里没有这个插件的代码。

```bash
npm run build:panelllrt      # 只构建，产物在 dist/panel-llrt/（已被 .gitignore 忽略）

npm run deploy:panel         # 构建 → 样式门禁 → 装进 $PANEL_PLUGINS_DIR（默认 ~/panel-3030/plugins）
PANEL_PLUGINS_DIR=/opt/panel/plugins npm run deploy:panel     # 装到别处
bash scripts/deploy-panel.sh --restart                        # 装完顺手重启 launchd 服务
```

装完要让它生效：面板界面插件卡点「重载」（只影响这一个插件），或 `--restart` 重启整个服务。
**账号在插件自己的 `config.json` 里**（`plugin-data/mgmusic/config.json`）：重装/重载插件都不会碰它，
只有删掉这个文件才会回到「没有账号」（详见 panel-llrt 仓的 `docs/mgmusic-migration.md`）。

相对已废弃的 0.3.x，行为差异（都是环境层收敛）：任务只有 `daily` 一条（签到/评论/补报走 HTTP 路由）、
不写任务摘要、不再有「macOS App 账号同步」（0.3.x 那个读 App plist 的选项已删）。

## 发布（面板 0.4 的 zip，0.5.0 起）

资产名 `mgmusic-plugin-<version>-panel<NN>.zip`（NN 由清单 `min_panel` 推，当前 0.7.0 → `panel07`），挂在
<https://github.com/asunajs/mgmusic-plugin/releases>；同目录还有 `.sha256`。

```bash
npm run build:panelllrt     # src/ → dist/panel-llrt/（mgmusic.js + mgmusic.webui/ + 清单）
npm run pack:panel04        # → dist/mgmusic-plugin-<version>-panel04.zip（+ .sha256、SHA256SUMS）
```

**必须从干净 worktree/tag 打**：`scripts/zip.mjs` 固定 DOS 时间戳，同输入同 sha256 ——
但在脏工作树里打，包里会混进未提交的改动，发布出去的 sha256 就和干净树对不上。

### 面板的「插件配置」表单

`src/mgmusic.panel.json` 现在带 `config.fields`，插件卡片 → **配置** 是一张表单（不再是裸 JSON）：

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `topup_min` | number | 30 | 每账号听歌补报目标（分钟），`0` = 不补报 |
| `timeout_ms` | number | 15000 | 单次请求超时（1000–60000） |
| `report_ms` | number | 60000 | 手动「补报」一次上报多长的听歌时长 |
| `tls` | select | 空 | 只有默认那条握不上手时才选 `native` |

这四格和插件页面写的是**同一份 `config.json`**（0.7.0 起）：面板保存 = 原子写文件 + 重载插件，
插件下一次运行（含定时 daily）读到的就是新值；反过来在插件页面改完，面板这张表单刷新一下看到的
也是同一份。表单只覆盖标量，**账号列表不会被动到** —— 面板按清单里的 `fields` 合并，只改声明过的键。

### 0.7.0 的配置迁移

0.6.x 及以前：面板 `config.json` 只在首次加载时「播种」一次，之后真值在宿主 `state` 表的
`mgmusic.config` 键里。0.7.0 起只有上面那一份文件，升级时插件在**加载期做一次**迁移：

1. 读磁盘 `config.json`（坏 JSON → 原样改名成 `config.json.bad-<时间戳>` 留档，按「没有文件」处理）；
2. 读旧 `state` 里的 `mgmusic.config`；
3. 合并：**state 优先、文件补缺**（标量取 state 的、devices 按 `ce` / `uid+msisdn` 并集去重）；
4. 文件本来就在就先备份 `.bak-migrate-<时间戳>`，再原子写 0600；
5. 旧 state 收尾：原文存进 `mgmusic.config.legacy`（只读备份，插件不读）→ 删 `mgmusic.config`
   → 删老的双轨标记 `mgmusic.seed_marker` → 打 `mgmusic.migration_v1`。

**幂等**：`mgmusic.migration_v1` 在就整个跳过。`mgmusic.login_pending`（登录中间态）不参与迁移，
原样留在 `state` 里。

**用户侧没有额外动作**：这段是插件**加载时自己跑**的，换上新版本（面板里上传 / 商店更新 / 手放文件
再重载）就完成了 —— 不需要 `cp`、不需要删 state 键、不需要"先放文件再启动"。（只有维护者
在那台机器上手动升级插件时才需要点一下「重载」/ 重启，那是升级动作本身，不是迁移步骤。）

几条兜底，都是为用户留的：

- **坏 JSON**：原样改名 `config.json.bad-<时间戳>` 留档，按"没有文件"继续迁 —— 插件不会因为
  用户手改坏了一个字符就起不来。
- **文件比插件新**（用户升了插件又回退到旧版）：`schema_version` 更大时**只读使用**，不改写、
  不迁移 —— 旧版覆盖新版才是真的数据损失。日志会 warn 一行「请升级插件」。
- **回退到 0.6.x 也不会丢账号**：0.6.x 的播种读的就是同一个文件（`host.self_config()`），
  旧 state 那份原文也还在 `mgmusic.config.legacy` 里。
- **迁移失败不挡加载**：写文件失败只 warn，插件照常加载（配置读不出来时接口会给出带路径的错），
  下次加载重试（标记没打上）。
