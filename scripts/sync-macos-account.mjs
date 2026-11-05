#!/usr/bin/env node
// 从咪咕 macOS/iPad App 的偏好设置里同步当前登录账号到插件数据根。
//
// 用法：
//   node scripts/sync-macos-account.mjs
//   node scripts/sync-macos-account.mjs /path/to/app-account.json
//
// 只写 uid / msisdn（以及已有文件里的 deviceid），不写 passId/token。
// 生成后 mgmusic-plugin 会在 status/run 时自动导入，不需要再手动填凭据。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PREF = path.join(
  os.homedir(),
  'Library/Containers/com.migu.migumobilemusic/Data/Library/Preferences/com.migu.migumobilemusic.plist',
);
const DEFAULT_OUT = path.join(
  os.homedir(),
  'Library/Application Support/plugin-panel/data/plugin-data/mgmusic-plugin/app-account.json',
);
const out = process.argv[2] || DEFAULT_OUT;

function balancedJsonAt(text, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return '';
}

function mask(v, head, tail) {
  const s = String(v || '');
  if (s.length <= head + tail) return s;
  return s.slice(0, head) + '***' + s.slice(-tail);
}

if (!fs.existsSync(PREF)) {
  console.error('找不到咪咕 App 偏好设置：' + PREF);
  console.error('请先打开并登录 macOS 版咪咕音乐 App。');
  process.exit(2);
}
const text = fs.readFileSync(PREF).toString('utf8');
const start = text.indexOf('{"videoUserItem"');
if (start < 0) {
  console.error('偏好设置里没有 kMGLoginSDKUserInfo；App 可能还没登录。');
  process.exit(3);
}
const raw = balancedJsonAt(text, start);
let j;
try { j = JSON.parse(raw); } catch (e) {
  console.error('解析 App 用户信息失败：' + e.message);
  process.exit(4);
}
const uid = String(j.userId || '').trim();
const msisdn = String(j.msisdn || j.accountName || '').trim();
if (!uid || uid === '0' || !/^1[3-9]\d{9}$/.test(msisdn)) {
  console.error('App 用户信息里没有可用的 uid/msisdn');
  process.exit(5);
}
let deviceid = '';
try {
  const old = JSON.parse(fs.readFileSync(out, 'utf8'));
  deviceid = String(old.deviceid || '');
} catch (e) { /* 首次没有旧文件 */ }
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ uid, msisdn, deviceid }, null, 2) + '\n', { mode: 0o600 });
console.log('已写入 ' + out);
console.log('uid=' + mask(uid, 6, 4) + ' msisdn=' + mask(msisdn, 3, 4)
  + (deviceid ? (' deviceid=' + mask(deviceid, 8, 4)) : ''));
