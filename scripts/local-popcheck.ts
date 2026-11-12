import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { populationAt, ruralPopulationAt, polityName } from '../src/gen/civ/growth';
import { metroOf } from '../src/gen/civ/story/practiceInfo';
for (const seed of (process.argv[2] ?? '7,42,2024,11').split(',').map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 4600 });
  const row: string[] = [];
  for (const y of [3400, 4000, 4600]) {
    let city = 0, rural = 0, top = 0;
    for (const s of civ.settlements) { const p = populationAt(s, y); city += p; if (p > top) top = p; }
    for (let r = 0; r < civ.regions.count; r++) rural += ruralPopulationAt(civ, r, y);
    let m = 0;
    for (const p of civ.polities) if (p.founded <= y && (p.ended === undefined || p.ended > y)) m = Math.max(m, metroOf(civ, p.id, y)[0]);
    row.push(`${y}: 合计 ${((city + rural) / 1e5).toFixed(1)} 亿 城占 ${((city / (city + rural)) * 100).toFixed(0)}% 最大城 ${Math.round(top / 10)} 万 最大城市群 ${(m / 1e5).toFixed(2)} 亿`);
  }
  console.log(`种子 ${seed}\n  ` + row.join('\n  '));
}
