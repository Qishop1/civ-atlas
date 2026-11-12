/** 本地实验:海洋行星(陆地很少)推演接不接得住 —— 州数、海洋文化、国家数、多早能远洋、有没有报错。npx tsx scripts/local-ocean.ts 7 3000 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { generateCiv } from '../src/gen/civ';
const seed = Number(process.argv[2] ?? 7);
const end = Number(process.argv[3] ?? 3000);
for (const land of [0.33, 0.12, 0.06, 0.03]) {
  const t0 = Date.now();
  try {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed, landFraction: land } as WorldParams);
    const civ = generateCiv(w, { endYear: end });
    const sea = civ.cultures.filter((c) => c.kind === 'sea').length;
    const alive = civ.polities.filter((p) => (p as unknown as { end?: number }).end === undefined || (p as unknown as { end?: number }).end! >= end).length;
    const sails = civ.polities.map((p) => (p as unknown as { sail?: number }).sail).filter((x): x is number => typeof x === 'number' && isFinite(x));
    console.log(
      `陆地 ${Math.round(land * 100)}%:州 ${civ.regions.count},文化 ${civ.cultures.length}(海洋 ${sea}),城 ${civ.settlements.length},国家 ${civ.polities.length}(到最后还在 ${alive}),` +
        `最早远洋 ${sails.length ? Math.round(Math.min(...sails)) : '无'},史事 ${civ.annals.length},${((Date.now() - t0) / 1000).toFixed(1)} 秒`,
    );
  } catch (e) {
    console.log(`陆地 ${Math.round(land * 100)}%:出错 ${String(e).slice(0, 200)}`);
  }
}
