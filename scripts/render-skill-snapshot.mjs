// 从 JSON 真源（meta/mirror/RIIC-Web/clean/）全量渲染干员技能快照。
//
// 与 sync-skill-snapshot.mjs 的区别：sync 只做增补不改写；本脚本从零渲染全部文件，
// 用于验证"clean JSON → Markdown 快照"环节可脱离上游 RIIC-KnowledgeAgent 独立完成。
//
// 渲染口径（裁决：targets 由 tags 替代、efficiency 取消）：
// - 技能行尾注只保留「标签 + 引用术语」，不渲染「作用产物/作用职业/补源无此条」。
// - 不渲染：歧义.md 的人工节（简称合称）、README、特殊技能释义页。
//
// 输出目录默认 tmp/render-check/（实验对照，不触碰 docs/2-干员技能/）：
//   node scripts/render-skill-snapshot.mjs [输出目录]
//
// 格式约定与现有快照逐字对齐（逆推自上游快照 + sync 脚本注释）：
//   分片  = 星级降序 + 星内名字码点升序；「按技能」节 = 名字码点序、同名按 id 码点序
//   技能行= `- **口径**「名」（`id`）：描述　〔标签：A/B；引用术语：X〕`；
//           仅当名字在同一分片内对应多个技能 id 时加 （`id`） 括注
//           提升版口径写 `精英 N 提升，替换「前一名」`
//   名册  = `## ☆N（x 名）` 星节 + 名字码点序；`- 名 | ☆N | 职业 | 设施 | 组`
//   类别  = 术语按 desc 前缀分六节；干员组节内码点序；term-rosters.json 受管名录随附（异格）
//   等价组= 描述逐字相同分组；设施节内组名码点序；持有者星级降序+名字序，(精0/精1/精2/Lv.30)
//   歧义  = 名册内子串对，按设施是否重叠标注判定口径

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CLEAN = join(process.cwd(), 'meta/mirror/RIIC-Web/clean');
const OUT = join(process.cwd(), process.argv[2] ?? 'tmp/render-check');
mkdirSync(OUT, { recursive: true });

const skills = JSON.parse(readFileSync(join(CLEAN, 'building-skill-catalog.json'), 'utf8'));
const operators = JSON.parse(readFileSync(join(CLEAN, 'operator-catalog.json'), 'utf8'));
const terms = JSON.parse(readFileSync(join(CLEAN, 'term-catalog.json'), 'utf8'));

// 受管名录增补（meta/annotations/term-rosters.json）：官方术语只给定义不给成员枚举的类别
// （如「异格：包含所有异格干员」），用外部核对名录补齐；真源 meta/mirror/ 不动。
const ROSTERS_PATH = join(process.cwd(), 'meta/annotations/term-rosters.json');
const rosters = existsSync(ROSTERS_PATH) ? JSON.parse(readFileSync(ROSTERS_PATH, 'utf8')) : {};
const opStars = new Map(operators.map((op) => [op.name, op.rarity]));
for (const [term, r] of Object.entries(rosters)) {
  const unknown = r.members.filter((m) => !opStars.has(m));
  if (unknown.length) throw new Error(`term-rosters.json「${term}」成员不在干员目录，需先核对：${unknown.join('、')}`);
}

const ROOM_FILE = { control: '技能-控制中枢.md', manu: '技能-制造站.md', trade: '技能-贸易站.md', dorm: '技能-宿舍.md', meet: '技能-会客室.md', hire: '技能-办公室.md', power: '技能-发电站.md', train: '技能-训练室.md', workshop: '技能-加工站.md' };
const ROOM_LABEL = { control: '控制中枢', manu: '制造站', trade: '贸易站', dorm: '宿舍', meet: '会客室', hire: '办公室', power: '发电站', train: '训练室', workshop: '加工站' };
const ROOM_ORDER = ['control', 'manu', 'trade', 'dorm', 'meet', 'hire', 'power', 'train', 'workshop'];
const roomKey = (id) => id.split('_')[0];

const unlockShort = (u) => (u.startsWith('等级') ? '(Lv.30)' : u === '初始解锁' ? '(精0)' : u.includes('精英 1') ? '(精1)' : '(精2)');

