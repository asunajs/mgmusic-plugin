// plugins/js/mgmusic-plugin.js —— 咪咕音乐金币中心（QuickJS 插件）
//
// 只依赖 ECMAScript + host-api。
// 配置在 <PLUGIN_DATA_DIR>/mgmusic-plugin/config.json（config() 读取）。
//
// 任务：
//   daily  —— 00:05 / 12:05 / 22:05：login-access + qsq + zyd-sign + 窗口打卡
//             + 听歌补报到 topup_min + 领取已达档位
//   report —— 手动/面板建任务：补报一次 song-duration 并领奖
//
// 说明：
//   · 协议结论基于 2026-10-15 实测
//   · songTime 按 ce 记账；上报/领奖必须同一 ce
//   · 所有接口幂等；重复 report 无副作用
//   · 咪咕接口对 Accept-Encoding 敏感，统一 identity，避免 gzip 无法解
import {
  config,
  info,
  success,
  fail,
  warn,
  error,
  register_cron,
  register_handler,
  register_route,
  register_nav,
  http_fetch,
} from 'host-api';
import fs from 'node:fs';

const VERSION = '0.1.0';
const PLUGIN = 'mgmusic-plugin';
const API = '/plugins/mgmusic-plugin/api';

const BASE = 'https://app.c.nf.migu.cn';
const ACTIVITY = 'MAC_KF_CBH_JBZX';
const REFERER = 'https://h5.nf.migu.cn/app/v4/n/gold-coin-center/index.html?cfrom=D06_4107_mgyywdys';
const UA = 'Mozilla/5.0 (Linux; Android 16; M2102K1C Build/SKQ1.211006.001; wv) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Version/4.0 Chrome/148.0.7778.215 Mobile Safari/537.36';

const SD_PATH = '/act-message/report/song-duration/v1';
const SD_UA = 'Mozilla/5.0 (Linux; U; Android 16; zh-cn; M2102K1C Build/SKQ1.211006.001) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Version/4.0 Chrome/148.0.7778.215 Mobile Safari/537.36';

// ce / song-duration body 共用的加法 Vigenère key（16 字节 ASCII）
const MG_KEY = 'ccTWaprX2aWmTIgA';

// 签名只追加证书 hex 字符串的前 32 个 ASCII 字符。
// 这里只嵌这 32 个字符；要换证书时在配置里填完整 cert 即可覆盖。
const DEFAULT_CERT_PREFIX = '308202333082019ca00302010202044d';

// 任务窗口（小时，左闭右开）；null = 全天可报
const REPORT_TASKS = [
    ['qsq', '每日浏览社区频道', 8, null],
    ['zyd-sign', '前往中国移动APP', 5, null],
    ['noon-check', '每日饭点打卡', 3, [12, 13]],
    ['night-check', '每日晚安打卡', 3, [22, 23]],
];

const DEFAULTS = {
    devices: [],
    topup_min: 30,
    report_ms: 60000,
    timeout_ms: 15000,
    cert: '',
    tls: '', // '' = 默认 rustls；'native' = 平台 TLS（老网关用）
};

const HEX = '0123456789abcdef';

// ──────────────────────────────────────────────────────────── 字节 / 编码

/** 字符串 → UTF-8 字节。QuickJS 没有 TextEncoder，这里按码点手写。 */
function utf8(s) {
    const out = [];
    for (let i = 0; i < s.length; i += 1) {
        let cp = s.charCodeAt(i);
        if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < s.length) {
            const low = s.charCodeAt(i + 1);
            if (low >= 0xdc00 && low <= 0xdfff) {
                cp = 0x10000 + ((cp - 0xd800) << 10) + (low - 0xdc00);
                i += 1;
            } else {
                cp = 0xfffd;
            }
        } else if (cp >= 0xd800 && cp <= 0xdfff) {
            cp = 0xfffd;
        }
        if (cp < 0x80) {
            out.push(cp);
        } else if (cp < 0x800) {
            out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
        } else if (cp < 0x10000) {
            out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        } else {
            out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f),
                0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        }
    }
    return Uint8Array.from(out);
}

function toHexUpper(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 1) {
        const b = bytes[i];
        s += HEX[(b >> 4) & 15] + HEX[b & 15];
    }
    return s.toUpperCase();
}

