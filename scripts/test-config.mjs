#!/usr/bin/env node
// 配置存储的回归测试（0.7.0：唯一真值 = plugin-data/mgmusic/config.json）。
//
// 为什么是"把插件源码拷贝一份、把 panel:host 换成假的再 import"：
//   · 插件是单文件 ESM，配置读写是里面的**真函数**；只有宿主 op 需要替身。
//   · 这样测的是真代码路径（loadConfig / saveConfig / 迁移 / 路由），不是另写一份模仿品。
//   · 拷贝时只改一行 import（下面断言了这一点），其余字节不动。
//
// 覆盖：roundtrip / 迁移幂等 / 坏 JSON 不崩 / 面板与 WebUI 同源 / 0600 / 登录中间态留在 state。
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'llrt/mgmusic.js');
const BT = String.fromCharCode(96);

let failures = 0;
let passes = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passes += 1; console.log('  ok   ' + name); })
    .catch((e) => { failures += 1; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message : e)); });
}

// ── 宿主替身 ────────────────────────────────────────────────────────────────
// 只实现插件真用到的那几个 op；sqlite 用内存 Map 模拟 state 表，*未知 SQL 直接抛* ——
// 免得插件悄悄换 SQL 之后测试还在"过"。
const FAKE_HOST = [
  "const state = new Map();",
  "const box = { dir: '', logs: [], web: null, crons: [], handlers: {}, sidebar: null, stateFile: '' };",
  "function need(cond, what) { if (!cond) throw new Error('替身不支持：' + what); }",
  "const host = {",
  "  log: (m) => { box.logs.push({ level: 'log', msg: String(m) }); },",
  "  info: (m) => { box.logs.push({ level: 'info', msg: String(m) }); },",
  "  warn: (m) => { box.logs.push({ level: 'warn', msg: String(m) }); },",
  "  error: (m) => { box.logs.push({ level: 'error', msg: String(m) }); },",
  "  notify: async () => {},",
  "  sleep: async () => {},",
  "  sqlite_exec_sync: (sql, params) => {",
  "    const p = params || [];",
  "    if (/^CREATE TABLE IF NOT EXISTS state/i.test(sql)) return { rows: [] };",
  "    if (/^INSERT INTO state/i.test(sql)) { state.set(String(p[0]), String(p[1])); return { rows: [] }; }",
  "    if (/^DELETE FROM state WHERE key/i.test(sql)) { state.delete(String(p[0])); return { rows: [] }; }",
  "    throw new Error('替身不支持这条 SQL: ' + sql);",
  "  },",
  "  sqlite_query_sync: (sql, params) => {",
  "    const p = params || [];",
  "    need(/^SELECT value FROM state WHERE key/i.test(sql), sql);",
  "    const v = state.get(String(p[0]));",
  "    return { rows: v === undefined ? [] : [{ value: v }] };",
  "  },",
  "  plugin_data_dir: async () => box.dir,",
  "  self_config: async () => {",
  "    const t = require_read(box.dir + '/config.json');",
  "    return t === null ? {} : JSON.parse(t);",
  "  },",
  "  register_web: async (fn) => { box.web = fn; },",
  "  register_cron: async (name, cron, budget) => { box.crons.push({ name, cron, budget }); },",
  "  register_handler: async (name, fn) => { box.handlers[name] = fn; },",
  "  set_job_summary: async () => {},",
  "  sidebar: async (o) => { box.sidebar = o; },",
  "  panel_version: async () => '0.4.0',",
  "  panel_at_least: async () => true,",
  "  http_fetch: () => { throw new Error('测试不该发网络请求'); },",
  "  fetch: () => { throw new Error('测试不该发网络请求'); },",
  "};",
  "import { readFileSync as _rf } from 'node:fs';",
  "function require_read(p) { try { return _rf(p, 'utf8'); } catch (e) { return null; } }",
  "export const __host = box;",
  "export const __state = state;",
  "export default host;",
].join('\n');

