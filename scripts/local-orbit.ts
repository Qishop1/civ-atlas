/** 本地自查:第六十六轮反卫星、轨道封锁、收太空垃圾。npx tsx scripts/local-orbit.ts 2 8 10 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/story/religionText';
for (const seed of process.argv.slice(2).map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
  const o = civ.annals.filter((a) => a.kind === 'orbit');
  console.log('== 种子', seed, '互打卫星', o.filter((a) => a.n === 0).length, '连锁封锁', o.filter((a) => a.n === 1).map((a) => `${Math.floor(a.year)}+${a.oob?.[0]}年`).join(' ') || '-', '电梯断', o.filter((a) => a.n === 2).length);
  for (const e of fullChronicle(civ).filter((x) => x.kind === 'orbit' || x.kind === 'debris').slice(0, 12)) console.log(' ', Math.floor(e.year), e.text.slice(0, 80));
}
