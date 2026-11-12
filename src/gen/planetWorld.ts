/**
 * 本地分支 modern-pace:恒星系里别的岩质行星 → 世界生成器的参数(示意图放大看行星表面用;以后"下一局"殖民别的行星,新世界也从这里起)。
 *
 *   种子     由这个世界的种子和行星的键派生(同一个世界,每颗行星永远一样)
 *   气温     地表温度 = 平衡温度 + 温室(大气越厚越多:半径 ≥ 0.8 地球按地球的 +33°C,小的按比例少),换成地图生成用的整体偏移(地球 15°C 为 0);
 *            可以超出滑条的 ±12(生成器照样能出,极冷全冰、极热全荒漠)
 *   水       温和(偏移在 −25…+25)的:海陆按种子(陆地 25%–70%)、降水 0.3–1.2;太热的海煮干了(陆地 95%、降水 0.02);
 *            太冷的照常给海(会冻成冰壳)、降水很少
 *   板块     数量、造山强度按种子
 * 没有大气的(矮行星、半径不到 0.35 地球、平衡温度 200°C 以上)不走生成器:环形山地貌更像(见 airless)。
 */
import type { WorldParams } from './params';
import { DEFAULT_PARAMS } from './params';
import { subSeed } from './util';
import type { Planet } from './system';

/** 不走世界生成器的(没有大气、没有侵蚀):矮行星、太小的、太热的;气态 / 冰巨星 / 迷你海王星没有地面 */
export function airless(p: Planet): boolean {
  if (p.kind !== 'rocky' && p.kind !== 'super') return true;
  return p.radius < 0.35 * 6371 || p.teq > 200;
}

export function planetWorldParams(worldSeed: number, p: Planet): WorldParams {
  const seed = subSeed(worldSeed, `planet-world:${p.key}`) >>> 0;
  let a = seed || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 地表温度按这颗自己的温室(system.ts 的 surface);换成地图的整体偏移(地球 15°C 为 0)
  const offset = Math.max(-90, Math.min(120, p.surface - 15));
  const mild = offset > -25 && offset < 25;
  const hot = offset >= 25;
  return {
    ...DEFAULT_PARAMS,
    seed,
    cells: DEFAULT_PARAMS.cells,
    temperature: Math.round(offset),
    landFraction: hot ? 0.95 : mild ? 0.25 + 0.45 * r() : 0.35 + 0.3 * r(),
    rainfall: hot ? 0.02 : mild ? 0.3 + 0.9 * r() : 0.15,
    plates: 12 + Math.floor(r() * 30),
    mountains: 0.6 + r() * 1.2,
  };
}