/** 准备一份临时"插件 + 替身"，返回 { dir, dataDir, load(), box } */
function makeRig() {
  const base = mkdtempSync(join(tmpdir(), 'mgcfg-'));
  const dataDir = join(base, 'data', 'plugin-data', 'mgmusic');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(base, 'fake-host.mjs'), FAKE_HOST);
  const src = readFileSync(SRC, 'utf8');
  const needle = "import host from 'panel:host';";
  assert.ok(src.includes(needle), '插件里找不到 panel:host 的 import');
  const repl = "import host from './fake-host.mjs';";
  const patched = src.replace(needle, repl);
  // 只允许改这一行：把新 import 换回老的，必须与源码逐字节相同
  assert.equal(patched.replace(repl, needle), src, '除了 import 路径不该有别改动');
  const plugin = join(base, 'mgmusic.under-test.mjs');
  writeFileSync(plugin, patched);
  let seq = 0;
  return {
    base,
    dataDir,
    file: join(dataDir, 'config.json'),
    async load() {
      seq += 1;
      // ⚠ 顺序很重要：替身必须**先**设好 dir，再 import 插件（插件在加载期就问 plugin_data_dir）。
      // 替身的 URL 不能带 query —— 否则会和插件 import 的那份不是同一个模块实例。
      const fake = await import(pathToFileURL(join(base, 'fake-host.mjs')).href);
      fake.__host.dir = dataDir;
      const mod = await import(pathToFileURL(plugin).href + '?n=' + seq);
      return { mod, box: fake.__host, state: fake.__state };
    },
    /** 直接调插件路由（等价于面板/WebUI 发过来的那条请求）。 */
    async route(box, method, rel, body) {
      const res = await box.web({ method, path: '/plugins/mgmusic/' + rel, rel, query: {}, headers: {}, body: body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body)) });
      return { status: res.status, json: JSON.parse(res.body) };
    },
  };
}

const mode = (p) => (statSync(p).mode & 0o777).toString(8);
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

function device(n, extra) {
  return Object.assign({
    label: 'acc-' + n,
    uid: 'uid' + n,
    msisdn: '1380000000' + n,
    deviceid: 'dev-' + n,
    ce: 'CE' + n,
  }, extra || {});
}

console.log('配置存储回归（llrt/mgmusic.js 0.7.0）');

// 1) 干净安装：没有文件、没有 state → 建出唯一那份 config.json
await ok('干净安装：建出 config.json（schema_version=1，0600，state 只有迁移标记）', async () => {
  const rig = makeRig();
  const { box, state } = await rig.load();
  assert.ok(statSync(rig.file).isFile(), 'config.json 应该被创建');
  const cfg = readJSON(rig.file);
  assert.equal(cfg.schema_version, 1);
  assert.deepEqual(cfg.devices, []);
  assert.equal(mode(rig.file), '600', '配置文件必须是 0600');
  assert.ok(state.get('mgmusic.migration_v1'), '应该有迁移标记');
  assert.equal(state.get('mgmusic.config'), undefined, 'state 里不该再有配置');
  const got = await rig.route(box, 'GET', 'api/config');
  assert.equal(got.json.ok, true);
  assert.equal(got.json.config_path, rig.file);
  assert.equal(got.json.schema_version, 1);
});

// 2) 迁移：旧 state 里那份配置 → 文件；state 键删掉、老标记删掉、登录中间态留着
await ok('迁移：state 的 mgmusic.config → config.json；旧键删除、登录中间态保留', async () => {
  const rig = makeRig();
  const legacy = { devices: [device(1), device(2)], topup_min: 45, cert: '', tls: '', comment: { content: '旧评论' } };
  const legacyText = JSON.stringify(legacy);
  const pending = JSON.stringify({ msisdn: '13800000001', at: 1 });
  // 先塞 state（用一次空的 load 拿到替身，再重新 load）
  const first = await rig.load();
  first.state.set('mgmusic.config', legacyText);
  first.state.set('mgmusic.seed_marker', 'state');
  first.state.set('mgmusic.login_pending', pending);
  // 这一次加载之前文件还不存在；但上面那次 load 已经跑过迁移 → 删掉文件与标记，模拟"迁移前"
  writeFileSync(rig.file, '');
  first.state.delete('mgmusic.migration_v1');
  const { box, state } = await rig.load();
  const cfg = readJSON(rig.file);
  assert.equal(cfg.devices.length, 2, '两个设备都应该迁过来');
  assert.equal(cfg.topup_min, 45, 'scalar 要保留');
  assert.equal(cfg.comment.content, '旧评论');
  assert.equal(cfg.schema_version, 1);
  assert.equal(mode(rig.file), '600');
  assert.equal(state.get('mgmusic.config'), undefined, '旧 state 配置必须删掉');
  assert.equal(state.get('mgmusic.seed_marker'), undefined, '老的双轨标记必须删掉');
  assert.ok(state.get('mgmusic.migration_v1'), '要有新迁移标记');
  assert.equal(state.get('mgmusic.config.legacy'), legacyText, '旧原文要留一份只读备份');
  assert.equal(state.get('mgmusic.login_pending'), pending, '登录中间态不能被迁移碰到');
  const got = await rig.route(box, 'GET', 'api/config');
  assert.equal(got.json.config.devices.length, 2);
});

