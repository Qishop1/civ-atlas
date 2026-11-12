/**
 * 本地分支 modern-pace 第六十七轮:城在地图上画在哪(只管显示,不改推演)。
 * 城按所在地块的中心画;卫星底图画海岸线比地块网格平滑,小岬角、小半岛上的城,地块中心可能落在底图的水里
 * (用户"那个观潮城那个点还在海上啊")—— 这时挪到 SEARCH 像素以内最近的陆地像素上;找不到就照原样。
 */
import type { Raster } from '../../gen/raster';
import type { World } from '../../gen/world';

const SEARCH = 32;
const cache = new WeakMap<Raster, Map<number, [number, number]>>();

export function cityPos(world: World, raster: Raster | undefined, cell: number): [number, number] {
  const x0 = world.mesh.x[cell],
    y0 = world.mesh.y[cell];
  if (!raster) return [x0, y0];
  let m = cache.get(raster);
  if (!m) cache.set(raster, (m = new Map()));
  const hit = m.get(cell);
  if (hit) return hit;
  const W = raster.w,
    H = raster.h,
    s = raster.scale;
  const ix = Math.floor(x0 * s),
    iy = Math.floor(y0 * s);
  const water = (x: number, y: number) => y < 0 || y >= H || raster.water[y * W + (((x % W) + W) % W)] !== 0;
  let out: [number, number] = [x0, y0];
  if (water(ix, iy)) {
    let best = Infinity;
    for (let dy = -SEARCH; dy <= SEARCH; dy++)
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        const d = dx * dx + dy * dy;
        if (d >= best || d > SEARCH * SEARCH || water(ix + dx, iy + dy)) continue;
        best = d;
        out = [(ix + dx + 0.5) / s, (iy + dy + 0.5) / s];
      }
  }
  m.set(cell, out);
  return out;
}
