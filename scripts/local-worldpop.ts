import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { populationAt, ruralPopulationAt } from '../src/gen/civ/growth';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4600 });
for (const y of [1000, 2000, 3000, 3400, 3600, 3800, 4000, 4300, 4600]) {
  let city = 0, rural = 0;
  for (const s of civ.settlements) city += populationAt(s, y);
  for (let r = 0; r < civ.regions.count; r++) rural += ruralPopulationAt(civ, r, y);
  console.log(`${y}: 城 ${(city / 1e5).toFixed(1)} 亿,乡 ${(rural / 1e5).toFixed(1)} 亿,合计 ${((city + rural) / 1e5).toFixed(1)} 亿(城占 ${((city / (city + rural)) * 100).toFixed(0)}%)`);
}