// 3) 幂等：同一个数据目录再加载一次，文件内容与标记都不变
await ok('迁移幂等：再加载一次，文件一个字都不变、设备不翻倍', async () => {
  const rig = makeRig();
  const first = await rig.load();
  first.state.set('mgmusic.config', JSON.stringify({ devices: [device(1)], topup_min: 33 }));
  first.state.delete('mgmusic.migration_v1');
  const a = await rig.load();
  const textA = readFileSync(rig.file, 'utf8');
  const markerA = a.state.get('mgmusic.migration_v1');
  const b = await rig.load();
  const textB = readFileSync(rig.file, 'utf8');
  assert.equal(textB, textA, '第二次加载不该重写文件');
  assert.equal(b.state.get('mgmusic.migration_v1'), markerA, '标记不该变');
  assert.equal(readJSON(rig.file).devices.length, 1, '设备不该翻倍');
});

// 4) 合并：文件里有账号、state 里有更新的标量 → state 赢、账号并集
await ok('迁移合并：state 优先 + 文件补缺（devices 并集去重）', async () => {
  const rig = makeRig();
  const { box, state } = await rig.load(); // 干净安装，先建文件
  writeFileSync(rig.file, JSON.stringify({ schema_version: 1, devices: [device(1), device(9)], topup_min: 30 }));
  state.delete('mgmusic.migration_v1');
  state.set('mgmusic.config', JSON.stringify({ devices: [device(1), device(2)], topup_min: 50 }));
  const { box: box2 } = await rig.load();
  const cfg = readJSON(rig.file);
  assert.equal(cfg.topup_min, 50, 'state 的标量优先');
  const labels = cfg.devices.map((d) => d.label).sort();
  assert.deepEqual(labels, ['acc-1', 'acc-2', 'acc-9'], '并集按身份键去重');
  const got = await rig.route(box2, 'GET', 'api/config');
  assert.equal(got.json.config.devices.length, 3);
  assert.ok(rig.state === undefined || true);
});

// 5) 坏 JSON（迁移期）：插件照常加载，坏文件原样留档，写出可用的默认配置
await ok('坏 JSON（迁移时）：插件不崩，坏文件留档 *.bad-*，新文件可用', async () => {
  const rig = makeRig();
  writeFileSync(rig.file, '{oops');
  const { box } = await rig.load();
  const bad = readdirSync(rig.dataDir).filter((f) => f.indexOf('config.json.bad-') === 0);
  assert.equal(bad.length, 1, '坏文件应该被移走留档');
  assert.equal(readFileSync(join(rig.dataDir, bad[0]), 'utf8'), '{oops', '留档内容要原样');
  const cfg = readJSON(rig.file);
  assert.equal(cfg.schema_version, 1);
  assert.deepEqual(cfg.devices, []);
  const got = await rig.route(box, 'GET', 'api/config');
  assert.equal(got.json.ok, true);
});

// 6) 坏 JSON（跑起来以后才坏）：接口报错但不崩，文件不被覆盖
await ok('坏 JSON（运行期）：GET api/config 回 ok:false 且带路径，文件原样保留', async () => {
  const rig = makeRig();
  const { box } = await rig.load();
  writeFileSync(rig.file, 'not json');
  const got = await rig.route(box, 'GET', 'api/config');
  assert.equal(got.json.ok, false);
  assert.ok(String(got.json.error).includes(rig.file), '错误里要带文件路径');
  assert.equal(readFileSync(rig.file, 'utf8'), 'not json', '插件不该覆盖坏文件');
});

// 7) WebUI 往返：POST api/config → 文件变、0600、GET 读到同一份
await ok('WebUI 往返：POST api/config 落盘 → GET 读回同一份（0600）', async () => {
  const rig = makeRig();
  const { box } = await rig.load();
  const cfg = { devices: [device(1), device(2)], topup_min: 12, report_ms: 30000, comment: { content: '好听' } };
  const post = await rig.route(box, 'POST', 'api/config', cfg);
  assert.equal(post.json.ok, true);
  assert.equal(post.json.config_path, rig.file);
  const onDisk = readJSON(rig.file);
  assert.equal(onDisk.topup_min, 12);
  assert.equal(onDisk.devices.length, 2);
  assert.equal(onDisk.schema_version, 1);
  assert.equal(mode(rig.file), '600');
  const get = await rig.route(box, 'GET', 'api/config');
  assert.deepEqual(get.json.config.devices.map((d) => d.label), ['acc-1', 'acc-2']);
  const backups = readdirSync(rig.dataDir).filter((f) => f.indexOf('config.json.bak-save-') === 0);
  assert.ok(backups.length >= 1, '覆盖前要留备份');
});

