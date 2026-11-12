/** 本地实验:极端气候的母星推演接不接得住 —— 冷到冰球、热到荒漠、极干。npx tsx scripts/local-extreme.ts 7 3000 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { generateCiv } from '../src/gen/civ';
const seed = Number(process.argv[2] ?? 7);
const end = Number(process.argv[3] ?? 3000);
const cases: [string, Partial<WorldParams>][] = [
  ['默认', {}],
  ['冷 −12(滑条最冷)', { temperature: -12 }],
  ['冷 −25', { temperature: -25 }],
  ['冷 −40(冻过头)', { temperature: -40 }],
  ['热 +12(滑条最热)', { temperature: 12 }],
  ['热 +25', { temperature: 25 }],
  ['极干 降水 0.1', { rainfall: 0.1 }],
];
for (const [name, p] of cases) {
  const t0 = Date.now();
  try {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed, ...p } as WorldParams);
    const civ = generateCiv(w, { endYear: end });
    const sea = civ.cultures.filter((c) => c.kind === 'sea').length;
    console.log(`${name}:州 ${civ.regions.count},文化 ${civ.cultures.length}(海洋 ${sea}),城 ${civ.settlements.length},国家 ${civ.polities.length},史事 ${civ.annals.length},${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  } catch (e) {
    console.log(`${name}:出错 ${String(e).slice(0, 200)}`);
  }
}
