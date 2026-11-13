/** 本地实验:信息时代以后的国家是什么政体;信息时代以后的在位 / 执政更替、饥荒、洗劫怎么写。npx tsx scripts/local-regime-modern.ts 2 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { regimeAt } from '../src/gen/civ/regime';
import { buildChronicle, reignEntries } from '../src/gen/civ/story/chronicle';
const seed = Number(process.argv[2] ?? 2);
const civ: any = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
for (const y of [4000, 4500, 5000, 5499]) {
  const c: Record<string, number> = {};
  for (const p of civ.polities) {
    if (p.founded > y || (p.ended !== undefined && p.ended <= y)) continue;
    if (!p.modern || p.modern[2] === undefined || p.modern[2] > y) continue;
    const r = regimeAt(p, y);
    c[r] = (c[r] ?? 0) + 1;
  }
  console.log(y, JSON.stringify(c));
}
const all = buildChronicle(civ);
const pick = (re: RegExp, n: number) => all.filter((e: any) => e.year > 4300 && re.test(e.text)).slice(0, n).forEach((e: any) => console.log('  ', Math.floor(e.year), e.tag ?? '', e.text.slice(0, 120)));
console.log('-- 饥荒 / 粮食'); pick(/饥荒|粮食危机/, 5);
console.log('-- 攻入 / 劫掠'); pick(/攻城战|巷战|攻入|劫掠/, 5);
console.log('-- 在位'); reignEntries(civ).filter((e: any) => e.year > 4300).slice(0, 14).forEach((e: any) => console.log('  ', Math.floor(e.year), e.text.slice(0, 120)));
