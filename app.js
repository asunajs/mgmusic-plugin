'use strict';

// 插件自己的接口。面板的写接口要求 x-panel: 1（防 CSRF），这里每个 POST 都带。
const API = '/plugins/mgmusic-plugin/api';

const $ = (id) => document.getElementById(id);

const TEMPLATE = {
  devices: [
    {
      label: 'account-1',
      uid: '<H5页 uid 头>',
      deviceid: '<deviceid 头>',
      msisdn: '<手机号>',
      ce: '',
      topup_min: 30,
      cookie: '',
    },
  ],
  topup_min: 30,
  report_ms: 60000,
  timeout_ms: 15000,
  cert: '',
  tls: '',
};

async function call(path, opts) {
  const options = opts || {};
  const method = options.method || 'GET';
  const headers = {};
  if (method !== 'GET') headers['x-panel'] = '1';
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(API + path, {
    method: method,
    headers: headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error('HTTP ' + res.status + '（响应不是 JSON）：' + text.slice(0, 200));
  }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  if (data.ok === false) {
    const err = new Error(data.error || '操作失败');
    if (data.lines) err.lines = data.lines;
    throw err;
  }
  return data;
}

function show(text) {
  $('out').textContent = text;
}

function showLines(lines) {
  show(Array.isArray(lines) ? lines.join('\n') : String(lines));
}

function setState(kind, text) {
  const el = $('state');
  el.className = 'badge ' + kind;
  el.textContent = text;
}

async function loadConfig() {
  setState('idle', '读取配置中…');
  try {
    const data = await call('/config');
    $('cfg').value = JSON.stringify(data.config, null, 2);
    setState('success', '已连接');
  } catch (e) {
    setState('failed', '读取失败');
    $('save-hint').className = 'hint err-text';
    $('save-hint').textContent = e.message;
  }
}

async function saveConfig() {
  let cfg;
  try {
    cfg = JSON.parse($('cfg').value);
  } catch (e) {
    $('save-hint').className = 'hint err-text';
    $('save-hint').textContent = '不是合法 JSON：' + e.message;
    return;
  }
  $('save').disabled = true;
  $('save-hint').className = 'hint';
  $('save-hint').textContent = '保存中…';
  try {
    const data = await call('/config', { method: 'POST', body: cfg });
    $('cfg').value = JSON.stringify(data.config, null, 2);
    $('save-hint').className = 'hint';
    $('save-hint').textContent = '已保存（' + (data.config.devices || []).length + ' 个设备）';
  } catch (e) {
    $('save-hint').className = 'hint err-text';
    $('save-hint').textContent = e.message;
  } finally {
    $('save').disabled = false;
  }
}

async function withBusy(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '执行中…';
  try {
    await fn();
  } catch (e) {
    showLines(e.lines || ('失败：' + e.message));
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function doStatus() {
  await withBusy($('status'), async () => {
    const data = await call('/status');
    showLines(data.lines);
    setState(data.ok ? 'success' : 'failed', data.ok ? '状态正常' : '有账号失败');
  });
}

async function doRun() {
  await withBusy($('run'), async () => {
    const data = await call('/run', { method: 'POST', body: {} });
    showLines(data.lines);
    setState('success', 'daily 完成');
  });
}

async function doReport() {
  await withBusy($('report'), async () => {
    const data = await call('/report', { method: 'POST', body: { ms: 600000 } });
    showLines(data.lines);
    setState(data.ok ? 'success' : 'failed', data.ok ? '补报完成' : '补报有失败');
  });
}

async function doSelftest() {
  await withBusy($('selftest'), async () => {
    const data = await call('/selftest');
    show(JSON.stringify(data, null, 2));
    setState(data.ok ? 'success' : 'failed', data.ok ? '签名自检通过' : '签名自检失败');
  });
}

function fillTemplate() {
  $('cfg').value = JSON.stringify(TEMPLATE, null, 2);
  $('save-hint').className = 'hint';
  $('save-hint').textContent = '模板已填入；把 uid/deviceid/msisdn 换成真机抓包值后保存。';
}

$('save').addEventListener('click', saveConfig);
$('template').addEventListener('click', fillTemplate);
$('selftest').addEventListener('click', doSelftest);
$('status').addEventListener('click', doStatus);
$('run').addEventListener('click', doRun);
$('report').addEventListener('click', doReport);

loadConfig();
