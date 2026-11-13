/** 本地实验:认领地的直线国界有几条。npx tsx scripts/local-claimlines.ts 11 3950 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { claimFill, claimBorderLines } from '../src/gen/civ/story/claims';
const seed = Number(process.argv[2] ?? 11),
  year = Number(process.argv[3] ?? 3950);
const world = generateWorld({ seed } as WorldParams);
const civ = generateCiv(world, { endYear: 5500 });
const raster = rasterize(world, 1, false);
const own = Int16Array.from(ownersAt(civ, year).polity);
const f = claimFill(civ, world, year, own, raster);
const R = civ.regions;
const ls = claimBorderLines(f, R.of, (r) => world.mesh.x[R.seat[r]], (r) => world.mesh.y[R.seat[r]]);
console.log('片', f.claims.zones.length, '多国的片', f.claims.zones.filter((z) => z.anchors.length > 1).length, '直线', ls.length, ls.slice(0, 6).map((l) => `${l.left}|${l.right} ${Array.from(l.pts).map((v) => v.toFixed(0)).join(',')}`).join('  '));
for (const [zi, z] of f.claims.zones.entries()) {
  if (z.anchors.length < 2) continue;
  let filled = 0;
  for (const r of z.regions) if (f.filled[r]) filled++;
  console.log(`片 ${zi}:州 ${z.regions.length}(填上 ${filled}) 锚点 ${z.anchors.map((a) => `${a.p}@${a.x.toFixed(0)},${a.y.toFixed(0)} w${a.w}`).join(' ')} x0 ${z.x0.toFixed(0)}`);
}
