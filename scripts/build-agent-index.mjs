// 生成 Agent 检索索引层（index/）的两份派生物：
//   index/消歧字典.json —— 俗称/别名/同效技能 → 规范名 的机器可读归一表
//   index/标题清单.md   —— 全库文件与小节级索引（候选文档选择与小节定位用）
//
// 数据来源与真源关系：
//   - docs/** front matter（name/aliases/type）是组合别名的唯一真源；
//   - 歧义-组合别名.md 为人工汇总表，可能包含 front matter 未回填的俗称（如「虚空印钞」），
//     脚本取两源并集，并在控制台报告漂移供人工回填，不阻断生成；
//   - 歧义-简称合称.md（人工维护）、歧义-子串对.md 与 技能等价组.md（clean 数据生成页）按行解析。
// 完整性策略：解析失败、别名指向冲突、别名表指向未注册组合时非零退出。
// 输出确定性：不嵌入生成时间戳，重复运行产出逐字节一致。
// 重新生成：node scripts/build-agent-index.mjs

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DOCS = join(ROOT, 'docs');
const OUT = join(ROOT, 'index');

const errors = [];
const drifts = [];
const fail = (msg) => errors.push(msg);
const stripLinks = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim();
const read = (p) => readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const linesOf = (p) => read(p).split(/\r?\n/);

/** 按顿号切分，括号内的顿号不参与切分 */
const splitByDun = (s) => {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '（' || ch === '(') depth++;
    if (ch === '）' || ch === ')') depth = Math.max(0, depth - 1);
    if (ch === '、' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

// ---- 1. 遍历 docs/，解析 front matter ----
const filePaths = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'zh'))) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.md')) filePaths.push(p);
  }
};
walk(DOCS);
if (filePaths.length === 0) fail('docs/ 下未发现 Markdown 文件');

const parseFM = (text) => {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, k, v] = kv;
    fm[k] = v.startsWith('[') && v.endsWith(']') && v.length > 2
      ? v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean)
      : v.trim();
  }
  return fm;
};

const docs = filePaths.map((p) => ({
  rel: relative(ROOT, p).replaceAll('\\', '/'),
  text: read(p),
  fm: parseFM(read(p)),
}));

// ---- 2. 组合别名（front matter 真源 + 歧义-组合别名汇总表并集） ----
const combos = docs
  .filter((d) => d.fm.type === 'combination')
  .map((d) => ({ name: d.fm.name ?? null, aliases: Array.isArray(d.fm.aliases) ? d.fm.aliases : [], rel: d.rel }));
for (const c of combos) {
  if (!c.name) fail(`组合深稿缺 front matter name：${c.rel}`);
}
const byCanonical = new Map(combos.map((c) => [c.name, c]));

const combinationAliases = {};
const addCombAlias = (alias, canonical, provenance, note) => {
  const existing = combinationAliases[alias];
  if (existing) {
    if (existing.canonical !== canonical) {
      fail(`组合别名「${alias}」同时指向 ${existing.canonical} 与 ${canonical}`);
      return;
    }
    if (note && !existing.note) existing.note = note;
    return;
  }
  const entry = { canonical, file: byCanonical.get(canonical).rel, provenance };
  if (note) entry.note = note;
  combinationAliases[alias] = entry;
};

for (const c of combos) {
  addCombAlias(c.name, c.name, 'front matter');
  for (const a of c.aliases) addCombAlias(a, c.name, 'front matter');
}

const aliasPagePath = join(DOCS, '3-组合库/歧义/歧义-组合别名.md');
let canonicalNotes = {};
{
  let section = '';
  for (const line of linesOf(aliasPagePath)) {
    const h = /^## (.+)$/.exec(line);
    if (h) { section = h[1]; continue; }
    const row = /^\|(.+)\|\s*$/.exec(line);
    if (row && section !== '与技能名同名的规范名') {
      const cells = row[1].split('|').map((c) => c.trim());
      if (cells.length < 3 || cells[0] === '别名' || /^-{3,}$/.test(cells[0])) continue;
      const aliases = splitByDun(stripLinks(cells[0]));
      const target = stripLinks(cells[1]);
      const note = stripLinks(cells[2]);
      if (!byCanonical.has(target)) {
        fail(`歧义-组合别名表指向未注册组合：「${target}」（别名：${aliases.join('、')}）`);
        continue;
      }
      const fmSet = new Set(byCanonical.get(target).aliases);
      for (const a of aliases) {
        if (!fmSet.has(a) && a !== target) drifts.push(`俗称「${a}」未回填至 ${target} 的 front matter aliases`);
        addCombAlias(a, target, aliases.length && fmSet.has(a) ? 'front matter' : '歧义-组合别名表', note === '—' ? null : note);
      }
      continue;
    }
    if (section === '与技能名同名的规范名') {
      const m = /^- \*\*(.+?)\*\*：(.+)$/.exec(line);
      if (m) canonicalNotes[m[1]] = stripLinks(m[2]);
    }
  }
}
for (const [name, note] of Object.entries(canonicalNotes)) {
  if (combinationAliases[name] && !combinationAliases[name].note) combinationAliases[name].note = note;
}

