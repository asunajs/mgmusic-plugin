// 打包给 **panel-llrt（0.4.x / LLRT）** 的版本。
//
// 与 0.3.x 那版的关系：
//   · 本仓根目录的 `mgmusic.js` / `index.html` / `app.js` / `style.css` / `boot.js`
//     是 **QuickJS 老面板（0.3.x）** 的插件，仍在用（老面板停了也能手工装）。
//   · `llrt/` 是 **0.4.x 变体**：宿主契约（`panel:host`）、存储（`state` 表）、
//     WebUI（`/app.css` + `<p-*>` 套件）都不一样，差异不机械，所以单独维护一份源，
//     不用构建期转换（mcloud 那边选的是 A，这里是 B —— 差异有 200 多处，转换脚本会更难维护）。
//
// 产物写在**本仓** `dist/panel-llrt/`：`mgmusic.js` + `mgmusic.webui/`。
// 面板仓（panel-llrt）里**没有这个插件的代码** —— 分工是"面板提供面板、插件归插件项目、部署分开"。
// 装到实例用 `npm run deploy:panel`（scripts/deploy-panel.sh），它会先跑本脚本再拷。

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'llrt');
const OUT = process.env.PANEL_LLRT_DIST ?? join(ROOT, 'dist', 'panel-llrt');
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
  `// 由 cmusic-others/mgmusic-plugin/llrt/mgmusic.js 构建生成（panel-llrt 0.4.x 版）—— **不要手改这个文件**。`,
  '//',
  '//   改代码：编辑插件项目的 llrt/，然后 `npm run deploy:panel`（构建 + 装进实例）',
  `//   mgmusic-plugin ${pkg.version} · 插件 \`${NAME}\``,
  '',
].join('\n');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, `${NAME}.js`), banner + src);
console.log(`  ✅ ${OUT}/${NAME}.js（${(Buffer.byteLength(banner + src) / 1024).toFixed(1)} KB）`);

// 界面：整目录替换（rmSync 先，避免删掉的文件留在产物里）
const webOut = join(OUT, `${NAME}.webui`);
cpSync(join(SRC, 'webui'), webOut, { recursive: true });
for (const f of ['index.html', 'style.css', 'app.js', 'boot.js']) {
  const kb = (Buffer.byteLength(readFileSync(join(webOut, f))) / 1024).toFixed(1);
  console.log(`  ✅ ${webOut}/${f}（${kb} KB）`);
}

// 面板侧的门禁要求界面带 --style-ver（被 0.3.x 的文件覆盖时会消失）
const css = readFileSync(join(webOut, 'style.css'), 'utf8');
if (!css.includes('--style-ver')) {
  console.error('❌ 产物 style.css 里没有 --style-ver：panel-llrt 的 check-plugin-style 会红');
  process.exit(1);
}

// 清单：面板读 plugins/<name>.panel.json 出配置表单、核对 min_panel。
// 源在 llrt/（被 git 跟踪），构建时拷到 dist 顶层与 <name>.js 并列。
const manifestSrc = join(SRC, `${NAME}.panel.json`);
const manifestDst = join(OUT, `${NAME}.panel.json`);
cpSync(manifestSrc, manifestDst);
console.log(`  ✅ ${manifestDst}`);
console.log(`\n产物已写到 dist/panel-llrt/（${NAME}.js + ${NAME}.webui/ + ${NAME}.panel.json）；装进实例用 npm run deploy:panel`);
