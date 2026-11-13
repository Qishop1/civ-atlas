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
/** 第八十七轮:碎片刚撞出来时集中在哪个轨道面(倾角、升交点,弧度);spread 从 0 到 1 散成整层壳 */
const RING_INC = 1.13;
const RING_NODE = 0.7;
export function debrisPoint(i: number, t: number, spread = 1): { lon: number; lat: number; h: number } {
  const r = (k: number) => {
    const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  const s = Math.max(0, Math.min(1, spread));
  const inc = s >= 1 ? Math.acos(1 - 2 * r(1)) : (1 - s) * (RING_INC + 0.06 * (r(6) - 0.5)) + s * Math.acos(1 - 2 * r(1));
  const node = s >= 1 ? r(2) * Math.PI * 2 : (1 - s) * (RING_NODE + 0.08 * (r(7) - 0.5)) + s * r(2) * Math.PI * 2;
  // 第八十七轮:刚撞出来时都在差不多一个高度(一道细环),随散开放宽到 0.05–0.3 个半径
  const h0 = 0.05 + 0.25 * Math.pow(r(3), 1.6);
  const h = s >= 1 ? h0 : (1 - s) * (0.11 + 0.025 * (r(8) - 0.5)) + s * h0;
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

/** 第八十七轮:碎片散开了几成(封锁头 RING_YEARS 年从一道环散成整层壳;不在封锁里 = 1) */
export const RING_YEARS = 3;
export function debrisSpread(blocks: readonly { year: number; until: number }[], year: number): number {
  // 先慢后快(进度的平方):头一两年还看得出是一道环
  for (const b of blocks) if (year >= b.year && year < b.until) return Math.min(1, ((year - b.year) / RING_YEARS) ** 2);
  return 1;
}

/**
 * 第八十七轮:平时轨道上的卫星(地球仪上画;只读推演的发明年份和碎片封锁,不改推演)。四类:
 *   0 近地散布(人造卫星以后,60 年长到 SAT_MAX[0] 颗,倾角随意、离地 0.06–0.3 个半径)
 *   1 同步轨道(通信卫星以后,50 年长满;赤道上空 5.62 个半径,钉在经度上)
 *   2 导航星座(卫星导航以后,15 年长满;6 个轨道面 × 4 颗,倾角 55°,3.17 个半径)
 *   3 近地大星座(可回收火箭以后,40 年长满;三层壳 53° / 70° / 97.6°,每层 30 个轨道面)
 * 碎片封锁期间近地、中轨的都没了(同步轨道太高不受影响),解封以后 SAT_REGROW 年长回来
 */
export const SAT_MAX = [150, 80, 24, 900] as const;
const SAT_REGROW = 30;
export interface SatYears {
  sat?: number;
  comm?: number;
  nav?: number;
  mega?: number;
}
export function satCounts(y: SatYears, blocks: readonly { year: number; until: number }[], year: number): number[] {
  const ramp = (y0: number | undefined, span: number) => (y0 === undefined || year < y0 ? 0 : Math.min(1, (year - y0) / span));
  let low = 1;
  for (const b of blocks) {
    if (year >= b.year && year < b.until) low = 0;
    else if (year >= b.until && year < b.until + SAT_REGROW) low = Math.min(low, (year - b.until) / SAT_REGROW);
  }
  return [
    Math.round(SAT_MAX[0] * ramp(y.sat, 60) * low),
    Math.round(SAT_MAX[1] * ramp(y.comm, 50)),
    Math.round(SAT_MAX[2] * ramp(y.nav, 15) * low),
    Math.round(SAT_MAX[3] * ramp(y.mega, 40) * low),
  ];
}

/** 轨道面里的相位 u、倾角、升交点(弧度)→ 经纬度(度) */
function orbitLonLat(u: number, inc: number, node: number): { lon: number; lat: number } {
  const x = Math.cos(u), y = Math.sin(u) * Math.cos(inc), z = Math.sin(u) * Math.sin(inc);
  const lon = Math.atan2(y, x) + node;
  return { lon: ((lon * 180) / Math.PI + 540) % 360 - 180, lat: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI };
}

/** 第 kind 类第 i 颗卫星的轨道:倾角、升交点(弧度)、离地几个半径、初相、角速度(弧度 / 秒,动画时间)。同步轨道钉在经度上,不用这个 */
export interface SatOrbit {
  inc: number;
  node: number;
  h: number;
  u0: number;
  w: number;
}
export function satOrbit(kind: number, i: number): SatOrbit {
  const r = (k: number) => {
    const v = Math.sin(i * 91.3458 + kind * 17.17 + k * 47.853) * 24634.6345;
    return v - Math.floor(v);
  };
  const D = Math.PI / 180;
  const speed = (h: number) => 0.12 * Math.pow(1 + h, -1.5);
  if (kind === 1) return { inc: 0, node: 0, h: 5.62, u0: 0, w: 0 };
  if (kind === 2) {
    const plane = i % 6;
    const slot = Math.floor(i / 6) % 4;
    return { inc: 55 * D, node: plane * (Math.PI / 3), h: 3.17, u0: slot * (Math.PI / 2) + plane * 0.26, w: speed(3.17) };
  }
  if (kind === 3) {
    const shell = i % 3;
    const j = Math.floor(i / 3);
    const plane = j % 30;
    const slot = Math.floor(j / 30);
    const h = 0.085 + 0.004 * shell;
    return { inc: [53, 70, 97.6][shell] * D, node: plane * 0.2094 + shell * 0.07, h, u0: slot * 0.628 + plane * 0.21, w: speed(h) };
  }
  const h = 0.06 + 0.24 * Math.pow(r(3), 1.4);
  return { inc: Math.acos(1 - 2 * r(1)), node: r(2) * Math.PI * 2, h, u0: r(5) * Math.PI * 2, w: (0.9 + 0.2 * r(4)) * speed(h) };
}

/** 轨道上相位 u 处的点(画轨道线用) */
export function satPathPoint(o: SatOrbit, u: number): { lon: number; lat: number; h: number } {
  return { ...orbitLonLat(u, o.inc, o.node), h: o.h };
}

/** 第 kind 类的第 i 颗卫星在 t 秒(动画时间)时的位置;h = 离地几个半径 */
export function satPoint(kind: number, i: number, t: number): { lon: number; lat: number; h: number } {
  if (kind === 1) {
    const v = Math.sin(i * 91.3458 + 17.17 + 47.853) * 24634.6345;
    return { lon: ((i * 137.508 + 23) % 360) - 180, lat: 0.3 * (v - Math.floor(v) - 0.5), h: 5.62 };
  }
  const o = satOrbit(kind, i);
  return satPathPoint(o, o.u0 + o.w * t);
}

/** 第六十六轮:被碎片打断的太空电梯(锚点州)—— 断开到重建完成(解封 + 3 年)这段时间里不画 */
export function towerSevered(annals: readonly { kind: string; n?: number; year: number; region: number; oob?: number[] }[], region: number, year: number): boolean {
  for (const a of annals) if (a.kind === 'orbit' && a.n === 2 && a.region === region && year >= a.year && year < (a.oob?.[0] ?? a.year + 40) + 3) return true;
  return false;
}