// ---- 3. 干员简称/合称 + 官方同名组（歧义-简称合称，人工维护） ----
const operatorAliases = {};
const officialGroups = {};
{
  const page = linesOf(join(DOCS, '3-组合库/歧义/歧义-简称合称.md'));
  let section = '';
  let lastEntry = null;
  for (const line of page) {
    const h = /^## (.+)$/.exec(line);
    if (h) { section = h[1]; lastEntry = null; continue; }
    if (section === '简称与合称') {
      const m = /^- \*\*(.+?)\*\* → (.+)$/.exec(line);
      if (m) {
        const aliases = m[1].split('/').map((s) => s.trim()).filter(Boolean);
        const targets = splitByDun(stripLinks(m[2])).map((t) => {
          const tm = /^(.+?)（(.+?)）$/.exec(t);
          return tm ? tm[1] : t;
        });
        if (aliases.length === 0 || targets.length === 0) fail(`歧义-简称合称条目解析失败：「${line}」`);
        lastEntry = { aliases, targets, note: null };
        for (const a of aliases) {
          if (operatorAliases[a]) fail(`干员简称「${a}」重复登记`);
          operatorAliases[a] = { targets, provenance: '歧义-简称合称（人工维护）' };
        }
        continue;
      }
      const note = /^ {2}- (.+)$/.exec(line);
      if (note && lastEntry) {
        lastEntry.note = stripLinks(note[1]);
        for (const a of lastEntry.aliases) operatorAliases[a].note = lastEntry.note;
      }
    } else if (section.startsWith('官方术语表')) {
      const m = /^- \*\*(.+?)\*\*：(.+)$/.exec(line);
      if (m) officialGroups[m[1]] = splitByDun(stripLinks(m[2]));
    }
  }
  if (Object.keys(operatorAliases).length === 0) fail('歧义-简称合称解析结果为空');
}

// ---- 4. 子串同名对（歧义-子串对，clean 数据生成页） ----
const substringWarnings = [];
for (const line of linesOf(join(DOCS, '3-组合库/歧义/歧义-子串对.md'))) {
  const m = /^- \*\*(.+?)\*\*（(.+?)） ⊂ (.+?)（(.+?)）$/.exec(line);
  if (!m) continue;
  const [, short, shortFacilities, long, tail] = m;
  const [longFacilities, resolution] = tail.split('｜');
  if (!resolution) { fail(`子串对解析失败（缺判定口径）：${line}`); continue; }
  substringWarnings.push({
    short,
    short_facilities: splitByDun(shortFacilities),
    long,
    long_facilities: splitByDun(longFacilities ?? ''),
    resolution: resolution.trim(),
  });
}
if (substringWarnings.length === 0) fail('歧义-子串对解析结果为空');

// ---- 5. 同效技能分组（技能等价组，clean 数据生成页） ----
const skillEquivalence = {};
{
  let facility = null;
  let current = null;
  let groupCount = 0;
  for (const line of linesOf(join(DOCS, '2-干员技能/技能等价组.md'))) {
    const h = /^## (.+)$/.exec(line);
    if (h) { facility = h[1]; current = null; continue; }
    const g = /^- \*\*(.+?)\*\*$/.exec(line);
    if (g && line.includes('＝')) {
      const names = g[1].split('＝').map((s) => s.trim()).filter(Boolean);
      if (names.length < 2) fail(`等价组条目解析失败：「${line}」`);
      groupCount++;
      current = { id: groupCount, facility, names, effect: null, holders: [] };
      // 同名不同效的技能（如「领袖」「澎湃紊流」在不同设施各成一组）合法存在，值统一为组列表
      for (const n of names) {
        (skillEquivalence[n] ??= []).push(current);
      }
      continue;
    }
    if (!current) continue;
    const effect = /^ {2}- 效果：(.+)$/.exec(line);
    if (effect) { current.effect = effect[1].trim(); continue; }
    const holders = /^ {2}- 持有者：(.+)$/.exec(line);
    if (holders) current.holders = splitByDun(holders[1]);
  }
  if (groupCount === 0) fail('技能等价组解析结果为空');
}

// ---- 6. 其他带别名的文档（换班方式篇等） ----
const otherAliases = {};
for (const d of docs) {
  if (d.fm.type === 'combination' || !Array.isArray(d.fm.aliases) || d.fm.aliases.length === 0) continue;
  for (const a of d.fm.aliases) {
    if (otherAliases[a]) fail(`别名「${a}」重复登记（${otherAliases[a].file} 与 ${d.rel}）`);
    otherAliases[a] = { file: d.rel, type: d.fm.type ?? null };
  }
}

