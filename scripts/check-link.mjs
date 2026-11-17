// 云盘联动的离线自检（**不联网、不碰真的面板数据**）。
//
// 做法：把 `llrt/mgmusic.js` 的 `panel:host` 换成桩（内存 state + 假上游），
// 再把内部函数导出来，然后把「同步 / 禁用 / 幂等 / 读不到时降级」这五条口径逐条跑一遍。
//
// 为什么要这样一个东西：这个插件没有测试基建，而联动这一节的错法都很安静 ——
// 「同一个号变成两条」「禁用等于偷偷删账号」「读不到就当没账号」都不会报错，
// 只会在真机上表现为"账号少了一个"或者"多了一台领不到豆的"。
//
// 跑：npm run check:link   （deploy:panel 之前会先跑它）

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'llrt', 'mgmusic.js');
const TMP = join(tmpdir(), 'mgmusic-link-check');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(join(TMP, 'plugin-data', 'mgmusic'), { recursive: true });
mkdirSync(join(TMP, 'plugin-data', 'mcloud'), { recursive: true });

const state = new Map();
const logs = [];
let fetches = [];

/** 假宿主：state 表用 Map，出站只认换票那两发。 */
const HOST = {
  log: async () => {},
  info: async (m) => logs.push('I ' + m),
  warn: async (m) => logs.push('W ' + m),
  error: async (m) => logs.push('E ' + m),
  debug: async () => {},
  sqlite_query_sync: (sql, p) => {
    if (/FROM state WHERE key/i.test(sql)) {
      const k = p[0];
      return state.has(k) ? { rows: [{ value: state.get(k) }] } : { rows: [] };
    }
    return { rows: [] };
  },
  sqlite_exec_sync: (sql, p) => {
    if (/^s*INSERT INTO state/i.test(sql)) { state.set(p[0], p[1]); return {}; }
    if (/^s*DELETE FROM state/i.test(sql)) { state.delete(p[0]); return {}; }
    return {};
  },
  plugin_data_dir: async () => join(TMP, 'plugin-data', 'mgmusic'),
  self_config: async () => ({}),
  http_fetch: (url, opts) => {
    fetches.push(url);
    if (url.includes('querySpecTokenV2')) {
      const raw = Buffer.from(String(opts.headers.authorization).replace(/^Basics+/i, ''), 'base64').toString('utf8');
      const phone = raw.split(':')[1];
      return { status: 200, headers: {}, body: JSON.stringify({ success: true, code: '0000', data: { token: 'TKT-' + phone } }) };
    }
    if (url.includes('token-validate')) {
      const tok = decodeURIComponent((url.match(/token=([^&]+)/) || [])[1] || '');
      const phone = tok.replace(/^ANDT/, '').replace(/^TKT-/, '');
      return { status: 200, headers: {}, body: JSON.stringify({ code: '000000', info: 'ok', data: { userId: 'U' + phone } }) };
    }
    throw new Error('意外的上游：' + url);
  },
  register_web: async () => {},
  register_cron: async () => {},
  register_handler: async () => {},
  sidebar: async () => {},
  sleep: async () => {},
};
globalThis.__HOST__ = HOST;

const src = readFileSync(SRC, 'utf8');
const IMPORT = "import host from 'panel:host';";
if (!src.includes(IMPORT)) {
  console.error('❌ llrt/mgmusic.js 里找不到 ' + JSON.stringify(IMPORT) + ' —— 桩换不了，检查一下导入那句是不是改了');
  process.exit(1);
}
const EXPORTS = ['parseMcloudAccounts', 'syncFromMcloud', 'linkReport', 'setLinkDisabled', 'loadConfig', 'saveConfig', 'readMcloudAccounts'];
const LF = String.fromCharCode(10);
const pluginSrc = src.replace(IMPORT, 'const host = globalThis.__HOST__;')
  + LF + 'export { ' + EXPORTS.join(', ') + ' };' + LF;
