#!/usr/bin/env node
/// 咪咕音乐插件的**命令行**（面板插件 + CLI 两件套里的 CLI）。
///
/// 定位：面板里的定时任务在 LLRT 里跑；这个 CLI 只做**同一份配置**的诊断与查看 ——
/// 读的是 `plugin-data/mgmusic/config.json`（与面板表单、插件页同一份，见 R3）。
///
///   node src/cli.mjs status [--json]      # 账号 / 联动开关 / 关键参数
///   node src/cli.mjs check  [--json]      # 配置形状校验（坏配置非零退出）
///   node src/cli.mjs paths                # 配置解析顺序与最终选中的路径
///   node src/cli.mjs link                 # 云盘联动清单（谁被禁用）
///   node src/cli.mjs link off <id|手机号>  # 禁用某个云盘账号的联动（= 面板里的「禁用」）
///   node src/cli.mjs link on  <id|手机号>  # 恢复联动（= 面板里的「启用」）
///   node src/cli.mjs --help | --version
///
/// 配置来源（先命中先用）：
///   ① --config <path>   ② $MGMUSIC_CONFIG_PATH
///   ③ $PANEL_DATA_DIR/plugin-data/mgmusic/config.json
///   ④ ~/panel-3030/data/plugin-data/mgmusic/config.json（开发机示例，存在才用）
///   ⑤ ./data/config.json（独立跑，存在才用）
import { chmodSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
const NAME = 'mgmusic';

const HELP = `咪咕音乐插件 CLI（与面板插件共用同一份 config.json）

用法：
  ${NAME} [命令] [选项]

命令：
  status          账号 / 云盘联动开关 / 关键参数（默认命令）
  check           校验配置形状；有问题退出码 1
  paths           打印配置解析顺序与最终选中的文件
  link            云盘联动清单（每个云盘账号跟不跟着同步）
  link off <key>  禁用某个云盘账号的联动：key 是云盘账号 id 或手机号
  link on  <key>  恢复联动（与面板里的「禁用 / 启用」是同一份 link_disabled）

选项：
  --config <path> 指定配置文件（等价 $MGMUSIC_CONFIG_PATH）
  --data-dir <dir> 指定插件数据目录（内部按 <dir>/config.json 找）
  --json          机器可读输出
  -h, --help      这条帮助
  -v, --version   版本（取自 package.json）

退出码：0 正常 · 1 配置有问题 · 2 用法错误 · 3 找不到配置
`;

function die(msg, code = 2) {
  console.error('❌ ' + msg);
  process.exit(code);
}

const argv = process.argv.slice(2);
let cmd = 'status';
let wantJson = false;
let configFlag = '';
let dataDirFlag = '';
/** 命令后的位置参数（`link off <key>` 里的 `off` 和那个 key）。 */
const cmdArgs = [];
/** 第一个位置参数是命令；后面的都进 cmdArgs。选项的值由上面的 ++i 吃掉，不会走到这里。 */
let sawCommand = false;

for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i];
  if (a === '-h' || a === '--help') { process.stdout.write(HELP); process.exit(0); }
  if (a === '-v' || a === '--version') { console.log(PKG.version); process.exit(0); }
  if (a === '--json') { wantJson = true; continue; }
  if (a === '--config') { configFlag = argv[++i] || die('--config 后面要跟路径'); continue; }
  if (a === '--data-dir') { dataDirFlag = argv[++i] || die('--data-dir 后面要跟目录'); continue; }
  if (a.startsWith('-')) die('不认识的选项：' + a);
  if (!sawCommand) {
    cmd = a;
    sawCommand = true;
  } else {
    cmdArgs.push(a);
  }
}

if (!['status', 'check', 'paths', 'link'].includes(cmd)) die('不认识的命令：' + cmd + '（见 --help）');