// ---- 技能行渲染（含术语展开子行；裁决：termRefs 内联为「术语」子行，替代「引用术语」尾注） ----
// 裁决：技能 id 括注全部去除——同名不同 id 的技能靠口径（提升替换）与描述数值自然区分，
// id 是技术细节不入语料（如「红龙之血」+30%/+45% 两行文本本身已可区分）。
const bulletLine = (op, ref) => {
  const s = skills[ref.id];
  let caliber = ref.unlock;
  if (ref.unlock.endsWith('提升')) {
    const prefix = ref.id.slice(0, ref.id.lastIndexOf('_'));
    const cands = op.buildingSkills.filter((r) => r !== ref && r.id.startsWith(prefix + '_') && r.index < ref.index);
    const prev = cands.sort((a, b) => b.index - a.index)[0]; // 最近前驱（三段链取直接上一段，sync 的 find 首个命中是 bug）
    if (prev && skills[prev.id]) caliber += `，替换「${skills[prev.id].name}」`;
  }
  const anno = s.tags.length ? `　〔标签：${s.tags.join('/')}〕` : '';
  const line = `- **${caliber}**「${s.name}」：${s.description}${anno}`;
  const termLines = s.termRefs.map((r) => `  - 术语「${r.name}」：${r.desc}`);
  return [line, ...termLines].join('\n');
};

// ---- 分片公共文案（照抄存量快照） ----
const SHARD_HEAD = (label, nSkills, nOps) => `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据全量生成，请勿手改。 -->

# ${label}基建技能

${label}相关技能 **${nSkills} 个**，涉及干员 **${nOps} 名**。只收录该设施的技能；同一干员在别的设施还有技能时，去对应分片查。

**练度门槛**：\`精N\` = 精英化 N 阶段；\`Lv.30\` = 等级 30。

- 一星、二星干员通常在达到 30 级（精零满级）时解锁相应后勤技能；
- 三星、四星干员通常在精一阶段解锁或提升后勤技能；
- 五星、六星干员通常在精二阶段解锁或提升后勤技能；
- 具体技能行的解锁字段优先于按星级概括的常见规则，不能把一、二星的常见规则扩展到三星。

**提升 vs 解锁 —— 这个区分很关键**：

- **解锁**：在对应练度获得新的后勤技能，前一技能仍然保留；
- **提升**：在对应练度替换或增强前一技能，具体替换关系以技能行的“替换”字段为准。

例：温蒂精 2 的「仿生海龙」是**提升**，不是新增的第三个技能；巫恋精 2 的「低语」是**解锁**，不是替换精零技能。

## 按干员
`;

// ---- 九个分片 ----
const stats = {};
for (const rk of ROOM_ORDER) {
  const opsInRoom = operators
    .filter((op) => op.buildingSkills.some((r) => roomKey(r.id) === rk))
    .sort((a, b) => b.rarity - a.rarity || (a.name < b.name ? -1 : 1));
  const skillIds = new Set(operators.flatMap((op) => op.buildingSkills.filter((r) => roomKey(r.id) === rk).map((r) => r.id)));
  stats[rk] = { skills: skillIds.size, ops: opsInRoom.length };

  let out = SHARD_HEAD(ROOM_LABEL[rk], skillIds.size, opsInRoom.length);
  for (const op of opsInRoom) {
    out += `\n### ${op.name} ☆${op.rarity} · ${op.professionLabel}\n\n`;
    out += op.buildingSkills.filter((r) => roomKey(r.id) === rk).sort((a, b) => a.index - b.index).map((r) => bulletLine(op, r)).join('\n') + '\n';
  }

  // 「技能 → 持有者」反向索引已按裁决删除：按干员查走名册，同效技能走等价组
  writeFileSync(join(OUT, ROOM_FILE[rk]), out.trimEnd() + '\n');
  console.log(`${ROOM_FILE[rk]}: ${skillIds.size} 技能 / ${opsInRoom.length} 干员`);
}

