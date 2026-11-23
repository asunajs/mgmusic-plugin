// CLI 冒烟检查：--version / --help / paths / check 四条路径都能跑，坏配置能被抓出来。
//
// 为什么要有：CLI 是「两件套」的另一半，它坏了用户会以为是插件坏了；而它不在界面上，
// 没人会每天点一遍。所以塞进门禁。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'src/cli.mjs');
const run = (args, opts = {}) =>
  execFileSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', ...opts });

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '   [' + detail + ']' : ''));
};

const version = run(['--version']).trim();
check('--version 输出 x.y.z', /^\d+\.\d+\.\d+$/.test(version), version);
const help = run(['--help']);
check('--help 列出命令', /status/.test(help) && /check/.test(help) && /link/.test(help));

const dir = mkdtempSync(join(tmpdir(), 'mgmusic-cli-'));
try {
  // 好配置：3 个号、一个 UUID uid
  const good = join(dir, 'config.json');
  writeFileSync(good, JSON.stringify({
    schema_version: 1,
    devices: [
      { msisdn: '13800138000', uid: '9aea4c39-49e0-4000-8000-000000000000', label: 'A' },
      { msisdn: '13700137001', uid: '123456789', label: 'B', disabled: true },
    ],
    link_disabled: ['13600136002'],
    topup_min: 30,
  }));
  const okCheck = run(['check', '--config', good, '--json']);
  const okJson = JSON.parse(okCheck);
  check('check：好配置 ok=true 且不误报 UUID uid', okJson.ok === true && okJson.errors.length === 0, JSON.stringify(okJson.errors));

  const status = JSON.parse(run(['status', '--config', good, '--json']));
  check('status --json：账号数与脱敏', status.devices === 2 && /^\d{3}\*\*\*\d{4}$/.test(status.accounts[0].msisdn), status.accounts[0].msisdn);

  const paths = JSON.parse(run(['paths', '--config', good, '--json']));
  check('paths --json：选中 --config 那份', paths.selected === good, paths.selected);

  // 云盘联动：off 按 mcloudId **和**手机号一起记（漏一个就还会同步回来），on 两个一起删
  const linkCfg = join(dir, 'link.json');
  writeFileSync(linkCfg, JSON.stringify({
    schema_version: 1,
    devices: [{
      label: '云盘号', msisdn: '13800138000', uid: '9aea4c39-49e0-4000-8000-000000000001',
      mcloudId: 'anon-test01', source: 'mcloud-auth',
    }],
    link_disabled: [],
  }));
  const off = JSON.parse(run(['link', 'off', '13800138000', '--config', linkCfg, '--json']));
  const afterOff = JSON.parse(readFileSync(linkCfg, 'utf8')).link_disabled;
  check('link off：changed=true', off.changed === true, JSON.stringify(off));
  check('link off：手机号与 mcloudId 都进名单',
    afterOff.includes('13800138000') && afterOff.includes('anon-test01'), JSON.stringify(afterOff));
  const on = JSON.parse(run(['link', 'on', '13800138000', '--config', linkCfg, '--json']));
  const afterOn = JSON.parse(readFileSync(linkCfg, 'utf8')).link_disabled;
  check('link on：名单清空（不留残键）', on.changed === true && afterOn.length === 0, JSON.stringify(afterOn));
  const noop = JSON.parse(run(['link', 'on', '13800138000', '--config', linkCfg, '--json']));
  check('link on：再点一次是没变化（幂等）', noop.changed === false, JSON.stringify(noop));
  const listed = JSON.parse(run(['link', '--config', linkCfg, '--json']));
  check('link --json：列出云盘账号与本机账号', listed.cloud_accounts.length === 0 && listed.devices.length === 1, JSON.stringify(listed.devices));

  // 坏配置：非零退出 + 报出具体错
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ devices: 'nope', timeout_ms: 5 }));
  let code = 0;
  try {
    run(['check', '--config', bad]);
  } catch (e) {
    code = e.status;
  }
  check('check：坏配置退出码 1', code === 1, String(code));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const bad = results.filter((x) => !x).length;
console.log('');
console.log(bad === 0 ? `ok: ${results.length} 条 CLI 冒烟全过` : `失败 ${bad} / ${results.length}`);
process.exit(bad === 0 ? 0 : 1);
