/**
 * 本地实验:某年各州归谁涂成图(认领前 / 后各一张,原始 RGB),给 Python 转 PNG 看。
 * npx tsx scripts/local-claims-img.ts 2 3750 <输出目录>
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { claimsAt, nearestAnchor } from '../src/gen/civ/story/claims';
const seed = Number(process.argv[2] ?? 2);
const year = Number(process.argv[3] ?? 3750);
const outDir = process.argv[4] ?? '.';
const world = generateWorld({ seed } as WorldParams);
const civ = generateCiv(world, { endYear: 5500 });
const raster = rasterize(world, 0.5, false);
const own = ownersAt(civ, year).polity;
const cl = claimsAt(civ, world, year);
const W = raster.w,
  H = raster.h;
const col = (p: number): [number, number, number] => {
  const h = Math.sin(p * 12.9898 + 4.1) * 43758.5453;
  const f = h - Math.floor(h);
  const g = Math.sin(p * 78.233 + 1.7) * 12345.678;
  const f2 = g - Math.floor(g);
  return [60 + Math.floor(f * 170), 60 + Math.floor(f2 * 170), 60 + Math.floor(((f + f2) % 1) * 170)];
};
for (const mode of ['before', 'after']) {
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const o = i * 3;
      if (raster.water[i]) {
        buf[o] = 20;
        buf[o + 1] = 30;
        buf[o + 2] = 60;
        continue;
      }
      const cell = raster.cell[i];
      const r = cell >= 0 ? civ.regions.of[cell] : -1;
      let p = r >= 0 ? own[r] : -1;
      if (mode === 'after' && p < 0 && r >= 0 && cl.zoneOf[r] >= 0) {
        // 像素级:按最近的锚点(直线分界)
        const z = cl.zones[cl.zoneOf[r]];
        const wx = (x + 0.5) / raster.scale;
        const wy = (y + 0.5) / raster.scale;
        p = nearestAnchor(z.anchors, wx, wy, world.width);
      }
      if (mode === 'after' && p < 0 && r < 0 && cell >= 0) p = cl.cellOwner[cell];
      const [a, b, c] = p >= 0 ? col(p) : [235, 235, 235];
      buf[o] = a;
      buf[o + 1] = b;
      buf[o + 2] = c;
    }
  writeFileSync(`${outDir}/claims_${seed}_${year}_${mode}.rgb`, buf);
}
console.log(`${W}x${H} 片 ${cl.zones.length}`);
