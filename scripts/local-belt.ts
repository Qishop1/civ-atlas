/** 本地自查:第六十轮城市带 —— 哪些带、什么时候成形、叫什么、多少区。npx tsx scripts/local-belt.ts 2 5500 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { cityBelts, beltEntries, beltName, beltStateAt } from '../src/gen/civ/story/cityBelts';
const seed = Number(process.argv[2] ?? 2), end = Number(process.argv[3] ?? 5500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
const t0 = performance.now();
const B = cityBelts(civ);
console.log('算城市带', (performance.now() - t0).toFixed(0), 'ms;取样', B.samples.length, '带', B.belts.length, '事件', B.events.length);
for (const b of B.belts) console.log(' ', b.id, beltName(civ, b), b.from, '→', b.to ?? '末', 'core', civ.settlements[b.core].name);
const st = beltStateAt(civ, end);
if (st) {
  const nb = new Map<number, number>();
  st.beltOf.forEach((v) => v >= 0 && nb.set(v, (nb.get(v) ?? 0) + 1));
  console.log('末年各带城数', [...nb].map(([b, c]) => `${beltName(civ, B.belts[b])}:${c}`).join(' '), '区', st.districtOf.filter((v) => v >= 0).length);
}
for (const e of beltEntries(civ, 0).slice(0, 14)) console.log(Math.floor(e.year), e.text);