/** 加法 Vigenère（字节 + key[i%16]），输出大写 hex；ce 与 song-duration body 共用。 */
function vigenereHex(text, key) {
    const b = utf8(text);
    const k = utf8(key);
    let s = '';
    for (let i = 0; i < b.length; i += 1) {
        const v = (b[i] + k[i % k.length]) & 0xff;
        s += HEX[(v >> 4) & 15] + HEX[v & 15];
    }
    return s.toUpperCase();
}

function mgEncode(text) {
    return vigenereHex(text, MG_KEY);
}

function makeCe(uid, ip, msisdn, deviceId) {
    const pt = 'uid=' + uid + '&ip=' + ip + '&msisdn=' + msisdn + '&deviceId=' + deviceId;
    return vigenereHex(pt, MG_KEY);
}

// ──────────────────────────────────────────────────────────── MD5 变体

const MD5_S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K = (() => {
    const k = new Uint32Array(64);
    for (let i = 0; i < 64; i += 1) {
        k[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
    }
    return k;
})();

// 注意：这是本 so 的特征 —— 标准 MD5 IV 的 B/D 互换了
const MD5_IV = [0x67452301, 0x10325476, 0x98badcfe, 0xefcdab89];

function rotl(x, n) {
    return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function md5Block(state, block) {
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;
    const m = new Uint32Array(16);
    for (let j = 0; j < 16; j += 1) {
        const o = j * 4;
        m[j] = ((block[o] | (block[o + 1] << 8) | (block[o + 2] << 16) | (block[o + 3] << 24)) >>> 0);
    }
    for (let i = 0; i < 64; i += 1) {
        let f;
        let g;
        if (i < 16) {
            f = (b & c) | (~b & d);
            g = i;
        } else if (i < 32) {
            f = (d & b) | (~d & c);
            g = (5 * i + 1) & 15;
        } else if (i < 48) {
            f = b ^ c ^ d;
            g = (3 * i + 5) & 15;
        } else {
            f = c ^ (b | ~d);
            g = (7 * i) & 15;
        }
        f = (f + a + MD5_K[i] + m[g]) >>> 0;
        a = d;
        d = c;
        c = b;
        b = (b + rotl(f, MD5_S[i])) >>> 0;
    }
    return [
        (aa + a) >>> 0,
        (bb + b) >>> 0,
        (cc + c) >>> 0,
        (dd + d) >>> 0,
    ];
}

function whiten(bytes, s) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) {
        s = (s + (bytes[i] << 1) + 1) & 0xff;
        out[i] = s;
    }
    return { bytes: out, s: s };
}

/**
 * 签名流程：start(cert) → append(each) → end()。
 *
 * 数据 = 所有 append + cert 前 32 个 ASCII 字符；
 * 每个 64B 块先做 s=(s+2b+1)&0xff 的链式白化，再走 MD5 压缩；
 * 尾巴补 0x80 + 0 到 64B，**不写 64 位长度字段**；尾巴为空则连 0x80 都不补。
 */
function mgSign(appends, cert) {
    const certPrefix = (cert && cert.length >= 32 ? cert : DEFAULT_CERT_PREFIX).slice(0, 32);
    const chunks = appends.concat([utf8(certPrefix)]);
    let total = 0;
    for (let i = 0; i < chunks.length; i += 1) total += chunks[i].length;
    const data = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < chunks.length; i += 1) {
        data.set(chunks[i], off);
        off += chunks[i].length;
    }

    let state = MD5_IV.slice();
    let s = 0x7a;
    const full = Math.floor(data.length / 64);
    for (let bi = 0; bi < full; bi += 1) {
        const w = whiten(data.subarray(bi * 64, (bi + 1) * 64), s);
        s = w.s;
        state = md5Block(state, w.bytes);
    }
    const rem = data.subarray(full * 64);
    if (rem.length > 0) {
        const w = whiten(rem, s);
        s = w.s;
        const last = new Uint8Array(64);
        last.set(w.bytes);
        last[rem.length] = 0x80;
        state = md5Block(state, last);
    }

    // 16 字节 state 按小端逐 word 转 hex
    let out = '';
    for (let i = 0; i < 4; i += 1) {
        const v = state[i];
        for (let j = 0; j < 4; j += 1) {
            const byte = (v >>> (8 * j)) & 0xff;
            out += HEX[(byte >> 4) & 15] + HEX[byte & 15];
        }
    }
    return out.toUpperCase();
}

