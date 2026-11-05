'use strict';

// 咪咕音乐插件页：账号 / 运行 / 设置三块。
// 账号走短信登录，不再让用户直接编辑 devices/uid/ce 的原始 JSON。
const API = '/plugins/mgmusic-plugin/api';
const $ = (id) => document.getElementById(id);

const S = {
  config: null,
  editing: -1,
  sending: false,
  sendTimer: null,
};

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function clampInt(v, min, max, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function mask(v, head, tail) {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= head + tail) return s;
  return s.slice(0, head) + '***' + s.slice(-tail);
}

function setState(kind, text) {
  const el = $('state');
  el.className = 'badge ' + kind;
  el.textContent = text;
}

function show(text) {
  $('out').textContent = text;
}

function showLines(lines) {
  show(Array.isArray(lines) ? lines.join('\n') : String(lines || ''));
}

function setHint(id, kind, text) {
  const el = $(id);
  el.className = 'hint' + (kind === 'error' ? ' err-text' : '');
  el.textContent = text || '';
}

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

async function withBusy(btn, fn) {
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '执行中…';
  try {
    await fn();
  } catch (e) {
    showLines(e.lines || ('失败：' + e.message));
    setState('failed', '有失败');
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function deviceLabel(dev, index) {
  const label = String((dev && dev.label) || '').trim();
  if (label) return label;
  const phone = String((dev && dev.msisdn) || '');
  return phone ? ('migu-' + phone.slice(-4)) : ('账号 ' + (index + 1));
}

function sourceLabel(dev) {
  const source = String((dev && dev.source) || '');
  if (source === 'macos-app' || source === 'app-account.json') return 'App 同步';
  return '短信登录';
}

function renderAccounts() {
  const cfg = S.config || {};
  const devices = Array.isArray(cfg.devices) ? cfg.devices : [];
  const list = $('account-list');
  list.textContent = '';

  const mode = cfg.readonly ? '只读模式' : '可写';
  $('account-summary').textContent = devices.length
    ? devices.length + ' 个账号 · ' + mode
    : '还没有账号';
  $('account-empty').hidden = devices.length > 0;

  devices.forEach((dev, index) => {
    const li = document.createElement('li');
    li.className = 'account-item';

    const main = document.createElement('div');
    main.className = 'account-main';

    const title = document.createElement('div');
    title.className = 'account-title';
    const name = document.createElement('strong');
    name.textContent = deviceLabel(dev, index);
    title.appendChild(name);

    const source = document.createElement('span');
    source.className = 'badge soft';
    source.textContent = sourceLabel(dev);
    title.appendChild(source);

    if (cfg.readonly) {
      const ro = document.createElement('span');
      ro.className = 'badge soft';
      ro.textContent = '只读';
      title.appendChild(ro);
    }
    main.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'account-meta';
    meta.textContent = [
      dev.msisdn ? ('手机号 ' + mask(dev.msisdn, 3, 4)) : '手机号未知',
      dev.uid ? ('uid ' + mask(dev.uid, 6, 4)) : 'uid 未解析',
    ].join(' · ');
    main.appendChild(meta);

    const sub = document.createElement('div');
    sub.className = 'account-sub';
    const topup = Number(dev.topup_min === undefined ? cfg.topup_min : dev.topup_min) || 0;
    sub.textContent = '听歌补报 ' + topup + ' 分钟'
      + (dev.cookie ? ' · 已保存会话 cookie' : ' · 暂无会话 cookie');
    main.appendChild(sub);

    const actions = document.createElement('div');
    actions.className = 'account-actions';
    const query = document.createElement('button');
    query.className = 'btn btn-sm';
    query.type = 'button';
    query.textContent = '查询';
    query.addEventListener('click', () => doStatus());
    const edit = document.createElement('button');
    edit.className = 'btn btn-sm';
    edit.type = 'button';
    edit.textContent = '设置';
    edit.addEventListener('click', () => openAccountDialog(index));
    const remove = document.createElement('button');
    remove.className = 'btn btn-sm danger-text';
    remove.type = 'button';
    remove.textContent = '删除';
    remove.addEventListener('click', () => removeAccount(index));
    actions.appendChild(query);
    actions.appendChild(edit);
    actions.appendChild(remove);

    li.appendChild(main);
    li.appendChild(actions);
    list.appendChild(li);
  });
}

function fillSettings() {
  const cfg = S.config || {};
  $('set-readonly').checked = !!cfg.readonly;
  $('set-topup').value = cfg.topup_min === undefined ? 30 : cfg.topup_min;
  $('set-app-import').checked = !!(cfg.app_import && cfg.app_import.enabled);
  $('set-timeout').value = cfg.timeout_ms === undefined ? 15000 : cfg.timeout_ms;
  $('set-report-ms').value = cfg.report_ms === undefined ? 60000 : cfg.report_ms;
  $('set-tls').value = cfg.tls === 'native' ? 'native' : '';
  $('set-cert').value = cfg.cert || '';
  const comment = cfg.comment || {};
  $('set-comment-enabled').checked = !!comment.enabled;
  $('set-comment-song').value = comment.song_id || '';
  $('set-comment-content').value = comment.content || '好听';
}

function renderAll() {
  renderAccounts();
  fillSettings();
  const readonly = !!(S.config && S.config.readonly);
  const report = $('report');
  if (report) {
    report.disabled = readonly;
    report.title = readonly ? '只读模式下不会补报/领奖' : '';
  }
}

function isAdminView() {
  const query = new URLSearchParams(window.location.search);
  return query.get('admin') === '1' || window.location.hash === '#admin';
}

function applyAdminView() {
  const card = $('settings-card');
  if (card) card.hidden = !isAdminView();
}

async function loadAll() {
  setState('idle', '读取中…');
  setHint('settings-hint', '', '');
  try {
    const data = await call('/config');
    S.config = data.config || {};
    renderAll();
    setState('success', '已连接');
  } catch (e) {
    setState('failed', '读取失败');
    setHint('settings-hint', 'error', e.message);
  }
}

async function saveConfigObject(cfg) {
  const data = await call('/config', { method: 'POST', body: cfg });
  S.config = data.config || {};
  renderAll();
  return data.config;
}

function openLoginDialog() {
  $('login-dialog').hidden = false;
  setHint('login-hint', '', '');
  $('login-phone').focus();
}

function closeLoginDialog() {
  $('login-dialog').hidden = true;
}

function setSendButton(text, disabled) {
  const btn = $('send-code');
  btn.textContent = text;
  btn.disabled = !!disabled;
}

function clearSendTimer() {
  if (S.sendTimer) {
    clearInterval(S.sendTimer);
    S.sendTimer = null;
  }
}

async function sendCode() {
  if (S.sending) return;
  const phone = ($('login-phone').value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    setHint('login-hint', 'error', '先填 11 位手机号');
    return;
  }
  S.sending = true;
  setSendButton('发送中…', true);
  setHint('login-hint', '', '正在向 passport 请求验证码…');
  try {
    const data = await call('/login/send', { method: 'POST', body: { msisdn: phone } });
    setHint('login-hint', '', data.message || '验证码已发送，请查收短信');
    $('login-code').focus();
    let left = 60;
    setSendButton('重发（' + left + 's）', true);
    clearSendTimer();
    S.sendTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearSendTimer();
        setSendButton('发送验证码', false);
      } else {
        setSendButton('重发（' + left + 's）', true);
      }
    }, 1000);
  } catch (e) {
    setSendButton('发送验证码', false);
    setHint('login-hint', 'error', e.message);
  } finally {
    S.sending = false;
  }
}