// ---- 名册 ----
{
  const groupMembers = new Map();
  for (const t of Object.values(terms)) {
    const m = t.desc.match(/包含以下干员\s*(.+)/);
    if (m) groupMembers.set(t.name, new Set(m[1].split('、').map((x) => x.trim())));
  }
  // 受管名录（异格）同样计入所属组——有基建技能引用该类别（「异格者」→ 术语「异格」）
  for (const [name, r] of Object.entries(rosters)) {
    if (!groupMembers.has(name)) groupMembers.set(name, new Set());
    for (const m of r.members) groupMembers.get(name).add(m);
  }
  let out = `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据全量生成，请勿手改。 -->

# 干员名册

全部 **${operators.length} 名**干员。这份名单是**边界闭包**：不在表内的名字一律回答「不知道是谁」，不要凭印象补。

字段：\`标准名 | 星级 | 职业 | 有基建技能的设施 | 所属组\`。「所属组」取自官方术语表（见 \`类别.md\`）及受管名录增补（异格，见 \`类别.md\` 名录节），只列基建技能会引用到的组；为空表示没有基建技能引用其归属。
`;
  for (let star = 6; star >= 1; star--) {
    const ops = operators.filter((op) => op.rarity === star).sort((a, b) => (a.name < b.name ? -1 : 1));
    if (!ops.length) continue;
    out += `\n## ☆${star}（${ops.length} 名）\n`;
    for (const op of ops) {
      // 设施序 = ROOM_ORDER 统一序（存量主体口径；怒潮凛冬/可露希尔等少数行为存量序异常，重渲染统一）
      const rk = [...new Set(op.buildingSkills.map((r) => roomKey(r.id)))].sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b));
      // 所属组 = 纯组成员身份（存量口径：伊芙利特等技能无引用仍列组）
      const gs = [...groupMembers.entries()].filter(([, ms]) => ms.has(op.name)).map(([g]) => g);
      out += `- ${op.name} | ☆${op.rarity} | ${op.professionLabel} | ${rk.map((k) => ROOM_LABEL[k]).join('、')}${gs.length ? ' | ' + gs.join('、') : ''}\n`;
    }
  }
  writeFileSync(join(OUT, '名册.md'), out);
  console.log(`名册.md: ${operators.length} 名`);
}

// ---- 类别 ----
{
  const bySec = { 干员组: [], 技能组: [], 设施组: [], 技能持有: [], 全局资源: [], 规则说明: [] };
  for (const t of Object.values(terms)) {
    if (/^包含以下干员/.test(t.desc)) bySec.干员组.push(t);
    else if (/^包含以下技能/.test(t.desc)) bySec.技能组.push(t);
    else if (/^包含以下设施/.test(t.desc)) bySec.设施组.push(t);
    else if (/^拥有该基建技能的干员/.test(t.desc)) bySec.技能持有.push(t);
    else if (/^由以下干员的基建技能提供/.test(t.desc)) bySec.全局资源.push(t);
    else bySec.规则说明.push(t);
  }
  // 全局资源 (N) = 提供者干员数（自明口径；存量外势(3)/实地(2)/工程机器人(1) 数字无数据可复现，属上游私有口径）

  let out = `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据与受管名录增补全量生成，请勿手改。 -->

# 官方术语与类别

取自游戏内官方术语表（共 ${Object.keys(terms).length} 条）。基建技能描述里引用的每一个类别、全局资源和叠加规则都在这里有权威定义。

**用途**：用户说「谢拉格干员」「金属工艺类技能」「深海猎人」这类**类别**时，在这里查成员列表，不要自己回忆。类别成员是可枚举的；查不到的类别说法（如社区俗称）要反问，不要猜。
`;
  const group = (t) => t.desc.replace(/^包含以下干员\s*/, '').split('、').map((x) => x.trim());
  out += `\n## 干员组（${bySec.干员组.length} 条）\n`;
  for (const t of [...bySec.干员组].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const ms = group(t);
    out += `- **${t.name}**（${ms.length}）：${ms.join('、')}\n`;
  }
  const simple = (sec, title, parse) => {
    out += `\n## ${title}（${bySec[sec].length} 条）\n\n`;
    for (const t of [...bySec[sec]].sort((a, b) => (a.name < b.name ? -1 : 1))) out += parse(t);
  };
  simple('全局资源', '全局资源', (t) => {
    const m = t.desc.match(/^由以下干员的基建技能提供\s*(.+)$/);
    let providers = m[1], rule = '';
    const rm = m[1].match(/^(.+?)\s*((?:每|可影响|由).*)$/);
    if (rm) { providers = rm[1]; rule = rm[2]; }
    const ps = providers.split('、').map((x) => x.trim());
    return `- **${t.name}**（${ps.length}）：${ps.join('、')}\n${rule ? rule + '\n' : ''}`;
  });
  simple('技能组', '技能组', (t) => {
    const ms = t.desc.replace(/^包含以下技能\s*/, '').split('、').map((x) => x.trim());
    return `- **${t.name}**（${ms.length}）：${ms.join('、')}\n`;
  });
  simple('技能持有', '技能持有', (t) => {
    const ms = t.desc.replace(/^拥有该基建技能的干员\s*/, '').split('、').map((x) => x.trim());
    return `- **${t.name}**（${ms.length}）：${ms.join('、')}\n`;
  });
  simple('设施组', '设施组', (t) => {
    const ms = t.desc.replace(/^包含以下设施\s*/, '').split('、').map((x) => x.trim());
    return `- **${t.name}**（${ms.length}）：${ms.join('、')}\n`;
  });
  // 规则说明里的类别术语若有受管名录（异格），官方定义后随附具体成员，保持可枚举
  simple('规则说明', '规则说明', (t) => {
    const r = rosters[t.name];
    if (!r) return `- **${t.name}**：${t.desc}\n`;
    const byStar = new Map();
    for (const m of [...r.members].sort((a, b) => opStars.get(b) - opStars.get(a) || (a < b ? -1 : 1)))
      (byStar.get(opStars.get(m)) ?? byStar.set(opStars.get(m), []).get(opStars.get(m))).push(m);
    let out = `- **${t.name}**：${t.desc}——具体名录（共 ${r.members.length} 名，${r.asOf} 核对，整理自 ${r.source}）：\n`;
    for (const [star, ms] of byStar) out += `  ☆${star}（${ms.length}）：${ms.join('、')}\n`;
    return out;
  });
  writeFileSync(join(OUT, '类别.md'), out);
  console.log(`类别.md: ${Object.values(bySec).flat().length} 条 = 干员组${bySec.干员组.length}/全局资源${bySec.全局资源.length}/技能组${bySec.技能组.length}/技能持有${bySec.技能持有.length}/设施组${bySec.设施组.length}/规则说明${bySec.规则说明.length}`);
}