// ──────────────────────────────────────────────────────────── 工具

function clampInt(v, min, max, def) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.floor(n)));
}

function deviceLabel(dev, i) {
    return (dev && dev.label) ? String(dev.label) : ('device-' + (i + 1));
}

function mask(v, head, tail) {
    const s = String(v === undefined || v === null ? '' : v);
    if (s.length <= head + tail) return s.slice(0, 2) + '***';
    return s.slice(0, head) + '***' + s.slice(-tail);
}

function parseJsonSafe(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

function apiCode(data) {
    if (!data || data.code === undefined || data.code === null) return '';
    return String(data.code);
}

function apiInfo(data) {
    if (!data) return '';
    const v = data.info !== undefined ? data.info
        : (data.message !== undefined ? data.message : data.msg);
    return v === undefined || v === null ? '' : String(v);
}

function uuidV4() {
    let s = '';
    for (let i = 0; i < 36; i += 1) {
        if (i === 8 || i === 13 || i === 18 || i === 23) {
            s += '-';
        } else if (i === 14) {
            s += '4';
        } else if (i === 19) {
            s += HEX[(Math.random() * 4 | 0) + 8];
        } else {
            s += HEX[Math.random() * 16 | 0];
        }
    }
    return s;
}

function inWindow(win) {
    if (!win) return true;
    const h = new Date().getHours();
    return h >= win[0] && h < win[1];
}

function loadConfig() {
    let raw;
    try {
        raw = config() || {};
    } catch (e) {
        throw new Error('读取配置失败: ' + (e && e.message ? e.message : e));
    }
    const cfg = Object.assign({}, DEFAULTS, raw);
    if (!Array.isArray(cfg.devices)) cfg.devices = [];
    cfg.topup_min = clampInt(cfg.topup_min, 0, 1440, DEFAULTS.topup_min);
    cfg.report_ms = clampInt(cfg.report_ms, 1000, 6 * 3600 * 1000, DEFAULTS.report_ms);
    cfg.timeout_ms = clampInt(cfg.timeout_ms, 1000, 60000, DEFAULTS.timeout_ms);
    cfg.cert = typeof cfg.cert === 'string' ? cfg.cert.trim() : '';
    cfg.tls = cfg.tls === 'native' ? 'native' : '';
    return cfg;
}

function devCe(dev) {
    if (dev && dev.ce) return String(dev.ce);
    if (!dev || !dev.uid || !dev.msisdn) {
        throw new Error('缺 ce 且缺 uid/msisdn，无法自铸 ce');
    }
    return makeCe(String(dev.uid), String(dev.ip || '127.0.0.1'),
                  String(dev.msisdn), String(dev.deviceid || ''));
}

function certOf(cfg) {
    return cfg.cert && cfg.cert.length >= 32 ? cfg.cert : DEFAULT_CERT_PREFIX;
}

// ──────────────────────────────────────────────────────────── HTTP

function fetchRaw(method, url, headers, body, cfg) {
    const opts = {
        method: method,
        headers: headers,
        timeout_ms: cfg.timeout_ms,
    };
    if (body !== undefined) opts.body = body;
    if (cfg.tls === 'native') opts.tls = 'native';
    let res;
    try {
        res = http_fetch(url, opts);
    } catch (e) {
        throw new Error('请求失败: ' + (e && e.message ? e.message : e));
    }
    if (res && res.error) throw new Error('请求失败: ' + res.error);
    if (!res || typeof res.body !== 'string') {
        throw new Error('响应形状异常: ' + JSON.stringify(res).slice(0, 200));
    }
    const enc = res.headers && (res.headers['content-encoding'] || res.headers['Content-Encoding']);
    if (enc && String(enc).toLowerCase().indexOf('gzip') >= 0) {
        throw new Error('响应是 gzip（插件未内置解压）；请把 accept-encoding 设为 identity');
    }
    return res;
}

function h5Headers(dev, ce) {
    const h = {
        appid: 'music',
        test: '00',
        ce: ce,
        deviceid: dev.deviceid ? String(dev.deviceid) : '',
        imei: 'h5page',
        imsi: 'h5page',
        channel: '0147151',
        activityid: ACTIVITY,
        platform: 'H5',
        uid: dev.uid ? String(dev.uid) : '',
        logid: 'cfrom=D06_4107_mgyywdys&appId=music',
        'user-agent': UA,
        version: '8.9.3',
        ua: 'Android_migu',
        origin: 'https://h5.nf.migu.cn',
        'x-requested-with': 'cmccwm.mobilemusic',
        referer: REFERER,
        accept: 'application/json, text/plain, */*',
        'accept-encoding': 'identity',
    };
    if (dev.cookie) h.cookie = String(dev.cookie);
    return h;
}

function reportHeaders(dev, ce, ts, sign, bodyHex) {
    return {
        randomsessionkey: '000000',
        'mgm-user-agent': 'M2102K1C',
        'user-agent': SD_UA,
        channel: '0147151',
        language: 'Chinese',
        ua: 'Android_migu',
        mode: 'android',
        appid: 'music',
        brand: 'OnePlus',
        recommendstatus: '1',
        version: '8.9.3',
        'mgm-network-type': '03',
        'mgm-network-operators': '03',
        'mgm-network-standard': '05',
        'accept-language': 'zh-CN,zh;q=0.8',
        subchannel: '',
        hwid: '',
        oaid: '',
        platform: 'M2102K1C',
        userlevel: '0',
        osversion: 'Android 16',
        pkgname: 'cmccwm.mobilemusic',
        verify: 'verify',
        logid: ts,
        ce: ce,
        os: 'Android',
        buildid: '20260929205658',
        token: '',
        'content-type': 'application/json;charset=utf-8',
        'content-length': String(bodyHex.length),
        signversion: 'V005',
        sign: sign,
        timestamp: ts,
        'accept-encoding': 'identity',
    };
}

function callApi(dev, cfg, method, path, bodyObj) {
    const ce = devCe(dev);
    const headers = h5Headers(dev, ce);
    let body;
    if (bodyObj !== undefined) {
        body = JSON.stringify(bodyObj);
        headers['content-type'] = 'application/json;charset=utf-8';
    }
    const res = fetchRaw(method, BASE + path, headers, body, cfg);
    let data;
    try {
        data = JSON.parse(res.body);
    } catch (e) {
        throw new Error('接口返回非 JSON (HTTP ' + res.status + '): ' + res.body.slice(0, 120));
    }
    return { status: res.status, data: data, raw: res.body, headers: res.headers };
}

function ensureOk(res, what) {
    const code = apiCode(res.data);
    if (code !== '000000') {
        throw new Error(what + ': ' + (code || '?') + ' ' + apiInfo(res.data));
    }
    return res.data;
}

// ──────────────────────────────────────────────────────────── 咪咕业务

function queryState(dev, cfg) {
    const qt = ensureOk(callApi(dev, cfg, 'GET', '/act-task/query-tasks'), 'query-tasks');
    const tasks = {};
    const list = Array.isArray(qt.data) ? qt.data : [];
    for (let i = 0; i < list.length; i += 1) {
        const t = list[i];
        if (t && t.id !== undefined) tasks[t.id] = t;
    }
    const beanRes = callApi(dev, cfg, 'GET', '/act-jbzx/ai-bean/query-available');
    const beanData = ensureOk(beanRes, 'ai-bean');
    const bean = (beanData.data && beanData.data.availableNum !== undefined)
        ? Number(beanData.data.availableNum) : -1;
    return { tasks: tasks, bean: bean };
}

function getSongTask(dev, cfg) {
    const r = ensureOk(callApi(dev, cfg, 'GET', '/act-jbzx/song-task/v2.0'), 'song-task');
    return r.data || {};
}

/** 上报 song-duration。返回 { status, body, headers, ts }。 */
function reportDuration(dev, durMs, cfg) {
    const ce = devCe(dev);
    const ts = String(Date.now());
    const pt = JSON.stringify({ duration: Math.floor(durMs), transactionId: uuidV4() });
    const bodyHex = mgEncode(pt);
    const sign = mgSign([utf8(SD_PATH + ce + ts + bodyHex)], certOf(cfg));
    const headers = reportHeaders(dev, ce, ts, sign, bodyHex);
    const res = fetchRaw('POST', BASE + SD_PATH, headers, bodyHex, cfg);
    return { status: res.status, body: res.body, headers: res.headers, ts: ts };
}

function reportCode(body) {
    const data = parseJsonSafe(body);
    return data ? apiCode(data) : '';
}

function receiveSongRewards(dev, cfg, label) {
    const lines = [];
    const st = getSongTask(dev, cfg);
    const songTime = Number(st.songTime || 0);
    const tasks = Array.isArray(st.tasks) ? st.tasks : [];
    let gained = 0;
    for (let i = 0; i < tasks.length; i += 1) {
        const t = tasks[i];
        if (!t || t.id === undefined) continue;
        if (Number(t.status) === 2) continue; // 2 = 已领取
        const r = callApi(dev, cfg, 'POST', '/act-jbzx/receive-task-rewards/v2.0', { taskId: t.id });
        const code = apiCode(r.data);
        if (code === '000000') {
            const n = Number((r.data.data || {}).aiBeanNum || 0);
            gained += n;
            lines.push('[' + label + '] ' + t.id + ': 领取 +' + n + ' 音符');
        } else if (code === '200002') {
            // 已领，静默
        } else {
            lines.push('[' + label + '] ' + t.id + ': ' + code + ' ' + apiInfo(r.data));
        }
    }
    lines.push('[' + label + '] 听歌: songTime=' + (songTime / 60000).toFixed(1) + 'min 本轮领奖+' + gained);
    return { lines: lines, gained: gained, songTime: songTime };
}

function topupSongtime(dev, cfg, label) {
    const targetMin = Number(dev.topup_min !== undefined ? dev.topup_min : cfg.topup_min);
    if (!(targetMin > 0)) {
        return { lines: ['[' + label + '] 听歌补报已关闭(topup_min=0)'], ok: true };
    }
    const st = getSongTask(dev, cfg);
    const songTime = Number(st.songTime || 0);
    const targetMs = Math.floor(targetMin * 60000);
    const need = targetMs - songTime;
    if (need <= 0) {
        return {
            lines: ['[' + label + '] 听歌 ' + (songTime / 60000).toFixed(1) + 'min ≥ ' + targetMin + 'min, 无需补报'],
            ok: true,
        };
    }
    let r;
    try {
        r = reportDuration(dev, need, cfg);
    } catch (e) {
        return {
            lines: ['[' + label + '] 补报 ' + (need / 60000).toFixed(1) + 'min 失败: '
                + (e && e.message ? e.message : e), '[' + label + '] 补报失败, 中止'],
            ok: false,
        };
    }
    const code = reportCode(r.body);
    const ok = code === '000000' || r.body.indexOf('000000') >= 0;
    const lines = ['[' + label + '] 补报 ' + (need / 60000).toFixed(1) + 'min: HTTP '
        + r.status + ' ' + r.body.slice(0, 120)];
    if (!ok) lines.push('[' + label + '] 补报失败, 中止');
    return { lines: lines, ok: ok };
}

function runDevice(dev, cfg, label) {
    const lines = [];
    const st = queryState(dev, cfg);
    lines.push('[' + label + '] 期初: 音符=' + st.bean + ' 任务数=' + Object.keys(st.tasks).length);

    const login = callApi(dev, cfg, 'GET', '/act-task/login-access');
    lines.push('[' + label + '] login-access: ' + apiCode(login.data));

    for (let i = 0; i < REPORT_TASKS.length; i += 1) {
        const tid = REPORT_TASKS[i][0];
        const name = REPORT_TASKS[i][1];
        const win = REPORT_TASKS[i][3];
        const t = st.tasks[tid] || {};
        if (Number(t.completeTime || 0) >= Number(t.needCompleteTime || 1)) {
            lines.push('[' + label + '] ' + name + ': 今日已完成,跳过');
            continue;
        }
        if (!inWindow(win)) {
            lines.push('[' + label + '] ' + name + ': 非窗口时段(' + win.join('-') + '),跳过');
            continue;
        }
        const r = callApi(dev, cfg, 'POST', '/act-task/task-report', { taskId: tid });
        const code = apiCode(r.data);
        const extra = (r.data.data && r.data.data.drawNum !== undefined)
            ? ' drawNum=' + r.data.data.drawNum : '';
        lines.push('[' + label + '] ' + name + ': '
            + (code === '000000' ? 'OK' : code + ' ' + apiInfo(r.data)) + extra);
    }

    const top = topupSongtime(dev, cfg, label);
    for (let i = 0; i < top.lines.length; i += 1) lines.push(top.lines[i]);

    const rec = receiveSongRewards(dev, cfg, label);
    for (let i = 0; i < rec.lines.length; i += 1) lines.push(rec.lines[i]);

    const st2 = queryState(dev, cfg);
    const ids = Object.keys(st2.tasks);
    let done = 0;
    for (let i = 0; i < ids.length; i += 1) {
        const t = st2.tasks[ids[i]];
        if (Number(t.completeTime || 0) >= Number(t.needCompleteTime || 1)) done += 1;
    }
    const delta = (st.bean >= 0 && st2.bean >= 0) ? (' (+' + (st2.bean - st.bean) + ')') : '';
    lines.push('[' + label + '] 期末: 音符=' + st2.bean + ' 完成=' + done + '/' + ids.length + delta);
    return lines;
}

function logLines(lines) {
    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (/FAIL|失败|异常/.test(line)) fail(line);
        else if (/OK|领取|无需补报|已完成/.test(line)) success(line);
        else info(line);
    }
}

