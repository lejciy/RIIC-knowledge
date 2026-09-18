// 一次性差异分析：docs/2-干员技能 Markdown 快照 vs clean JSON 真源
import { readFileSync, readdirSync } from 'node:fs';

const DIR = 'docs/2-干员技能/';
const shardFiles = readdirSync(DIR).filter((f) => /^技能-.*\.md$/.test(f));
const BULLET = /^- \*\*(.+?)\*\*「(.+?)」(?:（`([^`]+)`）)?：(.+?)(?:　〔(.+?)〕)?\s*$/;
const HEADER = /^### (.+?) ☆(\d) · (\S+)\s*$/;

const md = new Map(); // op -> {star, prof, rooms: {file: [bullet]}}
const shardStats = {};
let bullets = 0;
for (const f of shardFiles) {
  const txt = readFileSync(DIR + f, 'utf8');
  const m = txt.match(/相关技能 \*\*(\d+) 个\*\*，涉及干员 \*\*(\d+) 名\*\*/);
  shardStats[f] = { declSkills: +m[1], declOps: +m[2] };
  let cur = null;
  for (const line of txt.split('\n')) {
    const h = line.match(HEADER);
    if (h) {
      cur = h[1];
      if (!md.has(cur)) md.set(cur, { star: +h[2], prof: h[3], rooms: {} });
      md.get(cur).rooms[f] ??= [];
      continue;
    }
    const b = line.match(BULLET);
    if (b && cur) {
      bullets++;
      md.get(cur).rooms[f].push({ caliber: b[1], skill: b[2], id: b[3], desc: b[4], anno: b[5] });
    }
  }
}

const roster = readFileSync(DIR + '名册.md', 'utf8');
const rosterNames = new Set([...roster.matchAll(/^- (.+?) \| ☆\d \| \S+ \|/gm)].map((m) => m[1]));
const cat = readFileSync(DIR + '类别.md', 'utf8');
const catCount = +cat.match(/共 (\d+) 条/)[1];
const catNames = new Set([...cat.matchAll(/^- \*\*(.+?)\*\*(?:（\d+）)?：/gm)].map((m) => m[1]));

const ost = JSON.parse(readFileSync('meta/mirror/RIIC-Web/clean/operator-skill-text.json', 'utf8'));
const terms = JSON.parse(readFileSync('meta/mirror/RIIC-Web/clean/term-catalog.json', 'utf8'));
const ROOM = { control: '技能-控制中枢.md', manu: '技能-制造站.md', trade: '技能-贸易站.md', dorm: '技能-宿舍.md', meet: '技能-会客室.md', hire: '技能-办公室.md', power: '技能-发电站.md', train: '技能-训练室.md', workshop: '技能-加工站.md' };

const jsonNames = new Set(ost.map((o) => o.name));
const newOps = ost.filter((o) => !rosterNames.has(o.name)).map((o) => ({ name: o.name, star: o.rarity, prof: o.professionLabel, skills: o.skills.map((s) => ({ ...s, file: ROOM[s.id.split('_')[0]] })) }));
const goneOps = [...rosterNames].filter((n) => !jsonNames.has(n));
const termNames = new Set(Object.values(terms).map((t) => t.name));
const newTerms = Object.values(terms).filter((t) => !catNames.has(t.name));
const goneTerms = [...catNames].filter((n) => !termNames.has(n));

const newSkills = [];
const descChanged = [];
const caliberChanged = [];
for (const o of ost) {
  // D16 后分片无 id 括注：同名多槽位按「渲染顺序 = 槽位 index 序」逐条消费，
  // 避免同名提升链的第二槽位错配到第一条 MD 行。
  const queues = new Map(); // `${file}|${skill}` -> 待消费 bullet 队列
  for (const s of o.skills) {
    const f = ROOM[s.id.split('_')[0]];
    const mo = md.get(o.name);
    const key = `${f}|${s.name}`;
    if (!queues.has(key)) queues.set(key, [...(mo?.rooms[f] ?? [])].filter((x) => x.id === s.id || (!x.id && x.skill === s.name)));
    const exist = queues.get(key).shift();
    if (!exist) {
      newSkills.push({ op: o.name, file: f, s });
      continue;
    }
    if (exist.desc !== s.description) descChanged.push({ op: o.name, skill: s.name, md: exist.desc, json: s.description });
    const calOk = exist.caliber === s.unlock || (exist.caliber.startsWith(s.unlock + '，替换') && exist.caliber.includes('「'));
    if (!calOk) caliberChanged.push({ op: o.name, skill: s.name, md: exist.caliber, json: s.unlock });
  }
}

const jsonByShard = {};
for (const o of ost)
  for (const s of o.skills) {
    const f = ROOM[s.id.split('_')[0]];
    jsonByShard[f] ??= { skills: new Set(), ops: new Set() };
    jsonByShard[f].skills.add(s.id);
    jsonByShard[f].ops.add(o.name);
  }

console.log('bullet 解析:', bullets, '/ 921 槽位；名册', rosterNames.size, '；类别声明', catCount, '实抓', catNames.size, '（Set 去重：特殊加成/特殊叠加规则各 2 条同名，非缺失）');
console.log('新干员:', newOps.map((o) => o.name).join('、'));
console.log('多余干员:', goneOps.join('、') || '无');
console.log('新术语:', newTerms.map((t) => t.name).join('、') || '无', '| 多余术语:', goneTerms.join('、') || '无');
console.log('新技能(槽位):', newSkills.length, '条');
for (const ns of newSkills) console.log('  ', ns.op, '→', ns.s.name, '(' + ns.s.unlock + ') @' + ns.file.replace('技能-', '').replace('.md', ''));
console.log('描述变化:', descChanged.length, '条');
for (const d of descChanged.slice(0, 12)) console.log('  [' + d.op + '·' + d.skill + ']\n    MD : ' + d.md + '\n    JSON: ' + d.json);
console.log('口径变化:', caliberChanged.length, '条');
for (const c of caliberChanged.slice(0, 8)) console.log('  ', c.op, c.skill, 'MD[' + c.md + '] JSON[' + c.json + ']');
console.log('--- 分片计数 声明→实际 ---');
for (const f of shardFiles) console.log(' ', f.replace('技能-', '').replace('.md', ''), shardStats[f].declSkills + '→' + jsonByShard[f].skills.size, '| 干员', shardStats[f].declOps + '→' + jsonByShard[f].ops.size);
