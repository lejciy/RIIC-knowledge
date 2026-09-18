// 【已退役 2026-09-10，D16】快照全量重建已由 scripts/render-skill-snapshot.mjs 承担。
// 勿再运行本脚本：其增补格式（id 括注、顿号术语分隔）与 render 产物不兼容，
// 且存在已知缺陷——「技能 → 持有者」节不更新、三段技能链替换前驱取错（见 D16）。
//
// 将 JSON 真源（meta/mirror/RIIC-Web/clean/）中快照（docs/2-干员技能/）缺失的
// 干员 / 技能槽位 / 术语 / 等价组成员增补进快照 Markdown。
//
// 设计约束：
// - 只做「增补」，不改写、不删除既有内容（快照主体仍归上游整体重引入）。
// - 幂等：重跑时若无缺失则零写入。
// - 缺失判定：技能槽位以 (file|id) 与 (file|name) 双键查重（原文 bullet 无 id 括注时只存名字）。
// - 格式遵循快照既有约定：
//   分片  = 星级降序 + 星内名字码点升序；头部计数行以 JSON 真源每设施计数改写
//   技能行= `- **口径**「名」（`id`）：描述　〔标签：A/B；引用术语：X〕`；
//           仅当名字在同一分片内对应多个技能 id 时加 （`id`） 括注（上游同规则）；
//           提升版口径写 `精英 N 提升，替换「前一名」`；无标签无引用则省尾注
//   名册  = `## ☆N（x 名）` 星节 + 名字序；`- 名 | ☆N | 职业 | 设施 | 组`
//   类别  = 干员组节内码点序 `- **组**（N）：成员`
//   等价组= 设施节内按组名码点序；持有者 星级降序+名字序，解锁简写 (精0/精1/精2/Lv.30)
// 用法：node scripts/sync-skill-snapshot.mjs   （在仓库根执行）

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SNAP = join(process.cwd(), 'docs/2-干员技能');
const CLEAN = join(process.cwd(), 'meta/mirror/RIIC-Web/clean');

const skills = JSON.parse(readFileSync(join(CLEAN, 'building-skill-catalog.json'), 'utf8'));
const operators = JSON.parse(readFileSync(join(CLEAN, 'operator-catalog.json'), 'utf8'));
const terms = JSON.parse(readFileSync(join(CLEAN, 'term-catalog.json'), 'utf8'));

const ROOM_FILE = { control: '技能-控制中枢.md', manu: '技能-制造站.md', trade: '技能-贸易站.md', dorm: '技能-宿舍.md', meet: '技能-会客室.md', hire: '技能-办公室.md', power: '技能-发电站.md', train: '技能-训练室.md', workshop: '技能-加工站.md' };
const ROOM_LABEL = { control: '控制中枢', manu: '制造站', trade: '贸易站', dorm: '宿舍', meet: '会客室', hire: '办公室', power: '发电站', train: '训练室', workshop: '加工站' };
const ROOM_ORDER = ['control', 'manu', 'trade', 'dorm', 'meet', 'hire', 'power', 'train', 'workshop'];
const roomKey = (id) => id.split('_')[0];