function runDaily() {
    const cfg = loadConfig();
    if (!cfg.devices.length) {
        const line = '[' + PLUGIN + '] 未配置 devices，跳过';
        warn(line);
        return { ok: true, skipped: true, lines: [line] };
    }
    const lines = [];
    let failCount = 0;
    for (let i = 0; i < cfg.devices.length; i += 1) {
        const dev = cfg.devices[i];
        const label = deviceLabel(dev, i);
        try {
            const part = runDevice(dev, cfg, label);
            for (let j = 0; j < part.length; j += 1) lines.push(part[j]);
        } catch (e) {
            failCount += 1;
            lines.push('[' + label + '] FAIL ' + (e && e.message ? e.message : e));
        }
    }
    logLines(lines);
    if (failCount > 0) {
        const err = new Error(failCount + '/' + cfg.devices.length + ' 个账号失败');
        err.lines = lines;
        throw err;
    }
    return { ok: true, lines: lines };
}

function statusAll() {
    const cfg = loadConfig();
    const lines = [];
    let failCount = 0;
    for (let i = 0; i < cfg.devices.length; i += 1) {
        const dev = cfg.devices[i];
        const label = deviceLabel(dev, i);
        try {
            const st = queryState(dev, cfg);
            lines.push('[' + label + '] 音符=' + st.bean + ' ce=' + mask(devCe(dev), 8, 4));
            const ids = Object.keys(st.tasks);
            for (let j = 0; j < ids.length; j += 1) {
                const t = st.tasks[ids[j]];
                lines.push('  ' + (t.taskName || ids[j]) + ': '
                    + Number(t.completeTime || 0) + '/' + Number(t.needCompleteTime || 1));
            }
        } catch (e) {
            failCount += 1;
            lines.push('[' + label + '] FAIL ' + (e && e.message ? e.message : e));
        }
    }
    if (!cfg.devices.length) lines.push('（未配置 devices）');
    return { ok: failCount === 0, lines: lines };
}

