import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { CAP_COUNT, INVENTIONS, developmentAt, eraLevel } from '../src/gen/civ/development';
const civ = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 20030519) } as WorldParams), { endYear: 4300 });
const dev = civ.development!;
const steam = INVENTIONS.findIndex((x) => x.name === '蒸汽机');
const r = dev.events.find((e) => e.kind === 'invent' && e.invention === steam)!.region;
console.log('领先州', r);
for (let y = 3300; y <= 4200; y += 50) {
  const lv = developmentAt(dev, y);
  const o = r * CAP_COUNT;
  let mx = [0, 0, 0, 0];
  for (let q = 0; q < civ.regions.count; q++) for (let c = 0; c < 4; c++) mx[c] = Math.max(mx[c], lv[q * CAP_COUNT + c]);
  console.log(y, '领先州 生产/运输/信息/行政', [0, 1, 2, 3].map((c) => lv[o + c].toFixed(2)).join('/'), '时代', eraLevel(lv, r).toFixed(2), '| 全世界最高', mx.map((v) => v.toFixed(2)).join('/'));
}