const HEADER = /^### (.+?) ☆(\d) · (\S+)\s*$/;
const BULLET = /^- \*\*(.+?)\*\*「(.+?)」(?:（`([^`]+)`）)?：(.+?)(?:　〔(.+?)〕)?\s*$/;

const parseShard = (txt) => {
  const sections = [];
  let cur = null;
  for (const line of txt.split('\n')) {
    const h = line.match(HEADER);
    if (h) {
      cur = { name: h[1], star: +h[2], prof: h[3], bullets: [] };
      sections.push(cur);
      continue;
    }
    const b = line.match(BULLET);
    if (b && cur) cur.bullets.push({ caliber: b[1], skill: b[2], id: b[3] });
  }
  return sections;
};

// ---- 差集 ----
const shardTexts = {}; // file -> sections
for (const f of Object.values(ROOM_FILE)) shardTexts[f] = parseShard(readFileSync(join(SNAP, f), 'utf8'));

const mdKeys = new Set(); // `${file}|${id}` 与 `${file}|${name}`
for (const [f, sections] of Object.entries(shardTexts))
  for (const sec of sections) for (const b of sec.bullets) { mdKeys.add(`${f}|${b.id}`); mdKeys.add(`${f}|${b.skill}`); }

const missingByFile = {}; // file -> [{op, refs:[ref...]}]
for (const op of operators) {
  const perFile = {};
  for (const ref of op.buildingSkills) {
    const file = ROOM_FILE[roomKey(ref.id)];
    if (!mdKeys.has(`${file}|${ref.id}`) && !mdKeys.has(`${file}|${skills[ref.id].name}`)) (perFile[file] ??= []).push(ref);
  }
  for (const [file, refs] of Object.entries(perFile)) (missingByFile[file] ??= []).push({ op, refs });
}

const totalMissing = Object.values(missingByFile).reduce((a, v) => a + v.length, 0);
const touchedFiles = Object.keys(missingByFile);
if (!totalMissing) console.log('分片无缺失。');
else {
  // ---- 分片补丁：每文件一次成批插入 ----
  const nameIdsInRoom = {}; // roomKey -> name -> Set(id)
  for (const id of Object.keys(skills)) {
    const rk = roomKey(id);
    (nameIdsInRoom[rk] ??= {});
    (nameIdsInRoom[rk][skills[id].name] ??= new Set()).add(id);
  }
  const bulletLine = (op, ref) => {
    const s = skills[ref.id];
    const multi = nameIdsInRoom[roomKey(ref.id)][s.name].size > 1;
    const idTag = multi ? `（\`${ref.id}\`）` : '';
    let caliber = ref.unlock;
    if (ref.unlock.endsWith('提升')) {
      const prefix = ref.id.slice(0, ref.id.lastIndexOf('_'));
      const prev = op.buildingSkills.find((r) => r !== ref && r.id.startsWith(prefix + '_') && r.index < ref.index);
      if (prev && skills[prev.id]) caliber += `，替换「${skills[prev.id].name}」`;
    }
    const parts = [];
    if (s.tags.length) parts.push(`标签：${s.tags.join('/')}`);
    if (s.termRefs.length) parts.push(`引用术语：${s.termRefs.map((r) => r.text).join('、')}`);
    const anno = parts.length ? `　〔${parts.join('；')}〕` : '';
    return `- **${caliber}**「${s.name}」${idTag}：${s.description}${anno}`;
  };

  for (const file of touchedFiles) {
    const lines = readFileSync(join(SNAP, file), 'utf8').split('\n');
    const inserts = []; // {atIndex, text}
    for (const { op, refs } of missingByFile[file]) {
      const section = `### ${op.name} ☆${op.rarity} · ${op.professionLabel}\n\n` + refs.sort((a, b) => a.index - b.index).map((r) => bulletLine(op, r)).join('\n') + '\n';
      const headers = [];
      lines.forEach((l, i) => { const h = l.match(HEADER); if (h) headers.push({ i, name: h[1], star: +h[2] }); });
      let at = null;
      for (const h of headers) if (h.star < op.rarity || (h.star === op.rarity && h.name > op.name)) { at = h.i; break; }
      if (at === null) {
        // 排在同星名字最后：插在最后一个技能段之后、下一个 '## ' 节标题之前
        const last = headers[headers.length - 1];
        let end = last ? last.i + 1 : lines.length;
        while (end < lines.length && !lines[end].startsWith('## ')) end++;
        at = end;
      }
      inserts.push({ at, text: section });
    }
    for (const { at, text } of inserts.sort((a, b) => b.at - a.at)) lines.splice(at, 0, text);
    writeFileSync(join(SNAP, file), lines.join('\n'));
  }
  console.log(`分片增补：${totalMissing} 名干员的技能段，涉及 ${touchedFiles.map((f) => f.replace('技能-', '').replace('.md', '')).join('、')}`);
}