function reportAll(ms) {
    const cfg = loadConfig();
    if (!cfg.devices.length) throw new Error('未配置 devices');
    const lines = [];
    let failCount = 0;
    for (let i = 0; i < cfg.devices.length; i += 1) {
        const dev = cfg.devices[i];
        const label = deviceLabel(dev, i);
        try {
            const r = reportDuration(dev, ms, cfg);
            const code = reportCode(r.body);
            lines.push('[' + label + '] song-duration +' + ms + 'ms: HTTP ' + r.status
                + ' ' + r.body.slice(0, 120));
            if (code !== '000000' && r.body.indexOf('000000') < 0) failCount += 1;
            const rec = receiveSongRewards(dev, cfg, label);
            for (let j = 0; j < rec.lines.length; j += 1) lines.push(rec.lines[j]);
        } catch (e) {
            failCount += 1;
            lines.push('[' + label + '] report FAIL ' + (e && e.message ? e.message : e));
        }
    }
    logLines(lines);
    return { ok: failCount === 0, lines: lines };
}

function selftest() {
    const got = mgSign([utf8('hello')], DEFAULT_CERT_PREFIX);
    const want = '0B646EAD2072F5A932D2F0A742BE72ED';
    return { ok: got === want, got: got, want: want, version: VERSION };
}