/** 配置候选（顺序即优先级；只有显式给的才允许不存在）。 */
function candidates() {
  const list = [];
  if (configFlag) list.push({ why: '--config', path: resolve(configFlag), must: true });
  if (dataDirFlag) list.push({ why: '--data-dir', path: join(resolve(dataDirFlag), 'config.json'), must: true });
  if (process.env.MGMUSIC_CONFIG_PATH) {
    list.push({ why: '$MGMUSIC_CONFIG_PATH', path: resolve(process.env.MGMUSIC_CONFIG_PATH), must: true });
  }
  if (process.env.PANEL_DATA_DIR) {
    list.push({ why: '$PANEL_DATA_DIR', path: join(process.env.PANEL_DATA_DIR, 'plugin-data', NAME, 'config.json'), must: false });
  }
  list.push({ why: '开发机示例 ~/panel-3030', path: join(homedir(), 'panel-3030', 'data', 'plugin-data', NAME, 'config.json'), must: false });
  list.push({ why: '当前目录 ./data', path: resolve('data', 'config.json'), must: false });
  return list;
}

function pick() {
  const list = candidates();
  for (const c of list) {
    if (existsSync(c.path)) return { ...c, list, found: true };
  }
  const must = list.find((c) => c.must);
  if (must) die('配置文件不存在：' + must.path, 3);
  return { list, found: false, path: '' };
}

const mask = (v, head = 3, tail = 4) => {
  const s = v === undefined || v === null ? '' : String(v);
  return s.length <= head + tail ? s : s.slice(0, head) + '***' + s.slice(-tail);
};

const DEFAULTS = { topup_min: 30, report_ms: 60000, timeout_ms: 15000 };

function load(path) {
  const raw = readFileSync(path, 'utf8');
  const cfg = JSON.parse(raw);
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('顶层要是对象');
  return cfg;
}

/** 形状校验：只查「坏了会静默跑错」的那几项。 */
function inspect(cfg) {
  const errors = [];
  const warnings = [];
  if (cfg.schema_version !== undefined && typeof cfg.schema_version !== 'number') {
    errors.push('schema_version 不是数字');
  }
  if (!Array.isArray(cfg.devices)) errors.push('devices 不是数组');
  const devices = Array.isArray(cfg.devices) ? cfg.devices : [];
  devices.forEach((d, i) => {
    if (!d || typeof d !== 'object') { errors.push(`devices[${i}] 不是对象`); return; }
    if (d.msisdn !== undefined && !/^1\d{10}$/.test(String(d.msisdn))) {
      errors.push(`devices[${i}].msisdn 不是 11 位手机号`);
    }
    // uid 有两种长相：纯数字（老账号）和 UUID（新账号，`9aea4c39-…`）。别把 UUID 当坏值。
    if (d.uid !== undefined && d.uid !== '') {
      const uid = String(d.uid);
      const numeric = /^\d+$/.test(uid);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid);
      if (!numeric && !uuid) warnings.push(`devices[${i}].uid 既不是数字也不是 UUID（${uid.slice(0, 16)}）`);
    }
  });
  if (cfg.link_disabled !== undefined && !Array.isArray(cfg.link_disabled)) {
    errors.push('link_disabled 不是数组');
  }
  if (cfg.topup_min !== undefined && !(Number.isFinite(Number(cfg.topup_min)) && Number(cfg.topup_min) >= 0)) {
    errors.push('topup_min 要是 ≥0 的数字');
  }
  if (cfg.timeout_ms !== undefined) {
    const v = Number(cfg.timeout_ms);
    if (!(v >= 1000 && v <= 60000)) errors.push('timeout_ms 要在 1000..60000');
  }
  const it = cfg.task_interval;
  if (it !== undefined) {
    const min = Number(it && it.min_ms);
    const max = Number(it && it.max_ms);
    if (!(min >= 0 && max >= min)) errors.push('task_interval 要满足 0 ≤ min_ms ≤ max_ms');
  }
  if (cfg.tls !== undefined && cfg.tls !== '' && cfg.tls !== 'native') {
    warnings.push(`tls=${String(cfg.tls)}（只认 '' 或 'native'）`);
  }
  return { errors, warnings, devices };
}