// ---- 分片计数行：一律以 JSON 真源为准改写（幂等） ----
{
  const jsonRoom = {};
  for (const op of operators) for (const ref of op.buildingSkills) {
    const rk = roomKey(ref.id);
    jsonRoom[rk] ??= { skills: new Set(), ops: new Set() };
    jsonRoom[rk].skills.add(ref.id);
    jsonRoom[rk].ops.add(op.name);
  }
  for (const [rk, f] of Object.entries(ROOM_FILE)) {
    const txt = readFileSync(join(SNAP, f), 'utf8');
    const fixed = txt.replace(/相关技能 \*\*\d+ 个\*\*，涉及干员 \*\*\d+ 名\*\*/, `相关技能 **${jsonRoom[rk].skills.size} 个**，涉及干员 **${jsonRoom[rk].ops.size} 名**`);
    if (fixed !== txt) { writeFileSync(join(SNAP, f), fixed); console.log(`计数更新 ${f}: ${jsonRoom[rk].skills.size} 个 / ${jsonRoom[rk].ops.size} 名`); }
  }
}

// ---- 名册 ----
{
  const roster = readFileSync(join(SNAP, '名册.md'), 'utf8');
  const rosterNames = new Set([...roster.matchAll(/^- (.+?) \| ☆\d \| \S+ \|/gm)].map((m) => m[1]));
  const groupMembers = new Map();
  for (const t of Object.values(terms)) {
    const m = t.desc.match(/包含以下干员\s*(.+)/);
    if (m) groupMembers.set(t.name, new Set(m[1].split('、').map((x) => x.trim())));
  }
  const newOps = operators.filter((op) => !rosterNames.has(op.name));
  if (newOps.length) {
    const lines = roster.split('\n');
    for (const op of newOps) {
      const rk = [...new Set(op.buildingSkills.map((r) => roomKey(r.id)))].sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b));
      const groups = [...groupMembers.entries()].filter(([, ms]) => ms.has(op.name)).map(([g]) => g);
      const termRefGroups = new Set(op.buildingSkills.flatMap((r) => (skills[r.id]?.termRefs ?? []).map((x) => x.name)));
      const gs = groups.filter((g) => termRefGroups.has(g));
      const entry = `- ${op.name} | ☆${op.rarity} | ${op.professionLabel} | ${rk.map((k) => ROOM_LABEL[k]).join('、')}${gs.length ? ' | ' + gs.join('、') : ''}`;
      const secRe = /^## ☆(\d)（(\d+) 名）$/;
      let ok = false;
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(secRe);
        if (m && +m[1] === op.rarity) {
          lines[i] = `## ☆${m[1]}（${+m[2] + 1} 名）`;
          let j = i + 1;
          while (j < lines.length && lines[j].startsWith('- ')) { if (lines[j].slice(2).split(' | ')[0] > op.name) break; j++; }
          lines.splice(j, 0, entry);
          ok = true;
          break;
        }
      }
      if (!ok) throw new Error(`名册无 ☆${op.rarity} 星节`);
    }
    const total = +roster.match(/全部 \*\*(\d+) 名\*\*/)[1] + newOps.length;
    writeFileSync(join(SNAP, '名册.md'), lines.join('\n').replace(/全部 \*\*\d+ 名\*\*干员/, `全部 **${total} 名**干员`));
    console.log(`名册增补：${newOps.map((o) => o.name).join('、')}，共 ${total} 名`);
  }
}

