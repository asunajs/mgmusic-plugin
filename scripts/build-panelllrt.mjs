// 打包给 **panel-llrt（0.4.x / LLRT）** 的版本。
//
// 与 0.3.x 那版的关系：
//   · 本仓根目录的 `mgmusic.js` / `index.html` / `app.js` / `style.css` / `boot.js`
//     是 **QuickJS 老面板（0.3.x）** 的插件，仍在用（老面板停了也能手工装）。
//   · `llrt/` 是 **0.4.x 变体**：宿主契约（`panel:host`）、存储（`state` 表）、
//     WebUI（`/app.css` + `<p-*>` 套件）都不一样，差异不机械，所以单独维护一份源，
//     不用构建期转换（mcloud 那边选的是 A，这里是 B —— 差异有 200 多处，转换脚本会更难维护）。
//
// 产物直接写到 panel-llrt/plugins/：`mgmusic.js` + `mgmusic.webui/`。
// **不要手改那两个产物**：下次 `npm run build:panelllrt` 会把它们整段覆盖
// （panel-llrt/plugins/README.md 里也写着这条）。

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'llrt');
// 插件项目在 workspace/cmusic-others/ 下，面板仓在 workspace/ 下 —— 两层 ..
const OUT = process.env.PANEL_LLRT_PLUGINS ?? join(ROOT, '..', '..', 'panel-llrt', 'plugins');
const NAME = 'mgmusic';
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const src = readFileSync(join(SRC, 'mgmusic.js'), 'utf8');

// 产物自证：这几样只要缺一个，就说明拷的是老面板那份（0.3.x），别让它上 0.4.x 面板。
const must = [
  ["import host from 'panel:host'", '宿主契约：panel:host'],
  ['register_web(', '新面板的 WebUI 分发器'],
  ['sqlite_exec_sync(', 'state 表存储'],
];
for (const [needle, why] of must) {
  if (!src.includes(needle)) {
    console.error(`❌ llrt/mgmusic.js 缺少 ${JSON.stringify(needle)}（${why}）`);
    process.exit(1);
  }
}
// 0.3.x 的导入语句（注释里提到它没关系，只要没有真 import）
if (/^import[^\n]*from ['"]host-api['"]/m.test(src)) {
  console.error("❌ llrt/mgmusic.js 里还有 0.3.x 的 `from 'host-api'` 导入");
  process.exit(1);
}

const banner = [
  `// 由 cmusic-others/mgmusic-plugin/llrt/mgmusic.js 复制生成（panel-llrt 0.4.x 版）—— **不要手改这个文件**。`,
  '//',
  '//   改代码：编辑插件项目的 llrt/，然后 `npm run build:panelllrt`',
  `//   mgmusic-plugin ${pkg.version} · 插件 \`${NAME}\``,
  '',
].join('\n');

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${NAME}.js`), banner + src);
console.log(`  ✅ ${OUT}/${NAME}.js（${(Buffer.byteLength(banner + src) / 1024).toFixed(1)} KB）`);

// 界面：整目录替换（rmSync 先，避免删掉的文件留在产物里）
const webOut = join(OUT, `${NAME}.webui`);
rmSync(webOut, { recursive: true, force: true });
cpSync(join(SRC, 'webui'), webOut, { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js', 'boot.js']) {
  const kb = (Buffer.byteLength(readFileSync(join(webOut, f))) / 1024).toFixed(1);
  console.log(`  ✅ ${webOut}/${f}（${kb} KB）`);
}

// 面板侧的门禁：界面产物必须带 --style-ver（被 0.3.x 构建覆盖时会消失）
const css = readFileSync(join(webOut, 'style.css'), 'utf8');
if (!css.includes('--style-ver')) {
  console.error('❌ 产物 style.css 里没有 --style-ver：panel-llrt 的 check-plugin-style 会红');
  process.exit(1);
}
console.log('\n产物已写到 panel-llrt/plugins/（mgmusic.js + mgmusic.webui/）');