// ──────────────────────────────────────────────────────────── 配置读写 / 路由

function validateConfig(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('配置必须是 JSON 对象');
    }
    const cfg = Object.assign({}, DEFAULTS, input);
    if (!Array.isArray(cfg.devices)) throw new Error('devices 必须是数组');
    cfg.topup_min = clampInt(cfg.topup_min, 0, 1440, DEFAULTS.topup_min);
    cfg.report_ms = clampInt(cfg.report_ms, 1000, 6 * 3600 * 1000, DEFAULTS.report_ms);
    cfg.timeout_ms = clampInt(cfg.timeout_ms, 1000, 60000, DEFAULTS.timeout_ms);
    cfg.cert = typeof cfg.cert === 'string' ? cfg.cert.trim() : '';
    cfg.tls = cfg.tls === 'native' ? 'native' : '';
    if (cfg.cert && cfg.cert.length < 32) throw new Error('cert 至少 32 个 hex 字符（或留空用内置前缀）');
    for (let i = 0; i < cfg.devices.length; i += 1) {
        const d = cfg.devices[i];
        if (!d || typeof d !== 'object' || Array.isArray(d)) {
            throw new Error('devices[' + i + '] 必须是对象');
        }
        if (!d.ce && (!d.uid || !d.msisdn)) {
            throw new Error('devices[' + i + ']: ce 为空时必须给 uid + msisdn');
        }
        if (!d.deviceid) throw new Error('devices[' + i + ']: 缺 deviceid');
        if (d.topup_min !== undefined) d.topup_min = clampInt(d.topup_min, 0, 1440, DEFAULTS.topup_min);
    }
    return cfg;
}

