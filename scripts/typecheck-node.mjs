// 插件**服务端**（dist/shop.js，跑在 LLRT 里）的类型检查。
//
// 和界面那份分开：服务端用 tsconfig.node.json（nodenext + panel:host paths + LLRT 的 node 子集），
// 界面用 tsconfig.webui.json（DOM）。混在一起会把 DOM 全局漏进服务端代码。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findTsc() {
  for (const c of [process.env.TSC, join(ROOT, 'node_modules/.bin/tsc'), join(ROOT, '../mcloud-plugin/node_modules/.bin/tsc')].filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  console.error('❌ 找不到 tsc');
  process.exit(2);
}

try {
  execFileSync(findTsc(), ['-p', join(ROOT, 'tsconfig.node.json'), '--noEmit'], { stdio: 'inherit', cwd: ROOT });
  console.log('ok: 服务端类型检查全过（tsconfig.node.json）');
} catch {
  console.error('✗ 服务端类型检查没过');
  process.exit(1);
}
