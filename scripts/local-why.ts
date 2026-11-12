import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { CAP_COUNT, developmentAt, eraLevel } from '../src/gen/civ/development';
import { capitalAt, polityName } from '../src/gen/civ/growth';
import { ownersFromScratch } from '../src/gen/civ/engine/timeline';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4600 });
const dev = civ.development!;
for (const y of [3600, 3888, 4100, 4300]) {
  const lv = developmentAt(dev, y);
  const own = ownersFromScratch(civ, y).polity;
  for (const p of civ.polities) {
    const n = polityName(p, y);
    if (!/阿利尼亚城邦|后景灵/.test(n)) continue;
    const s = civ.settlements[capitalAt(p, y)];
    if (!s) continue;
    const r = s.region, o = r * CAP_COUNT;
    let size = 0; for (let q = 0; q < own.length; q++) if (own[q] === p.id) size++;
    let nbMax = 0;
    for (let k = civ.regions.adjStart[r]; k < civ.regions.adjStart[r + 1]; k++) nbMax = Math.max(nbMax, eraLevel(lv, civ.regions.adj[k]));
    console.log(y, n, `${size}州`, '生产/运输/信息/行政/动员', [0, 1, 2, 3, 4].map((c) => lv[o + c].toFixed(1)).join('/'), '时代', eraLevel(lv, r).toFixed(1), '邻州最高时代', nbMax.toFixed(1));
  }
}
