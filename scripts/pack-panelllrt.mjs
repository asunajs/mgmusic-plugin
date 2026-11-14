// 打一个 **panel-llrt（0.4）形状** 的发布包。
//
// 和 `pack.sh` 的区别是**形状不同**：
//   · 0.3 老面板：`js/mgmusic.js` + `mgmusic/index.html`
//   · 0.4 面板：  `mgmusic.js` + `mgmusic.panel.json` + `mgmusic.webui/`（全部平铺在 PLUGINS_DIR 顶层）
//
// 必须平铺：0.4 的加载器只扫 `plugins/*.js`，清单读 `plugins/<name>.panel.json`，
// 界面读 `plugins/<name>.webui/`。塞进 `js/` 就等于「装了但面板看不见」。
//
// 产物：dist/mgmusic-plugin-<version>-panel04.zip（+ .sha256、SHA256SUMS）
// 发布给商店的资产；本地装实例还是走 `npm run deploy:panel`（不经过 zip）。

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeZip } from './zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist', 'panel-llrt');
const NAME = 'mgmusic';
const WEBUI_FILES = ['index.html', 'style.css', 'app.js', 'boot.js'];

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `mgmusic-plugin-${version}-panel04.zip`;
const outDir = join(ROOT, 'dist');
const zipPath = join(outDir, zipName);

// ① 产物得是**刚构建**的：先 npm run build:panelllrt
const files = [];
for (const f of [`${NAME}.js`, `${NAME}.panel.json`]) {
  const p = join(DIST, f);
  if (!existsSync(p)) die(`缺 ${f}（先 npm run build:panelllrt）`);
  files.push({ name: f, path: p });
}
for (const f of WEBUI_FILES) {
  const p = join(DIST, `${NAME}.webui`, f);
  if (!existsSync(p)) die(`缺 ${NAME}.webui/${f}（先 npm run build:panelllrt）`);
  files.push({ name: `${NAME}.webui/${f}`, path: p });
}

// ② 形状自检
for (const f of files) {
  if (f.name.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    die(`zip 里有面板会拒绝的路径：${f.name}`);
  }
  if (f.name.split('/').some((s) => s.startsWith('.'))) {
    die(`zip 里不允许隐藏路径段（面板会拒）：${f.name}`);
  }
}
if (!files.some((f) => f.name === `${NAME}.js`)) die(`${NAME}.js 不在包根目录（0.4 要求平铺）`);

// ③ 产物自证：必须是 0.4 契约，别把 0.3 那份打进发布包
const js = readFileSync(join(DIST, `${NAME}.js`), 'utf8');
if (!js.includes("from 'panel:host'") && !js.includes('from "panel:host"')) {
  die(`${NAME}.js 里没有 panel:host —— 这是 0.3 契约的产物，不能发 0.4 包`);
}

const entries = files.map((f) => ({ name: f.name, data: readFileSync(f.path) }));
const zip = makeZip(entries);
const sum = createHash('sha256').update(zip).digest('hex');

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
writeFileSync(zipPath, zip);
writeFileSync(`${zipPath}.sha256`, `${sum}  ${zipName}\n`);
writeFileSync(join(outDir, 'SHA256SUMS'), `${sum}  ${zipName}\n`);

const total = entries.reduce((n, e) => n + e.data.length, 0);
console.log(`✅ ${zipPath}`);
console.log(
  `   ${entries.length} 个文件，解压后 ${(total / 1024).toFixed(1)} KB，zip ${(zip.length / 1024).toFixed(1)} KB`,
);
console.log(`   sha256 ${sum}`);
for (const e of entries) console.log(`   · ${e.name}  ${(e.data.length / 1024).toFixed(1)} KB`);