writeFileSync(join(TMP, 'plugin.mjs'), pluginSrc);
// 云盘账号表：一正常 / 一 anon（id 与手机号不同值）/ 一停用 / 一坏 auth
const acc = (id, label, phone) => ({
  id, label, disabled: false,
  auth: 'Basic ' + Buffer.from('pc:' + phone + ':' + 'x'.repeat(201)).toString('base64'),
});
const sharedFile = join(TMP, 'plugin-data', 'mcloud', 'shared.json');
writeFileSync(sharedFile, JSON.stringify({
  'mcloud.accounts': JSON.stringify([
    acc('13800138000', '小号', '13800138000'),
    acc('anon-aohk08', '移动', '13600136002'),
    { ...acc('13700137001', '停用号', '13700137001'), disabled: true },
    { id: 'bad-1', label: '坏号', disabled: false, auth: 'Basic ' + Buffer.from('oops').toString('base64') },
  ]),
}));

const m = await import(join(TMP, 'plugin.mjs'));
const devices = () => m.loadConfig().devices;
let bad = 0;
const ok = (name, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (!same) bad += 1;
  console.log((same ? '  ✅ ' : '  ❌ ') + name + (same ? '' : ('  实际=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(want))));
};

console.log('① 首次同步：把云盘账号变成咪咕账号');
const r1 = m.syncFromMcloud();
ok('新建 2 台（停用的不来、坏 auth 跳过）', devices().length, 2);
ok('计数（新建 2 / 失败 1）', [r1.counts.added, r1.counts.failed], [2, 1]);
ok('来源都是云盘联动', devices().map((d) => d.source), ['mcloud-auth', 'mcloud-auth']);
ok('anon 那台也认得出手机号', devices()[1].msisdn, '13600136002');

console.log('② 再同步一次：幂等、零上游请求');
fetches = [];
const r2 = m.syncFromMcloud();
ok('不新增', devices().length, 2);
ok('全部认回', [r2.counts.added, r2.counts.adopted], [0, 2]);
ok('一次上游请求都没发', fetches.length, 0);

console.log('③ 禁用「移动」：跳过联动，但账号保留');
const r3 = m.setLinkDisabled('anon-aohk08', true);
ok('清单里标成禁用', r3.accounts.find((a) => a.id === 'anon-aohk08').disabled, true);
const before = JSON.stringify(devices()[1]);
fetches = [];
const r4 = m.syncFromMcloud();
ok('账号还在（禁用 ≠ 删除）', devices().length, 2);
ok('它没被同步、也没被改', JSON.stringify(devices()[1]), before);
ok('跳过 1 条', r4.counts.skipped, 1);
ok('零上游请求', fetches.length, 0);

console.log('④ 用手机号也能禁用（anon 账号的 id 与手机号不同值）');
m.setLinkDisabled('13600136002', true);
ok('仍是禁用状态', m.linkReport().accounts.find((a) => a.id === 'anon-aohk08').disabled, true);

console.log('⑤ 恢复联动');
m.setLinkDisabled('anon-aohk08', false);
m.setLinkDisabled('13600136002', false);
const r5 = m.syncFromMcloud();
ok('恢复后重新跟随（不重复建）', [r5.counts.added, devices().length], [0, 2]);

console.log('⑥ 云盘表读不到：降级，一个账号都不动');
const keep = JSON.stringify(devices());
rmSync(sharedFile);
const r6 = m.syncFromMcloud();
ok('available=false', r6.available, false);
ok('账号原样', JSON.stringify(devices()), keep);

rmSync(TMP, { recursive: true, force: true });
if (bad) {
  console.error(LF + '❌ 云盘联动自检：' + bad + ' 条不过');
  process.exit(1);
}
console.log(LF + '✅ 云盘联动自检全过（同步 / 幂等 / 禁用 / 降级）');

