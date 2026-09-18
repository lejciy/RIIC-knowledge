// 清洗 meta/mirror/RIIC-Web 的基建技能数据 → 纯文本版。
//
// 输入（只读镜像，勿改）：meta/mirror/RIIC-Web/src/generated/arkntools/*.json
// 输出（本脚本生成，勿手改）：meta/mirror/RIIC-Web/clean/*.json
//
// 清洗规则（依据 2026-09-08 对 755 条 descriptionRich 的全量标记分析）：
//   1. 富文本只有两种标记：
//      - 配对标签 <@cc.kw|vup|vdown|rem>文字</> —— 纯文本保留「文字」；
//      - 自包含占位符 <$cc.xxx> —— 本身无文字，显示名永远由紧随其后的
//        配对标签携带（78 处 <@cc.rem> 文字与 term-catalog name 全量一致），
//        因此直接删除占位符、保留后续标签内容即可，无信息损失。
//   2. 删除指向 RIIC-Web 本地图片路径的字段：技能 icon、干员 portrait。
//   3. term-catalog 采用上游自带的 descText（纯文本版）作为 desc。
//   4. 干员技能解锁条件按 RIIC-Web 站点同款口径生成中文标签 unlock
//      （移植自 src/operator-presentation.ts + src/operatorPortraits.ts
//       isBuildingSkillEnhanced + messages/helpers/zh/OperatorPresentation.json，
//       RIIC-Web@a427969）：
//        elite=0 & level=1  → 「初始解锁」
//        elite=0 & level>1  → 「等级 {level} 解锁/提升」（低星干员）
//        elite≥1 & level=1  → 「精英 {elite} 解锁/提升」
//        其余               → 「精英 {elite} · 等级 {level} 解锁/提升」（当前数据无此组合）
//      「提升」判定：同干员内按技能 id 最后一个下划线之前的前缀分组，
//      组内 ≥2 条时除 index 最小者外均为提升版（如 芙兰卡 _020→_021 两段、
//      赫拉格 _010→_011→_012 三段、杜林 _000→_001 等级段）。
//   5. 生成 operator-skill-text.json：干员技能全文视图（技能文本 × 解锁口径
//      合并，对应 RIIC-Web 站点技能查询页每个干员的展示形态），技能目录
//      缺失任一被引用技能时硬失败。
//   6. 干员附 professionLabel 职业中文名。映射原样取自 RIIC-Web
//      messages/records/zh.json 的 operator_presentation_professions（同 commit）。
//   7. 生成 skill-terms.json：词条/类别集中索引——
//      terms=官方术语 82 条（term-catalog）；placeholders=描述内 <$cc.xxx>
//      占位符的显示文字与引用技能（含派系/资源/订单类词条，如「作业平台」
//      「黑钢国际」，key 归一化后命中术语表时回链 termId）；tags=技能标签
//      词汇表（类别筛选口径）；rooms=技能 id 首段前缀 → 设施名
//      （映射取自 RIIC-Web messages/zh.json 的 Rooms.*）。
//   8. 技能条目内嵌 termRefs：引用词条（显示文字 + 官方弹窗释义 desc），
//      使每条技能详情自包含——「部分设施」「外势」等弹窗定义不需要再跨文件
//      查术语表。占位符 key 无术语条目时硬失败。
//
// 用法：node scripts/clean-riic-skills.mjs   （在仓库根执行）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'meta/mirror/RIIC-Web/src/generated/arkntools');
const OUT = join(ROOT, 'meta/mirror/RIIC-Web/clean');

const toPlain = (rich) =>
  rich
    .replace(/<(?=<[$@])/g, '') // 原数据偶发的重复尖括号（全库 1 处：桑葚·救援队 点<<$cc.bd_b1>）
    .replace(/<\$[^>]*>/g, '') // 自包含占位符：文字在后续配对标签里
    .replace(/<\/>/g, '') // 配对标签闭合
    .replace(/<@[^>]*>/g, ''); // 配对标签开头（kw/vup/vdown/rem）

function assertPlain(s, where) {
  if (/[<>]|\$cc/.test(s)) {
    throw new Error(`残留标记 @ ${where}: ${s}`);
  }
}

// ---- RIIC-Web 站点解锁口径（原样移植，见文件头注释第 4 条） ----

const buildingSkillPrefixFor = (skillId) => {
  const separator = skillId.lastIndexOf('_');
  return separator < 0 ? '' : skillId.slice(0, separator);
};