// ---- 技能等价组 ----
{
  const byDesc = new Map(); // desc -> Set(name)
  for (const s of Object.values(skills)) byDesc.set(s.description, (byDesc.get(s.description) ?? new Set()).add(s.name));
  const holdersByDesc = new Map();
  for (const op of operators)
    for (const ref of op.buildingSkills) {
      const d = skills[ref.id].description;
      (holdersByDesc.get(d) ?? holdersByDesc.set(d, []).get(d)).push({ name: op.name, star: op.rarity, unlock: ref.unlock });
    }
  const groups = [];
  for (const [desc, names] of byDesc) {
    if (names.size < 2) continue;
    const holders = holdersByDesc.get(desc).sort((a, b) => b.star - a.star || (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.unlock < b.unlock ? 1 : -1)));
    const rk = operators.flatMap((op) => op.buildingSkills.map((r) => r.id)).find((id) => skills[id].description === desc).split('_')[0];
    groups.push({ names: [...names].sort(), desc, holders, rk });
  }
  let out = `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据全量生成，请勿手改。 -->

# 技能等价组（同效不同名）

下列每一组里的技能，**官方显示名不同但效果描述逐字相同**——它们是同一个东西。玩家往往只用其中一个名字（或一个社区俗称）指代整组。

**用途**：用户提到某个技能名时，先看它落在哪一组，然后**整组的持有者都是候选**。只按字面技能名去 \`技能-*.md\` 里找，会漏掉大部分人。

典型例子：玩家说的「裁缝 β」在数据里叫 \`裁缝·β\`，但 \`手工艺品·β\`（卡夫卡）和 \`鉴定师的手段\`（折光）与它描述完全一致，四人常被统称裁缝并列提及。

共 ${groups.length} 组。
`;
  for (const rk of ROOM_ORDER) {
    const gs = groups.filter((g) => g.rk === rk).sort((a, b) => (a.names[0] < b.names[0] ? -1 : 1));
    if (!gs.length) continue;
    out += `\n## ${ROOM_LABEL[rk]}\n\n`;
    for (const g of gs) {
      out += `- **${g.names.join(' ＝ ')}**\n  - 效果：${g.desc}\n  - 持有者：${g.holders.map((h) => `${h.name}☆${h.star}${unlockShort(h.unlock)}`).join('、')}\n\n`;
    }
  }
  out = out.trimEnd() + '\n';
  writeFileSync(join(OUT, '技能等价组.md'), out);
  console.log(`技能等价组.md: ${groups.length} 组`);
}

