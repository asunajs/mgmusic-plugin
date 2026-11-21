// 插件界面（llrt/webui/*.js）的类型检查门禁。
//
// 本仓不装依赖：借同工作区 mcloud-plugin 的 tsc（和 yangshipin / panel-store 一个套路）。
// 界面是手写 JS，checkJs 能抓到「写错 PanelUI 成员名 / 把控件当普通元素用」这类错，
// 面板契约（PanelUI + PanelEl）由 types/panel-ui.d.ts 提供，来源是 panel-llrt/web/ui.d.ts。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findTsc() {
  for (const c of [
    process.env.TSC,
    join(ROOT, 'node_modules', '.bin', 'tsc'),
    join(ROOT, '..', 'mcloud-plugin', 'node_modules', '.bin', 'tsc'),
  ].filter(Boolean)) {
    if (existsSync(c)) return c;
  }
  console.error('❌ 找不到 tsc：装一个（npm i -D typescript）或确认同工作区的 mcloud-plugin 有 node_modules');
  process.exit(2);
}

try {
  execFileSync(findTsc(), ['-p', join(ROOT, 'tsconfig.webui.json'), '--noEmit'], { stdio: 'inherit', cwd: ROOT });
  console.log('ok: 类型检查全过（tsconfig.webui.json）');
} catch {
  console.error('✗ 类型检查没过 —— 上面每条都是"编译能过、运行时才炸"的那种');
  process.exit(1);
}
