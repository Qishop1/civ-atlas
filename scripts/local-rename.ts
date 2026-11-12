/** 本地自查:第五十七轮城市改名 —— 各原因多少次、举几个例子。npx tsx scripts/local-rename.ts 2 5500 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { cityRenames, renameEntries } from '../src/gen/civ/story/cityNames';
const seed = Number(process.argv[2] ?? 2), end = Number(process.argv[3] ?? 5500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
const all = cityRenames(civ).flat();
const by: Record<string, number> = {};
for (const r of all) by[r.cause] = (by[r.cause] ?? 0) + 1;
console.log('城', civ.settlements.length, '改名', all.length, by);
const bins: Record<string, number> = {};
for (const r of all) { const b = `${Math.floor(r.year / 500) * 500}`; bins[b] = (bins[b] ?? 0) + 1; }
console.log('按五百年', bins);
for (const e of renameEntries(civ, 0).filter((_, i) => i % 40 === 0).slice(0, 12)) console.log(Math.floor(e.year), e.text);