function isBuildingSkillEnhanced(refs, ref) {
  const prefix = buildingSkillPrefixFor(ref.id);
  if (!prefix) return false;
  let groupCount = 0;
  let minIndex = Infinity;
  for (const candidate of refs) {
    if (buildingSkillPrefixFor(candidate.id) !== prefix) continue;
    groupCount += 1;
    if (candidate.index < minIndex) minIndex = candidate.index;
  }
  return groupCount >= 2 && ref.index !== minIndex;
}

// ---- RIIC-Web 站点呈现层映射（原样移植，见文件头注释第 6/7 条） ----

const PROFESSION_LABELS = { 1: '近卫', 2: '狙击', 3: '重装', 4: '医疗', 5: '辅助', 6: '术师', 7: '特种', 8: '先锋' };

const ROOM_LABELS = {
  control: '控制中枢', power: '发电站', manu: '制造站', trade: '贸易站',
  dorm: '宿舍', hire: '办公室', meet: '会客室', train: '训练室', workshop: '加工站',
};

function unlockLabel(refs, ref) {
  const { elite, level } = ref;
  const prefix =
    elite === 0 && level === 1
      ? '初始'
      : elite === 0
        ? `等级 ${level} `
        : level === 1
          ? `精英 ${elite} `
          : `精英 ${elite} · 等级 ${level} `;
  return prefix + (isBuildingSkillEnhanced(refs, ref) ? '提升' : '解锁');
}

