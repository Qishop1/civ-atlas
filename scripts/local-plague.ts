/** 本地实验:第三十二轮现代传染病 —— 每场多少州 / 多少国 / 几国关口岸 / 几年,和编年史原文。npx tsx scripts/local-plague.ts 381500 5500 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
const seed = Number(process.argv[2] ?? 381500);
const end = Number(process.argv[3] ?? 5500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
const byWar = new Map<number, typeof civ.annals>();
for (const e of civ.annals) if (e.kind === 'plague' || e.kind === 'quarantine') (byWar.get(e.war) ?? byWar.set(e.war, []).get(e.war)!).push(e);
let modern = 0;
let old = 0;
for (const [k, es] of byWar) {
  const pl = es.filter((e) => e.kind === 'plague');
  if (!pl.length) continue;
  if (pl[0].cause !== 'modern') { if (pl[0].year > end - 1500) old++; continue; }
  modern++;
  const q = es.filter((e) => e.kind === 'quarantine').length;
  const nations = new Set(pl.map((e) => e.a)).size;
  const yrs = Math.floor(pl[pl.length - 1].year) - Math.floor(pl[0].year) + 1;
  console.log(`#${k} ${Math.floor(pl[0].year)} 州 ${pl.reduce((a, e) => a + e.b, 0)} 国 ${nations} 关口岸 ${q} 传了 ${yrs} 年(上限 ${pl[0].n})`);
}
console.log(`现代传染病 ${modern} 场;最后 1500 年里旧式瘟疫 ${old} 场`);
const ch = buildChronicle(civ).filter((e) => e.kind === 'plague' && e.text.includes('新型传染病'));
for (const e of ch.slice(0, 6)) console.log(`[${Math.floor(e.year)}] ${e.text}`);