async function doLogin() {
  const phone = ($('login-phone').value || '').trim();
  const code = ($('login-code').value || '').trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    setHint('login-hint', 'error', '先填 11 位手机号');
    return;
  }
  if (!/^\d{6}$/.test(code)) {
    setHint('login-hint', 'error', '填 6 位短信验证码');
    return;
  }
  const btn = $('login');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '登录中…';
  setHint('login-hint', '', '正在校验验证码并解析 uid…');
  try {
    const data = await call('/login/verify', { method: 'POST', body: { msisdn: phone, code: code } });
    S.config = data.config || S.config;
    renderAll();
    closeLoginDialog();
    showLines(data.lines);
    setState('success', '已登录');
    setHint('settings-hint', '', '账号已保存；建议先点「查询状态」确认 uid 和音符。');
  } catch (e) {
    setHint('login-hint', 'error', e.message);
    if (e.lines) showLines(e.lines);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

function openAccountDialog(index) {
  const devices = (S.config && Array.isArray(S.config.devices)) ? S.config.devices : [];
  if (!devices[index]) return;
  S.editing = index;
  const dev = devices[index];
  $('account-title').textContent = '账号设置 · ' + deviceLabel(dev, index);
  $('account-label').value = dev.label || '';
  $('account-topup').value = dev.topup_min === undefined
    ? ((S.config && S.config.topup_min) || 0) : dev.topup_min;
  setHint('account-hint', '', '');
  $('account-dialog').hidden = false;
  $('account-label').focus();
}

function closeAccountDialog() {
  $('account-dialog').hidden = true;
  S.editing = -1;
}

async function saveAccount() {
  if (S.editing < 0) return;
  const devices = (S.config && Array.isArray(S.config.devices)) ? S.config.devices : [];
  const dev = devices[S.editing];
  if (!dev) return closeAccountDialog();
  const cfg = clone(S.config);
  const target = cfg.devices[S.editing];
  target.label = ($('account-label').value || '').trim();
  target.topup_min = clampInt($('account-topup').value, 0, 1440, 0);
  const btn = $('account-save');
  btn.disabled = true;
  try {
    await saveConfigObject(cfg);
    closeAccountDialog();
    setHint('settings-hint', '', '账号设置已保存');
  } catch (e) {
    setHint('account-hint', 'error', e.message);
  } finally {
    btn.disabled = false;
  }
}

async function removeAccount(index) {
  const devices = (S.config && Array.isArray(S.config.devices)) ? S.config.devices : [];
  const dev = devices[index];
  if (!dev) return;
  const name = deviceLabel(dev, index);
  if (!window.confirm('删除账号「' + name + '」？只删除本面板里的凭证，不会注销咪咕账号。')) return;
  const cfg = clone(S.config);
  cfg.devices.splice(index, 1);
  try {
    await saveConfigObject(cfg);
    setHint('settings-hint', '', '账号已删除');
  } catch (e) {
    setHint('settings-hint', 'error', e.message);
  }
}

async function saveSettings() {
  const cfg = clone(S.config || {});
  const wasReadonly = !!cfg.readonly;
  const nextReadonly = !!$('set-readonly').checked;
  if (wasReadonly && !nextReadonly && !window.confirm(
    '关闭只读模式后，daily/补报会真正上报任务并领取奖励。确定关闭？')) {
    return;
  }
  cfg.readonly = nextReadonly;
  cfg.topup_min = clampInt($('set-topup').value, 0, 1440, 30);
  cfg.app_import = Object.assign({}, cfg.app_import, { enabled: !!$('set-app-import').checked });
  cfg.timeout_ms = clampInt($('set-timeout').value, 1000, 60000, 15000);
  cfg.report_ms = clampInt($('set-report-ms').value, 1000, 21600000, 60000);
  cfg.tls = $('set-tls').value === 'native' ? 'native' : '';
  cfg.cert = ($('set-cert').value || '').trim();
  cfg.comment = Object.assign({}, cfg.comment, {
    enabled: !!$('set-comment-enabled').checked,
    song_id: ($('set-comment-song').value || '').trim(),
    content: ($('set-comment-content').value || '好听').trim() || '好听',
  });
  const btn = $('save-settings');
  btn.disabled = true;
  setHint('settings-hint', '', '保存中…');
  try {
    await saveConfigObject(cfg);
    setHint('settings-hint', '', '设置已保存');
    setState('success', '已保存');
  } catch (e) {
    setHint('settings-hint', 'error', e.message);
  } finally {
    btn.disabled = false;
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
    const ms = clampInt((S.config && S.config.report_ms) || 60000, 1000, 21600000, 60000);
    const data = await call('/report', { method: 'POST', body: { ms: ms } });
    showLines(data.lines);
    setState(data.ok ? 'success' : 'failed', data.ok ? '补报完成' : '补报有失败');
  });
}

async function doSelftest() {
  const out = $('advanced-out');
  out.hidden = false;
  out.textContent = '执行中…';
  try {
    const data = await call('/selftest');
    out.textContent = JSON.stringify(data, null, 2);
    setState(data.ok ? 'success' : 'failed', data.ok ? '签名自检通过' : '签名自检失败');
  } catch (e) {
    out.textContent = '失败：' + e.message;
    setState('failed', '签名自检失败');
  }
}

$('refresh').addEventListener('click', loadAll);
$('add-account').addEventListener('click', openLoginDialog);
$('login-close').addEventListener('click', closeLoginDialog);
$('login-cancel').addEventListener('click', closeLoginDialog);
$('send-code').addEventListener('click', sendCode);
$('login').addEventListener('click', doLogin);
$('account-close').addEventListener('click', closeAccountDialog);
$('account-cancel').addEventListener('click', closeAccountDialog);
$('account-save').addEventListener('click', saveAccount);
$('save-settings').addEventListener('click', saveSettings);
$('selftest').addEventListener('click', doSelftest);
$('status').addEventListener('click', doStatus);
$('run').addEventListener('click', doRun);
$('report').addEventListener('click', doReport);

applyAdminView();
loadAll();
