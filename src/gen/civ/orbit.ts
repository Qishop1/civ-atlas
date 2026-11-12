/**
 * 本地分支 modern-pace 第六十六轮:反卫星、凯斯勒连锁碎片、轨道封锁(用户"星空清理者""有太空电梯可以捞不少碎片吧")。
 *
 * 推演里(wars.ts 的 asatAtWar):主要在核交换开始那一刻(双方都有卫星)—— ASAT_NUKE_P 的机会先互打预警、侦察卫星;平时只有两个都有空间站的大国
 *   (国土 ≥ ASAT_BIG 州)开战时有 ASAT_P 的机会。史事 orbit n = 0(a 先动手、b 挨打,oob = [打掉几颗, 核战 1 / 平时 0]);
 *   打了以后有 CASCADE_NUKE_P / CASCADE_NUKE_P_BOTH(平时 CASCADE_P)的机会碎片连锁撞碎别的卫星,近地轨道封锁 ——
 *   史事 orbit n = 1(oob = [封锁年数, 轻重‰, 解封那年]):40–120 年,世上已经建成太空电梯的(清理便宜得多)除以 3;
 *   建成的太空电梯各有 SEVER_P 的机会被碎片打断(史事 orbit n = 2,region / settlement = 锚点;解封后修好)。
 * 封锁期间(blockedAt):所有国家的卫星、天基反导失效(wars.ts 的 defenseOf:拦截率归零 —— 这时打核战更惨),
 *   不再打反卫星;航天任务顺延到解封以后(story/spaceText.ts);清理进度、解封写进编年史(story/orbitText.ts)。
 * 随机数:wars.ts 的 warRand(这一场战争)× U_ORBIT。
 */
import type { CivSim } from './engine/sim';

/** 第六十六轮(收紧,用户"缩紧一点好"):核交换开始时互打卫星、引发连锁(单方 / 双方都有空间站) */
export const ASAT_NUKE_P = 0.7;
export const CASCADE_NUKE_P = 0.35;
export const CASCADE_NUKE_P_BOTH = 0.5;
/** 平时:只有两个都有空间站、国土都至少 ASAT_BIG 州的大国开战才掷 */
export const ASAT_P = 0.08;
export const CASCADE_P = 0.2;
export const ASAT_BIG = 40;
export const BLOCK_MIN = 40;
export const BLOCK_SPAN = 80;
/** 有太空电梯时封锁年数除以几 */
export const TOWER_CUT = 3;
export const SEVER_P = 0.5;

export interface Blockade {
  year: number;
  until: number;
  sev: number;
}

const cache = new WeakMap<object, { n: number; list: Blockade[] }>();

/** 到目前为止的轨道封锁(按史事 orbit n = 1 重建) */
export function blockades(sim: CivSim): Blockade[] {
  let c = cache.get(sim);
  if (!c) cache.set(sim, (c = { n: 0, list: [] }));
  for (; c.n < sim.annalCount; c.n++) {
    const a = sim.annal(c.n);
    if (a.kind !== 'orbit' || a.n !== 1) continue;
    const o = a.oob ?? [];
    c.list.push({ year: a.year, until: o[2] ?? a.year + (o[0] ?? BLOCK_MIN), sev: (o[1] ?? 500) / 1000 });
  }
  return c.list;
}

/** t 这一刻轨道是不是被封锁着 */
export function blockedAt(sim: CivSim, t: number): boolean {
  for (const b of blockades(sim)) if (t >= b.year && t < b.until) return true;
  return false;
}

/** 按史事(读结果用):各次封锁 */
export function blockadesOf(annals: readonly { kind: string; n?: number; year: number; oob?: number[] }[]): Blockade[] {
  const out: Blockade[] = [];
  for (const a of annals) {
    if (a.kind !== 'orbit' || a.n !== 1) continue;
    const o = a.oob ?? [];
    out.push({ year: a.year, until: o[2] ?? a.year + (o[0] ?? BLOCK_MIN), sev: (o[1] ?? 500) / 1000 });
  }
  return out;
}

/** 第六十六轮:凯斯勒碎片壳的点(按编号定:倾角、升交点、起始相位、高度、角速度) */
export const DEBRIS_N = 2600;
export function debrisPoint(i: number, t: number): { lon: number; lat: number; h: number } {
  const r = (k: number) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const inc = Math.acos(1 - 2 * r(1)) ;
  const node = r(2) * Math.PI * 2;
  const h = 0.05 + 0.25 * Math.pow(r(3), 1.6);
  // 低的转得快(按开普勒 ∝ (1 + h)^-1.5),几十秒绕一圈(看得出在动,不晃眼)
  const w = (0.12 + 0.05 * r(4)) * Math.pow(1 + h, -1.5);
  const u = r(5) * Math.PI * 2 + w * t;
  // 轨道面里的位置 → 球面经纬度
  const x = Math.cos(u), y = Math.sin(u) * Math.cos(inc), z = Math.sin(u) * Math.sin(inc);
  const lon = Math.atan2(y, x) + node;
  return { lon: ((lon * 180) / Math.PI + 540) % 360 - 180, lat: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI, h };
}
/** 某年碎片壳有多浓(0 = 没有):封锁那年满,越清理越稀,解封那年没了 */
export function debrisDensity(blocks: readonly { year: number; until: number }[], year: number): number {
  let d = 0;
  for (const b of blocks) if (year >= b.year && year < b.until) d = Math.max(d, 1 - (year - b.year) / Math.max(1, b.until - b.year));
  return d;
}

/** 第六十六轮:被碎片打断的太空电梯(锚点州)—— 断开到重建完成(解封 + 3 年)这段时间里不画 */
export function towerSevered(annals: readonly { kind: string; n?: number; year: number; region: number; oob?: number[] }[], region: number, year: number): boolean {
  for (const a of annals) if (a.kind === 'orbit' && a.n === 2 && a.region === region && year >= a.year && year < (a.oob?.[0] ?? a.year + 40) + 3) return true;
  return false;
}
