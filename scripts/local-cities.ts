import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { populationAt, capacityAt, devFactorAt } from '../src/gen/civ/growth';
const civ = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 20030519) } as WorldParams), { endYear: 4600 });
for (const y of [1000, 2000, 3000, 3500, 4000, 4600]) {
  const ps = civ.settlements.map((s) => ({ s, p: populationAt(s, y) })).filter((x) => x.p > 0).sort((a, b) => b.p - a.p);
  const top = ps[0];
  const tot = ps.reduce((a, x) => a + x.p, 0);
  console.log(`${y}: 城 ${ps.length} 座,城里共 ${(tot / 1000).toFixed(1)} 百万;最大 ${top.s.name} ${(top.p / 1000).toFixed(2)} 百万(上限底子 ${(capacityAt(top.s, y) / 1000).toFixed(2)} 百万 × 发展倍数 ${top.s.devCap ? devFactorAt(top.s.devCap, y).toFixed(2) : 1});前五 ${ps.slice(0, 5).map((x) => (x.p / 1000).toFixed(2)).join(' / ')}`);
}
