/** 本地实验:陆地像素里有多少不属于任何州(太小的岛)。npx tsx scripts/local-islets.ts 2 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
const seed = Number(process.argv[2] ?? 2);
const world = generateWorld({ seed } as WorldParams);
const civ = generateCiv(world, { endYear: 3000 });
const raster = rasterize(world, 0.5, false);
let land = 0,
  noReg = 0;
const cells = new Set<number>();
for (let i = 0; i < raster.w * raster.h; i++) {
  if (raster.water[i]) continue;
  land++;
  const c = raster.cell[i];
  if (c < 0 || civ.regions.of[c] < 0) {
    noReg++;
    cells.add(c);
  }
}
console.log(`陆地像素 ${land},不属于任何州 ${noReg}(${((noReg / land) * 100).toFixed(1)}%),涉及地块 ${cells.size}`);
