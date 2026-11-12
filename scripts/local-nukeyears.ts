/** 本地实验:列出每一次动用核武器(哪年、哪场战争、谁打谁、几发),看频率。npx tsx scripts/local-nukeyears.ts 20030519 4600 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 20030519);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 4600) });
const nm = (p: number, y: number) => (civ.polities[p] ? polityName(civ.polities[p], y) : '?');
const tests = civ.annals.filter((a) => a.kind === 'nuke' && a.n === 0);
console.log(`首次核试验 ${Math.floor(tests[0]?.year ?? NaN)},有核国家 ${tests.length}`);
const by = new Map<string, { y: number; n1: number; n2: number; a: number; b: number }>();
for (const a of civ.annals) {
  if (a.kind !== 'nuke' || !a.n) continue;
  const k = `${a.war}|${Math.floor(a.year)}`;
  const g = by.get(k) ?? { y: a.year, n1: 0, n2: 0, a: a.a, b: a.b };
  if (a.n === 1) g.n1++; else g.n2++;
  by.set(k, g);
}
const wars = civ.annals.filter((a) => a.kind === 'war' && a.year >= (tests[0]?.year ?? 0));
const both = wars.filter((w) => tests.some((t) => t.a === w.a && t.year <= w.year) && tests.some((t) => t.a === w.b && t.year <= w.year));
console.log(`首次核试验以后的战争 ${wars.length} 场,其中双方都有核 ${both.length} 场`);
for (const g of by.values()) console.log(`${Math.floor(g.y)} ${nm(g.a, g.y)} → ${nm(g.b, g.y)}:战术 ${g.n1},战略 ${g.n2}`);