// ---- 类别（干员组） ----
{
  const cat = readFileSync(join(SNAP, '类别.md'), 'utf8');
  const existing = new Set([...cat.matchAll(/^- \*\*(.+?)\*\*(?:（\d+）)?：/gm)].map((m) => m[1]));
  const newGroupTerms = Object.values(terms).filter((t) => /^包含以下干员/.test(t.desc) && !existing.has(t.name));
  if (newGroupTerms.length) {
    const lines = cat.split('\n');
    const secIdx = lines.findIndex((l) => /^## 干员组（\d+ 条）$/.test(l));
    if (secIdx < 0) throw new Error('类别.md 无干员组节');
    lines[secIdx] = lines[secIdx].replace(/（\d+ 条）/, `（${+lines[secIdx].match(/（(\d+) 条）/)[1] + newGroupTerms.length} 条）`);
    for (const t of newGroupTerms) {
      const members = t.desc.replace(/^包含以下干员\s*/, '').split('、').map((x) => x.trim());
      const entry = `- **${t.name}**（${members.length}）：${members.join('、')}`;
      let j = secIdx + 1;
      while (j < lines.length && lines[j].startsWith('- **')) { if (lines[j].match(/^- \*\*(.+?)\*\*/)[1] > t.name) break; j++; }
      lines.splice(j, 0, entry);
    }
    writeFileSync(join(SNAP, '类别.md'), lines.join('\n').replace(/共 \d+ 条/, `共 ${Object.keys(terms).length} 条`));
    console.log(`类别增补：${newGroupTerms.map((t) => t.name).join('、')}`);
  }
}

// ---- 等价组 ----
{
  const eq = readFileSync(join(SNAP, '技能等价组.md'), 'utf8');
  const byDesc = new Map(); // desc -> Set(name)
  for (const s of Object.values(skills)) byDesc.set(s.description, (byDesc.get(s.description) ?? new Set()).add(s.name));
  const holdersByDesc = new Map();
  for (const op of operators)
    for (const ref of op.buildingSkills) {
      const d = skills[ref.id].description;
      if (!holdersByDesc.has(d)) holdersByDesc.set(d, []);
      holdersByDesc.get(d).push({ name: op.name, star: op.rarity, unlock: ref.unlock });
    }
  const eqGroups = [...eq.matchAll(/^- \*\*(.+?)\*\*$/gm)].map((m) => ({ names: m[1].split(' ＝ '), line: m[0] }));
  const flatNames = new Set(eqGroups.flatMap((g) => g.names));
  const unlockShort = (u) => (u.startsWith('等级') ? '(Lv.30)' : u === '初始解锁' ? '(精0)' : u.includes('精英 1') ? '(精1)' : '(精2)');
  let out = eq;
  let delta = 0;
  for (const g of eqGroups) {
    const desc = [...byDesc.entries()].find(([, names]) => names.has(g.names[0]) && names.size >= 2)?.[0];
    if (!desc) continue;
    const fresh = [...byDesc.get(desc)].filter((n) => !g.names.includes(n));
    if (!fresh.length) continue;
    const title = `- **${[...g.names, ...fresh].join(' ＝ ')}**`;
    out = out.replace(g.line, title);
    const block = out.slice(out.indexOf(title));
    const hMatch = block.match(/  - 持有者：(.+)$/m);
    const addTxt = holdersByDesc
      .get(desc)
      .filter((h) => !hMatch[1].includes(`${h.name}☆`))
      .sort((a, b) => b.star - a.star || (a.name < b.name ? -1 : 1))
      .map((h) => `${h.name}☆${h.star}${unlockShort(h.unlock)}`)
      .join('、');
    if (addTxt) out = out.replace(hMatch[0], hMatch[0] + '、' + addTxt);
  }
  for (const [desc, names] of byDesc) {
    if (names.size < 2 || [...names].every((n) => flatNames.has(n))) continue;
    if ([...names].some((n) => flatNames.has(n))) continue; // 已在上面进成员
    const holders = holdersByDesc.get(desc).sort((a, b) => b.star - a.star || (a.name < b.name ? -1 : 1));
    const rk = operators.flatMap((op) => op.buildingSkills.map((r) => r.id)).find((id) => skills[id].description === desc).split('_')[0];
    const entry = `- **${[...names].sort().join(' ＝ ')}**\n  - 效果：${desc}\n  - 持有者：${holders.map((h) => `${h.name}☆${h.star}${unlockShort(h.unlock)}`).join('、')}\n\n`;
    const secIdx = out.indexOf(`## ${ROOM_LABEL[rk]}`);
    if (secIdx < 0) throw new Error(`等价组无 ${ROOM_LABEL[rk]} 节`);
    const seg = out.slice(secIdx);
    const groupLines = [...seg.matchAll(/^- \*\*(.+?)\*\*$/gm)];
    const firstName = [...names].sort()[0];
    let insertPos = secIdx + (groupLines.find((gl) => gl[1] > firstName)?.index ?? out.length - secIdx);
    out = out.slice(0, insertPos) + entry + out.slice(insertPos);
    delta++;
  }
  if (out !== eq) {
    const total = +eq.match(/共 (\d+) 组/)[1] + delta;
    out = out.replace(/共 \d+ 组/, `共 ${total} 组`);
    out = out.replace(/\n{3,}/g, '\n\n');
    writeFileSync(join(SNAP, '技能等价组.md'), out);
    console.log(`等价组更新：新组 ${delta} 个，共 ${total} 组`);
  }
}