// 8) 面板同源：面板 PUT 的语义就是"原子写同一份文件" → 插件立刻读到
await ok('面板与 WebUI 同源：面板写同一份文件，插件下一次 loadConfig 就看见', async () => {
  const rig = makeRig();
  const { box } = await rig.load();
  await rig.route(box, 'POST', 'api/config', { devices: [device(1)], topup_min: 30 });
  // 模拟面板 PUT /api/plugins/mgmusic/config：它把整份 text 原子写进同一个路径
  const next = Object.assign(readJSON(rig.file), { topup_min: 61 });
  writeFileSync(rig.file, JSON.stringify(next, null, 2), { mode: 0o600 });
  const get = await rig.route(box, 'GET', 'api/config');
  assert.equal(get.json.config.topup_min, 61, '面板写完插件要立刻看到（每次读文件）');
  assert.equal(get.json.config.devices.length, 1, '面板只覆盖标量，账号不受影响');
});

// 9) 删账号不复活：devices 清空后重载，还是 0 个
await ok('删光账号后重载：不会被旧文件/旧 state 复活', async () => {
  const rig = makeRig();
  const first = await rig.load();
  first.state.set('mgmusic.config', JSON.stringify({ devices: [device(1)], topup_min: 30 }));
  first.state.delete('mgmusic.migration_v1');
  const { box } = await rig.load();
  assert.equal(readJSON(rig.file).devices.length, 1);
  await rig.route(box, 'POST', 'api/config', { devices: [], topup_min: 30 });
  const { box: box2 } = await rig.load(); // 重载
  assert.equal(readJSON(rig.file).devices.length, 0);
  const get = await rig.route(box2, 'GET', 'api/config');
  assert.equal(get.json.config.devices.length, 0, '重载后不该有账号冒出来');
});

// 10) 老文件没有 schema_version → 迁移补上并备份原文件
await ok('老文件没有 schema_version：迁移补 schema 并备份 .bak-migrate-*', async () => {
  const rig = makeRig();
  // 老面板 0.3.x 的原样文件：没有 schema_version，还带着早就删掉的 app_import
  writeFileSync(rig.file, JSON.stringify({ app_import: { enabled: true }, devices: [device(1)], topup_min: 20 }));
  await rig.load();
  const cfg = readJSON(rig.file);
  assert.equal(cfg.schema_version, 1);
  assert.equal(cfg.devices.length, 1);
  assert.equal(cfg.topup_min, 20);
  assert.equal(cfg.app_import, undefined, '废弃字段 app_import 不该留下');
  const backups = readdirSync(rig.dataDir).filter((f) => f.indexOf('config.json.bak-migrate-') === 0);
  assert.equal(backups.length, 1, '改之前要备份原文件');
});

// 12) 文件比插件新（用户升了插件又回退）：只读，不改写、不动 state
await ok('文件 schema 比插件新：只读使用，不改写、不迁移（防旧版覆盖新版）', async () => {
  const rig = makeRig();
  const future = JSON.stringify({ schema_version: 9, devices: [device(1)], topup_min: 30 }, null, 2);
  writeFileSync(rig.file, future);
  const { box, state } = await rig.load();
  assert.equal(readFileSync(rig.file, 'utf8'), future, '文件必须原样不动');
  assert.equal(state.get('mgmusic.migration_v1'), undefined, '不该打迁移标记');
  const warns = box.logs.filter((l) => l.level === 'warn' && l.msg.indexOf('schema_version=9') >= 0);
  assert.ok(warns.length >= 1, '要 warn 出来：文件比本插件新');
  // 仍然能读（只读使用）
  const got = await rig.route(box, 'GET', 'api/config');
  assert.equal(got.json.ok, true);
  assert.equal(got.json.config.devices.length, 1);
});

// 11) 自检要能把配置那层说清楚
await ok('selftest 带配置读数（路径 / 存在 / schema / 设备数 / 权限）', async () => {
  const rig = makeRig();
  const { box } = await rig.load();
  await rig.route(box, 'POST', 'api/config', { devices: [device(1)], topup_min: 30 });
  const st = await rig.route(box, 'GET', 'api/selftest');
  assert.equal(st.json.ok, true, '签名自检要绿');
  assert.equal(st.json.config.path, rig.file);
  assert.equal(st.json.config.exists, true);
  assert.equal(st.json.config.schema_version, 1);
  assert.equal(st.json.config.devices, 1);
  assert.equal(st.json.config.mode, '600');
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
if (failures) process.exit(1);
