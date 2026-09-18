// 组合动态成员核对：按技能名前缀从 clean 数据枚举持有者，比对组合深稿 front matter members。
//
// 防漏：上游新增同类技能干员（如新的「金属工艺·α」持有者）而深稿未收录时，本脚本非零退出，
// 提示先补深稿（成员练度档与层级是人工判断，脚本只保证「不漏」，不代写深稿）。
//
// 数据源：meta/mirror/RIIC-Web/clean/operator-skill-text.json（clean-riic-skills.mjs 产物）
// 用法：node scripts/verify-combination-rosters.mjs   （仓库根执行）
//
// 输出口径：
//   - FAIL（非零退出）：数据源中持有配置技能前缀的干员未出现在深稿 members（缺员，需补深稿）
//   - INFO：深稿 members 中有不持有该技能前缀的干员（多为中枢/挂件身份，人工确认即可，不影响退出码）

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const OST = join(ROOT, 'meta/mirror/RIIC-Web/clean/operator-skill-text.json');

// 动态枚举型组合登记处：成员按「技能名含 ××」定义的组合在此登记，新增同型组合时追加一行
const COMBOS = [
  { name: '赤金工艺组', doc: 'docs/3-组合库/单站组合/赤金工艺组.md', skillPrefix: '金属工艺·' },
  { name: '莱茵科技', doc: 'docs/3-组合库/单站组合/莱茵科技.md', skillPrefix: '莱茵科技·' },
  { name: '水月标准化组', doc: 'docs/3-组合库/跨设施体系/水月标准化组.md', skillPrefix: '标准化·' },
];

const operators = JSON.parse(readFileSync(OST, 'utf8'));

const parseMembers = (md) => {
  const fm = md.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
  const block = fm.match(/^members:\n((?:[ \t]+.*\n?)*)/m)?.[1] ?? '';
  return [...block.matchAll(/^[ \t]+-[ \t]+name:[ \t]*(.+)$/gm)].map((m) => m[1].trim());
};

const holdersOf = (prefix) =>
  operators
    .filter((op) => op.skills.some((s) => s.name.startsWith(prefix)))
    .map((op) => op.name);

let fail = 0;
for (const combo of COMBOS) {
  const md = readFileSync(join(ROOT, combo.doc), 'utf8').replace(/\r\n/g, '\n');
  const members = parseMembers(md);
  const holders = holdersOf(combo.skillPrefix);
  const missing = holders.filter((n) => !members.includes(n));
  const extra = members.filter((n) => !holders.includes(n));
  console.log(`\n[${combo.name}] ${combo.doc}`);
  console.log(`  技能前缀「${combo.skillPrefix}」持有者 ${holders.length} 名：${holders.join('、')}`);
  console.log(`  深稿 members ${members.length} 名：${members.join('、')}`);
  if (missing.length) {
    fail++;
    console.error(`  ✗ 缺员（持有技能但未入深稿）：${missing.join('、')}`);
  } else {
    console.log('  ✓ 无缺员');
  }
  if (extra.length) {
    console.log(`  · members 中不持有该技能（中枢/挂件身份，人工确认）：${extra.join('、')}`);
  }
}

if (fail) {
  console.error(`\n${fail} 个组合存在缺员：请补深稿 front matter members 与正文成员表后重跑。`);
  process.exit(1);
}
console.log('\n全部通过。');