mkdirSync(OUT, { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
const write = (f, data) => writeFileSync(join(OUT, f), JSON.stringify(data, null, 2) + '\n');

// 1) 技能目录：descriptionRich → description（纯文本），删 icon，内嵌弹窗释义
const skills = read('building-skill-catalog.json');
const terms = read('term-catalog.json');

// 占位词条预扫描：同一扫描产出 全局索引（§6 汇总用）+ 技能级 termRefs。
// 占位符与显示文字有两种顺序：<$key><@cc.x>文字</>（常规）与
// <@cc.x><$key>文字</>（嵌套，如 <$cc.gvial>嘉维尔、<$cc.angel>能天使）。
const PLACEHOLDER_RE = /(?:<\$([a-zA-Z0-9_.&]+)><@cc\.[a-zA-Z]+>|<@cc\.[a-zA-Z]+><\$([a-zA-Z0-9_.&]+)>)([^<]*)<\/>/g;
const placeholders = {}; // key -> { texts[], termId, usedBy[] }（texts 为去重显示文字，个别词条有变体如「莱茵科技类/莱茵科技类技能」）
const skillTermRefs = {}; // skillId -> [{key, text, name, desc}]（按 key 去重）
for (const [id, s] of Object.entries(skills)) {
  for (const m of s.descriptionRich.matchAll(PLACEHOLDER_RE)) {
    const key = m[1] ?? m[2];
    const text = m[3];
    const norm = key.replace(/[.&]/g, '_');
    const term = terms[norm];
    if (!term) throw new Error(`占位符 <\$${key}> 无术语条目 @ ${id}`);
    const entry = (placeholders[key] ??= { texts: [], termId: norm, usedBy: [] });
    if (!entry.texts.includes(text)) entry.texts.push(text);
    entry.usedBy.push(id);
    const refs = (skillTermRefs[id] ??= []);
    if (!refs.some((r) => r.key === key)) refs.push({ key, text, name: term.name, desc: term.descText });
  }
  // 完备性：每个 <$...> 都必须被捕获到显示文字
  const total = (s.descriptionRich.match(/<\$[a-zA-Z0-9_.&]+>/g) ?? []).length;
  const captured = (s.descriptionRich.match(PLACEHOLDER_RE) ?? []).length;
  if (total !== captured) throw new Error(`占位符缺显示文字 @ ${id}: ${total} vs ${captured}`);
}

const cleanSkills = {};
let richChars = 0, plainChars = 0;
for (const [id, s] of Object.entries(skills)) {
  const description = toPlain(s.descriptionRich);
  assertPlain(description, id);
  richChars += s.descriptionRich.length;
  plainChars += description.length;
  cleanSkills[id] = { id: s.id, name: s.name, description, tags: s.tags, termRefs: skillTermRefs[id] ?? [] };
}
write('building-skill-catalog.json', cleanSkills);

// 2) 干员目录：删 portrait（本地图径）与 position（近战/远程位，基建用不到）；附职业中文名与 RIIC-Web 口径 unlock 标签
const operators = read('operator-catalog.json');
for (const op of operators) {
  if (!(op.profession in PROFESSION_LABELS)) throw new Error(`未知职业代码 ${op.name}(${op.id}): ${op.profession}`);
}
const cleanOps = operators.map(({ portrait, position, ...rest }) => ({
  ...rest,
  professionLabel: PROFESSION_LABELS[rest.profession],
  buildingSkills: rest.buildingSkills.map((ref) => ({
    ...ref,
    unlock: unlockLabel(rest.buildingSkills, ref),
  })),
}));
write('operator-catalog.json', cleanOps);

// 3) 术语表：descText 即纯文本，取为 desc（terms 已在 §1 读入）
const cleanTerms = {};
for (const [id, t] of Object.entries(terms)) {
  cleanTerms[id] = { id: t.id, name: t.name, desc: t.descText };
}
write('term-catalog.json', cleanTerms);

// 4) 稀有度与出处清单：本就无标记无图径，原样透传
write('operator-rarities.json', read('operator-rarities.json'));
write('source.json', read('source.json'));

// 5) 干员技能全文：技能文本 × 解锁口径合并视图（RIIC-Web 站点技能查询页形态）
const opSkillText = cleanOps.map((op) => ({
  id: op.id,
  name: op.name,
  order: op.order,
  rarity: op.rarity,
  profession: op.profession,
  professionLabel: op.professionLabel,
  skills: op.buildingSkills.map((ref) => {
    const s = cleanSkills[ref.id];
    if (!s) throw new Error(`技能目录缺失 ${op.name}(${op.id}) 引用的 ${ref.id}`);
    return {
      index: ref.index,
      id: ref.id,
      name: s.name,
      unlock: ref.unlock,
      elite: ref.elite,
      level: ref.level,
      description: s.description,
      tags: s.tags,
      termRefs: s.termRefs,
    };
  }),
}));
write('operator-skill-text.json', opSkillText);

// 6) 词条/类别集中索引：术语 + 占位符（§1 预扫描已建）+ 标签词汇 + 设施映射
const tagVocab = {}; // tag -> { count, skills[] }
for (const [id, s] of Object.entries(cleanSkills)) {
  for (const tag of s.tags) (tagVocab[tag] ??= { count: 0, skills: [] }).count++, tagVocab[tag].skills.push(id);
}
const rooms = {}; // 前缀 -> { name, count }
for (const id of Object.keys(skills)) {
  const prefix = id.split('_')[0];
  if (!(prefix in ROOM_LABELS)) throw new Error(`未知设施前缀 @ ${id}: ${prefix}`);
  (rooms[prefix] ??= { name: ROOM_LABELS[prefix], count: 0 }).count++;
}
write('skill-terms.json', { terms: cleanTerms, placeholders, tags: tagVocab, rooms });

// 校验与报告
const checks = [
  ['技能条数', Object.keys(cleanSkills).length, Object.keys(skills).length],
  ['干员条数', cleanOps.length, operators.length],
  ['术语条数', Object.keys(cleanTerms).length, Object.keys(terms).length],
];
for (const [label, got, want] of checks) {
  if (got !== want) throw new Error(`${label}不一致: ${got} != ${want}`);
}
const sample = Object.values(cleanSkills)[0];
const unlockDist = {};
for (const o of cleanOps) for (const s of o.buildingSkills) unlockDist[s.unlock] = (unlockDist[s.unlock] ?? 0) + 1;
const textSample = opSkillText.find((o) => o.skills.length >= 3);
console.log(`技能 ${Object.keys(cleanSkills).length} 条 / 干员 ${cleanOps.length} 名 / 术语 ${Object.keys(cleanTerms).length} 条`);
console.log(`描述字符数 ${richChars} → ${plainChars}（去除标记 ${(100 * (1 - plainChars / richChars)).toFixed(1)}%）`);
console.log(`解锁口径分布: ${JSON.stringify(unlockDist)}`);
console.log(`示例 [${sample.id}] ${sample.name}：${sample.description}`);
console.log(`全文视图示例 ${textSample.name}（${textSample.professionLabel}）：${textSample.skills.map((s) => `${s.name}(${s.unlock})`).join('、')}`);
console.log(`词条索引：术语 ${Object.keys(cleanTerms).length} / 占位符 ${Object.keys(placeholders).length}（回链术语 ${Object.values(placeholders).filter((p) => p.termId).length}）/ 标签 ${Object.keys(tagVocab).length} / 设施 ${Object.keys(rooms).length}；termRefs 内嵌 ${Object.keys(skillTermRefs).length} 个技能`);
console.log(`已写入 ${OUT}`);
