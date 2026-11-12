import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersFromScratch } from '../src/gen/civ/engine/timeline';
import { polityName } from '../src/gen/civ/growth';
import { KM_PER_UNIT } from '../src/gen/civ/scale';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4600 });
const reg = civ.regions;
const km2 = KM_PER_UNIT * KM_PER_UNIT;
let landAll = 0, lived = 0;
for (let r = 0; r < reg.count; r++) landAll += reg.area[r] * km2;
for (const y of [3000, 3513, 3700, 3900, 4200, 4600]) {
  const own = ownersFromScratch(civ, y);
  const area = new Map<number, number>(), cnt = new Map<number, number>();
  let livedY = 0;
  for (let r = 0; r < reg.count; r++) {
    if (own.culture[r] >= 0) livedY += reg.area[r] * km2;
    const p = own.polity[r];
    if (p < 0) continue;
    area.set(p, (area.get(p) ?? 0) + reg.area[r] * km2);
    cnt.set(p, (cnt.get(p) ?? 0) + 1);
  }
  const top = [...area].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`${y}年 有人住的陆地 ${(livedY / 1e6).toFixed(1)} 百万km² | ` + top.map(([p, a]) => `${polityName(civ.polities[p], y)} ${cnt.get(p)}州 ${(a / 1e6).toFixed(1)}百万km²(${((a / livedY) * 100).toFixed(0)}%)`).join(' / '));
}
console.log(`全部州的面积 ${(landAll / 1e6).toFixed(1)} 百万km²`);