function saveConfig(input) {
    const cfg = validateConfig(input);
    fs.writeFileSync('config.json', JSON.stringify(cfg, null, 2), 'utf8');
    return cfg;
}

function json(status, obj) {
    return {
        status: status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj),
    };
}

function route(fn) {
    return function (req) {
        try {
            return fn(req);
        } catch (e) {
            const out = { ok: false, error: (e && e.message ? e.message : String(e)) };
            if (e && e.lines) out.lines = e.lines;
            return json(200, out);
        }
    };
}

function parseBody(req) {
    if (!req || req.body === undefined || req.body === null || req.body === '') return {};
    if (typeof req.body === 'object') return req.body;
    try {
        return JSON.parse(req.body);
    } catch (e) {
        throw new Error('请求体不是 JSON');
    }
}

register_route(API + '/config', 'GET', route(function () {
    const cfg = loadConfig();
    return json(200, { ok: true, config: cfg });
}));

register_route(API + '/config', 'POST', route(function (req) {
    const body = parseBody(req);
    const input = body && body.config ? body.config : body;
    const cfg = saveConfig(input);
    return json(200, { ok: true, config: cfg });
}));

register_route(API + '/status', 'GET', route(function () {
    return json(200, statusAll());
}));

register_route(API + '/run', 'POST', route(function () {
    return json(200, runDaily());
}));

register_route(API + '/report', 'POST', route(function (req) {
    const body = parseBody(req);
    const cfg = loadConfig();
    const ms = clampInt(body.ms, 1000, 6 * 3600 * 1000, cfg.report_ms);
    return json(200, reportAll(ms));
}));

register_route(API + '/selftest', 'GET', route(function () {
    return json(200, selftest());
}));

register_nav({ label: '咪咕音乐', icon: '🎵' });

register_cron('daily', '0 5 0,12,22 * * *', function () {
    runDaily();
}, { summary: '每日 00:05/12:05/22:05 签到 + 听歌补报' });

register_handler('report', function () {
    const cfg = loadConfig();
    const r = reportAll(cfg.report_ms);
    if (!r.ok) throw new Error('补报有失败，详见插件日志');
    return r;
});

try {
    const cfg = loadConfig();
    info(PLUGIN + ' v' + VERSION + ' 已加载：' + cfg.devices.length
        + ' 个设备，topup_min=' + cfg.topup_min);
} catch (e) {
    warn(PLUGIN + ' v' + VERSION + ' 已加载，但配置读取失败：'
        + (e && e.message ? e.message : e));
}