const picked = pick();

if (cmd === 'paths') {
  const rows = picked.list.map((c) => ({ why: c.why, path: c.path, exists: existsSync(c.path), must: !!c.must }));
  if (wantJson) console.log(JSON.stringify({ selected: picked.path || null, candidates: rows }, null, 2));
  else {
    console.log('配置解析顺序（先命中先用）：');
    for (const r of rows) console.log(`  ${r.exists ? '✓' : '·'} ${r.why.padEnd(22)} ${r.path}${r.must ? '（必须存在）' : ''}`);
    console.log(`\n选中：${picked.path || '（没有找到配置文件）'}`);
  }
  process.exit(0);
}

if (!picked.found) {
  if (wantJson) console.log(JSON.stringify({ ok: false, error: '没有找到配置文件', candidates: picked.list.map((c) => c.path) }, null, 2));
  else console.error('没有找到配置文件 —— 用 --config 指定，或先跑 `node src/cli.mjs paths` 看顺序。');
  process.exit(3);
}

let cfg;
try {
  cfg = load(picked.path);
} catch (e) {
  if (wantJson) console.log(JSON.stringify({ ok: false, path: picked.path, error: e.message }, null, 2));
  else console.error(`❌ 配置读不了（${picked.path}）：${e.message}`);
  process.exit(1);
}

const { errors, warnings, devices } = inspect(cfg);
const size = statSync(picked.path).size;

// ──────────────────────────────────────────────────────────── link：云盘联动名单
//
// 与面板页的「云盘联动」是**同一个动作、同一份字段**（R3）：`link off <key>` = 清单里点
// 「禁用」，`link on <key>` = 点「启用」。写的是同一份 config.json（原子写 + 0600 +
// `.bak-cli-<时间戳>` 备份）；插件侧 loadConfig() 每次都重读文件，所以写完立刻生效。
//
// 为什么 CLI 也要有：用户删了账号却被每日任务同步回来时，人在终端上就能先止血，
// 不用先开面板找那个按钮。

/** 一个云盘账号可能被记在哪几个键上：给的那个 + 本机设备上与它对应的 mcloudId/手机号。 */
function linkKeysFor(config, key) {
  const out = [key];
  const push = (v) => {
    const s = String(v || '').trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  };
  const devs = Array.isArray(config.devices) ? config.devices : [];
  devs.forEach((d) => {
    if (!d || typeof d !== 'object') return;
    const id = String(d.mcloudId || '').trim();
    const phone = String(d.msisdn || '').trim();
    if ((id && id === key) || (phone && phone === key)) {
      push(id);
      push(phone);
    }
  });
  return out;
}

/** 云盘账号表（只读，不解析 auth —— 这里只要能列出 id/备注/停用态）。 */
function readMcloudLite(configPath) {
  const file = join(dirname(dirname(configPath)), 'mcloud', 'shared.json');
  const miss = (reason) => ({ ok: false, file, reason, accounts: [] });
  if (!existsSync(file)) return miss('云盘账号表不在（云盘插件没装？）');
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    const raw = doc && doc['mcloud.accounts'];
    if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, file, reason: '', accounts: [] };
    const list = JSON.parse(String(raw));
    if (!Array.isArray(list)) return miss('账号表不是数组');
    const accounts = list
      .filter((it) => it && typeof it === 'object' && String(it.id || '').trim())
      .map((it) => ({
        id: String(it.id).trim(),
        label: String(it.label || '').trim(),
        disabled: it.disabled === true,
      }));
    return { ok: true, file, reason: '', accounts };
  } catch (e) {
    return miss('读不出来：' + (e && e.message ? e.message : e));
  }
}