// ---- 7. 标题清单 ----
const TAG_PAGE = 'docs/3-组合库/标签速查.md';
const extractHeadings = (text) => {
  const sections = [];
  let fence = false;
  let h1 = null;
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^```/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    let m;
    if ((m = /^# (.+)$/.exec(line)) && h1 === null) { h1 = m[1]; continue; }
    if ((m = /^## (.+)$/.exec(line))) {
      current = { h2: m[1], h3s: [] };
      sections.push(current);
      continue;
    }
    if ((m = /^### (.+)$/.exec(line)) && current) current.h3s.push(m[1]);
  }
  return { h1: h1 ?? '（无一级标题）', sections };
};

const tocLines = [
  '# 标题清单（全库文件与小节索引）',
  '',
  '<!-- 本文件由 scripts/build-agent-index.mjs 生成，请勿手改；正文变更后重新生成。 -->',
  '',
  '> 用途：候选文档选择与小节定位。干员到设施的定位走 `docs/2-干员技能/名册.md`，本清单不重复干员级条目；《标签速查》按设施与功能标签两级列出（唯一需要小节级粒度的文件）。',
  '',
];
let sectionCount = 0;
for (const d of docs) {
  const { h1, sections } = extractHeadings(d.text);
  const meta = [d.fm.type, d.fm.updated].filter(Boolean).join('，');
  tocLines.push(`- \`${d.rel}\`${meta ? `（${meta}）` : ''}${h1}：${sections.map((s) => s.h2).join('｜') || '（无二级标题）'}`);
  sectionCount += sections.length;
  if (d.rel === TAG_PAGE) {
    for (const s of sections) {
      if (s.h3s.length === 0) continue;
      tocLines.push(`  - ${s.h2}：${s.h3s.join('｜')}`);
      sectionCount += s.h3s.length;
    }
  }
}
tocLines.push('');

// ---- 8. 归一键对照（去空格与间隔号后仍可命中，如「裁缝 β」→ 裁缝·β） ----
const normKey = (s) => s.replace(/[\s·]/g, '');
const normalizedKeys = {};
const addNorm = (original) => {
  const n = normKey(original);
  if (n === original) return;
  if (normalizedKeys[n] && normalizedKeys[n] !== original) fail(`归一键「${n}」同时对应 ${normalizedKeys[n]} 与 ${original}`);
  normalizedKeys[n] = original;
};
for (const section of [combinationAliases, operatorAliases, otherAliases]) {
  for (const k of Object.keys(section)) addNorm(k);
}
for (const k of Object.keys(skillEquivalence)) addNorm(k);

// ---- 9. 输出 ----
const dictionary = {
  meta: {
    generated_by: 'scripts/build-agent-index.mjs',
    provenance: {
      combination_aliases: 'docs/** front matter（真源）＋ docs/3-组合库/歧义/歧义-组合别名.md（汇总表并集）',
      operator_aliases: 'docs/3-组合库/歧义/歧义-简称合称.md（人工维护）',
      official_groups: 'docs/3-组合库/歧义/歧义-简称合称.md·官方术语表节',
      substring_warnings: 'docs/3-组合库/歧义/歧义-子串对.md（clean 数据生成）',
      skill_equivalence: 'docs/2-干员技能/技能等价组.md（clean 数据生成）',
    },
    usage: [
      '查无映射时以原始词回退正文检索，仍无结果则表述为「库内未收录」',
      'substring_warnings 命中时按 resolution 处理：设施可区分按上下文消解并说明，否则向用户澄清',
      'skill_equivalence 命中时整组持有者均为候选，检索技能用规范名列表并集',
    ].join('；'),
    derived: '与 docs/ 正文冲突时以正文为准',
  },
  combination_aliases: combinationAliases,
  operator_aliases: operatorAliases,
  official_groups: officialGroups,
  substring_warnings: substringWarnings,
  other_aliases: otherAliases,
  normalized_keys: normalizedKeys,
  skill_equivalence: Object.fromEntries(
    Object.entries(skillEquivalence).map(([k, groups]) => [k, {
      groups: groups.map((g) => ({
        group: g.id, facility: g.facility, equivalent: g.names, effect: g.effect, holders: g.holders,
      })),
    }]),
  ),
};

if (errors.length > 0) {
  console.error(`✗ 生成失败，共 ${errors.length} 处：`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, '消歧字典.json'), `${JSON.stringify(dictionary, null, 2)}\n`, 'utf8');
writeFileSync(join(OUT, '标题清单.md'), tocLines.join('\n'), 'utf8');

const aliasFromTable = Object.values(combinationAliases).filter((e) => e.provenance === '歧义-组合别名表').length;
console.log(`✓ 消歧字典.json：组合别名 ${Object.keys(combinationAliases).length} 条（front matter ${Object.keys(combinationAliases).length - aliasFromTable}＋别名表独有 ${aliasFromTable}）、干员简称合称 ${Object.keys(operatorAliases).length} 条、官方同名组 ${Object.keys(officialGroups).length} 组、子串对 ${substringWarnings.length} 对、同效技能 ${Object.keys(skillEquivalence).length} 个技能名`);
console.log(`✓ 标题清单.md：${docs.length} 个文件、${sectionCount} 个小节`);
if (drifts.length > 0) {
  console.log(`⚠ 漂移提示（不阻断，建议回填 front matter）：`);
  for (const d of [...new Set(drifts)]) console.log(`  - ${d}`);
}