// ---- 歧义（自动节：子串包含对） ----
{
  const roomsOf = (op) => [...new Set(op.buildingSkills.map((r) => roomKey(r.id)))].sort((a, b) => ROOM_ORDER.indexOf(a) - ROOM_ORDER.indexOf(b)).map((k) => ROOM_LABEL[k]);
  const ops = operators.map((op) => ({ name: op.name, rooms: roomsOf(op) }));
  const pairs = [];
  for (const a of ops) for (const b of ops) {
    // 短名至少 2 字符：单字子串（陈/空/红…）误报率高，上游快照同规则过滤
    if (a === b || a.name.length < 2 || !b.name.includes(a.name)) continue;
    const overlap = a.rooms.some((r) => b.rooms.includes(r));
    pairs.push({ short: a, long: b, overlap });
  }
  pairs.sort((x, y) => (x.short.name < y.short.name ? -1 : x.short.name > y.short.name ? 1 : x.long.name < y.long.name ? -1 : 1));
  let out = `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据全量生成，请勿手改。 -->

# 歧义·子串包含对（自动生成）

**硬规则**：用户输入恰好等于某个短名／俗称时，不许静默挑一个。静默选错不会有任何报错，但数值会直接答错。

消歧的可用线索是**设施**：如果两人的基建技能落在不同设施，而用户已经点明了设施（「贸易站放谁」「发电站用谁」），就按设施判断并在回答里说明你按哪个理解的；设施重叠或用户没点明的，直接反问。


## 一、子串包含对（${pairs.length} 组，自动生成）

短名是长名的子串。它们是**不同干员、数据不同**。

`;
  for (const p of pairs) {
    out += `- **${p.short.name}**（${p.short.rooms.join('、')}） ⊂ ${p.long.name}（${p.long.rooms.join('、')}｜${p.overlap ? '设施重叠→必须反问' : '设施不重叠→可按上下文判断'}）\n`;
  }
  writeFileSync(join(OUT, '歧义-子串对.md'), out);
  console.log(`歧义-子串对.md: ${pairs.length} 对`);
}

// ---- 标签速查（功能查表：全部标签按设施分节 → 技能 → 持有干员） ----
// 定位：模块 3 的「按功能找干员」聚合视图；与分片「按干员」视图互补，与已删除的
// 「技能 → 持有者」精确反查不同粒度。转正时落位 docs/3-组合库/标签速查.md。
{
  const skillTerms = JSON.parse(readFileSync(join(CLEAN, 'skill-terms.json'), 'utf8'));
  const holdersOf = (id) => operators
    .filter((op) => op.buildingSkills.some((r) => r.id === id))
    .sort((a, b) => b.rarity - a.rarity || (a.name < b.name ? -1 : 1))
    .map((op) => `${op.name}☆${op.rarity}${unlockShort(op.buildingSkills.find((r) => r.id === id).unlock)}`);

  const tagNames = Object.keys(skillTerms.tags);
  let out = `<!-- 本文件由 scripts/render-skill-snapshot.mjs 从 clean 数据全量生成，请勿手改。 -->

# 标签速查（按功能找干员）

全部 **${tagNames.length} 个**官方技能标签，按设施分节、标签分组：同一功能下的技能与全部持有干员一览。技能原文与解锁口径以 \`技能-*.md\` 分片为准；持有者记号 \`(精0/精1/精2/Lv.30)\` 为该干员获得此技能的练度档。

**用途**：「搓玉派谁」「线索搜集谁快」「宿舍回心情谁好」这类按功能找人的问题，先在这里定位候选干员，再回分片核对技能细节。

`;
  for (const rk of ROOM_ORDER) {
    const roomTags = tagNames
      .map((t) => [t, skillTerms.tags[t].skills.filter((id) => roomKey(id) === rk)])
      .filter(([, ids]) => ids.length);
    if (!roomTags.length) continue;
    out += `## ${ROOM_LABEL[rk]}\n\n`;
    for (const [tag, ids] of roomTags.sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      out += `### ${tag}（${ids.length} 个技能）\n\n`;
      const sorted = [...ids].sort((a, b) => (skills[a].name < skills[b].name ? -1 : 1));
      for (const id of sorted) out += `- 「${skills[id].name}」${skills[id].description}：${holdersOf(id).join('、')}\n`;
      out += '\n';
    }
  }
  writeFileSync(join(OUT, '标签速查.md'), out.trimEnd() + '\n');
  const totalSkillRefs = tagNames.reduce((a, t) => a + skillTerms.tags[t].skills.length, 0);
  console.log(`标签速查.md: ${tagNames.length} 标签 / ${totalSkillRefs} 技能条目`);
}

console.log(`\n输出目录: ${OUT}`);