if (cmd === 'link') {
  const sub = String(cmdArgs[0] || 'list');
  const key = String(cmdArgs[1] || '').trim();
  const list = Array.isArray(cfg.link_disabled)
    ? cfg.link_disabled.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const cloud = readMcloudLite(picked.path);
  const devs = Array.isArray(cfg.devices) ? cfg.devices : [];

  if (sub === 'list' || sub === 'ls' || sub === '') {
    if (wantJson) {
      console.log(JSON.stringify({
        ok: true,
        path: picked.path,
        cloud_file: cloud.file,
        cloud_available: cloud.ok,
        cloud_reason: cloud.reason,
        link_disabled: list,
        cloud_accounts: cloud.accounts,
        devices: devs.map((d, i) => ({
          index: i + 1,
          label: String(d.label || ''),
          msisdn: mask(d.msisdn),
          mcloud_id: d.mcloudId ? mask(String(d.mcloudId), 4, 4) : '',
          linked: !!(d.mcloudId),
          link_disabled: isDevDisabled(d, list),
        })),
      }, null, 2));
      process.exit(0);
    }
    console.log('云盘账号表：' + cloud.file + (cloud.ok ? '' : '（' + cloud.reason + '）'));
    if (cloud.ok) {
      if (!cloud.accounts.length) console.log('  （云盘里还没有账号）');
      cloud.accounts.forEach((a, i) => {
        const off = list.indexOf(a.id) >= 0;
        console.log('  ' + (i + 1) + '. ' + (a.label || '(无备注)') + '  id ' + mask(a.id, 4, 4)
          + (a.disabled ? '  [云盘已停用]' : '')
          + (off ? '  [联动已禁用]' : ''));
      });
    }
    console.log('本机账号：' + devs.length + ' 个');
    devs.forEach((d, i) => {
      const linked = !!d.mcloudId;
      console.log('  ' + (i + 1) + '. ' + (String(d.label || '') || '(无备注)') + '  ' + (mask(d.msisdn) || '(无号)')
        + (linked ? '  [云盘联动]' : '')
        + (linked && isDevDisabled(d, list) ? '  [已停用联动]' : ''));
    });
    console.log('联动禁用名单：' + (list.length ? list.map((k) => mask(k, 3, 4)).join(', ') : '（空）'));
    process.exit(0);
  }

  if (sub !== 'off' && sub !== 'on') die('link 只认 list / off <id|手机号> / on <id|手机号>');
  if (!key) die('要给云盘账号 id 或手机号：' + NAME + ' link ' + sub + ' <id|手机号>');
  const keys = linkKeysFor(cfg, key);
  const next = sub === 'off'
    ? keys.reduce((acc, k) => (acc.indexOf(k) >= 0 ? acc : acc.concat([k])), list.slice())
    : list.filter((k) => keys.indexOf(k) < 0);
  if (next.length === list.length && next.every((k, i) => k === list[i])) {
    if (wantJson) console.log(JSON.stringify({ ok: true, changed: false, link_disabled: list }, null, 2));
    else console.log('没变化：' + (sub === 'off' ? '本来就禁用着' : '本来就没禁用'));
    process.exit(0);
  }
  const nextCfg = Object.assign({}, cfg, { link_disabled: next });
  // 写之前再校一遍形状：宁可这次不写，也别把一份坏配置落盘（面板和 daily 都读它）
  const after = inspect(nextCfg);
  if (after.errors.length) {
    console.error('❌ 改完的配置校验不过，没写：' + after.errors.join('；'));
    process.exit(1);
  }
  const rawText = readFileSync(picked.path, 'utf8');
  const bak = picked.path + '.bak-cli-' + Date.now();
  try {
    writeFileSync(bak, rawText, { mode: 0o600 });
    try { chmodSync(bak, 0o600); } catch (e) { /* 已是 0600 */ }
  } catch (e) {
    die('备份失败，没写：' + (e && e.message ? e.message : e), 1);
  }
  // 原子写：同目录 tmp（0600）→ rename。写到一半被打断会留下半截 JSON，插件读它就会坏。
  const tmp = picked.path + '.tmp-cli';
  writeFileSync(tmp, JSON.stringify(nextCfg, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(tmp, 0o600); } catch (e) { /* 已是 0600 */ }
  renameSync(tmp, picked.path);
  if (wantJson) {
    console.log(JSON.stringify({ ok: true, changed: true, action: sub, keys, link_disabled: next, backup: bak }, null, 2));
  } else {
    console.log((sub === 'off' ? '已禁用联动：' : '已恢复联动：') + keys.map((k) => mask(k, 3, 4)).join(', '));
    console.log('备份：' + bak);
    console.log('下次同步' + (sub === 'off' ? '会跳过这个号（已同步的账号照旧跑）' : '会重新跟随云盘'));
  }
  process.exit(0);
}

/** 这台设备的联动是不是被禁用了（CLI 版；与插件 isDeviceLinkDisabled 同口径）。 */
function isDevDisabled(dev, list) {
  const keys = [String(dev.mcloudId || '').trim(), String(dev.msisdn || '').trim()].filter(Boolean);
  return keys.some((k) => list.indexOf(k) >= 0);
}

if (cmd === 'check') {
  if (wantJson) {
    console.log(JSON.stringify({ ok: errors.length === 0, path: picked.path, errors, warnings }, null, 2));
  } else {
    console.log(`配置：${picked.path}（${size} 字节）`);
    for (const w of warnings) console.log('  ⚠ ' + w);
    for (const e of errors) console.log('  ✗ ' + e);
    console.log(errors.length === 0 ? `\n✓ 形状没问题（${warnings.length} 条提醒）` : `\n✗ ${errors.length} 处要改`);
  }
  process.exit(errors.length === 0 ? 0 : 1);
}

// status
const rows = devices.map((d, i) => ({
  index: i + 1,
  label: String(d.label || ''),
  msisdn: mask(d.msisdn),
  uid: d.uid ? mask(d.uid, 4, 4) : '',
  disabled: !!d.disabled,
  linked: !!(d.mcloudId || d.mcloud_id),
}));
const summary = {
  ok: errors.length === 0,
  path: picked.path,
  bytes: size,
  schema_version: cfg.schema_version ?? null,
  devices: rows.length,
  link_disabled: Array.isArray(cfg.link_disabled) ? cfg.link_disabled.length : 0,
  topup_min: cfg.topup_min ?? DEFAULTS.topup_min,
  report_ms: cfg.report_ms ?? DEFAULTS.report_ms,
  timeout_ms: cfg.timeout_ms ?? DEFAULTS.timeout_ms,
  tls: cfg.tls || '（默认）',
  comment_enabled: !!(cfg.comment && cfg.comment.enabled),
  errors,
  warnings,
  accounts: rows,
};

if (wantJson) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`配置：${picked.path}（${size} 字节，schema ${summary.schema_version ?? '未写'}）`);
  console.log(`账号：${summary.devices} 个${rows.filter((r) => r.disabled).length ? `（停用 ${rows.filter((r) => r.disabled).length}）` : ''}`);
  for (const r of rows) {
    console.log(`  ${r.index}. ${r.label || '(无备注)'}  ${r.msisdn || '(无号)'}${r.uid ? '  uid ' + r.uid : ''}${r.disabled ? '  [停用]' : ''}${r.linked ? '  [云盘联动]' : ''}`);
  }
  console.log(`联动禁用：${summary.link_disabled} 条 · 补报档位 ${summary.topup_min} 分钟 · 请求超时 ${summary.timeout_ms}ms · TLS ${summary.tls}`);
  for (const w of warnings) console.log('  ⚠ ' + w);
  for (const e of errors) console.log('  ✗ ' + e);
  console.log(errors.length === 0 ? '' : '\n配置有问题：跑 `' + NAME + ' check` 看全部');
}
process.exit(errors.length === 0 ? 0 : 1);
