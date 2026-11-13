/** 本地实验:看某几个世界坐标点的州、推演归属、认领。npx tsx scripts/local-claimprobe.ts 11 3950 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { claimFill, claimPixel } from '../src/gen/civ/story/claims';
const seed = Number(process.argv[2] ?? 11),
  year = Number(process.argv[3] ?? 3950);
const world = generateWorld({ seed } as WorldParams);
const civ = generateCiv(world, { endYear: 5500 });
const raster = rasterize(world, 1, false);
const sim = ownersAt(civ, year).polity;
const own = Int16Array.from(sim);
const f = claimFill(civ, world, year, own, raster);
for (const y of [170, 190, 210, 230, 250])
  console.log(
    y,
    [150, 170, 185, 190, 195, 210, 230, 790]
      .map((x) => {
        const k = Math.floor(y * raster.scale) * raster.w + Math.floor(x * raster.scale);
        const c = raster.cell[k];
        const r = c >= 0 ? civ.regions.of[c] : -1;
        return `${x}:r${r} s${r >= 0 ? sim[r] : '-'} z${r >= 0 ? f.claims.zoneOf[r] : '-'} px${claimPixel(f, k, r)} w${raster.water[k]}`;
      })
      .join(' | '),
  );
