/**
 * 本地分支 modern-pace 第七十五轮:近现代瓜分无主地(用户"即使到了现代我们的统治范围也没包括沙漠和高山""国界是否应该会出现大直线")。
 * 只读推演结果,不改推演(推演里沙漠、高山、冰原没有民族,国家也就不领 —— 真划进推演会抬高州数、动荡、霸主门槛,还会让接着推对不上)。
 *
 * 规则:
 *   - 首都进了工业时代(Polity.modern[0],或从近现代国家分出来的 modernName)的国家,有资格认领;
 *   - 那一年无主的陆地州连成片(州之间有陆上共同边界),一片由挨着它、有资格的国家分;
 *   - 每国在这片地边上取一个"锚点"= 它贴着这片地的那些州的治所平均位置;每州(以及显示时每个像素)按加权距离
 *     d² − K × 国土州数 归最近的锚点(power diagram:大国分得多,分界照样是直线;三国交汇 = 几条直线相交);
 *   - 永久冰盖(地块年均温 < ICE_SHEET_T)离认领国锚点超过 ICE_REACH 的不分,留作"国际共管"(南极);近的照分(格陵兰);
 *   - 隔海的工业国也来抢(用户"当然允许了";非洲式的列强瓜分):有沿海州的每片地,不陆上相连的有资格的国家打分
 *     (用户"根据国力和航线密集度"):国土州数 × (1 + 2 × 它的海上航线从附近 LANE_R 以内经过的条数) ÷ (距离 + D0)²;
 *     有陆上邻国的地:最多再来 OVERSEAS_MAX 个,国力至少是陆上邻国里最大的一半、距离 ≤ OVERSEAS_FAR;
 *     海岛(没有陆上邻国):最多 ISLAND_MAX 个,分数 ≥ 最高分的 ISLAND_SHARE(大岛几国分,像婆罗洲、伊斯帕尼奥拉);
 *     隔海国家的锚点落在离它最近的沿海州,权重 × OVERSEAS_W;远处的冰岛按冰盖的规则留白;
 *   - 不属于任何州的小礁、海岸碎块(按地块):跟离它最近的州走(那州最后归谁就归谁);
 *   - 每 STEP 年按那时的格局算一次(条约划定以后几十年不变,不跟着每场小仗来回跳)。
 * 推演给了主的州永远按推演;认领只填推演里无主的。
 */
import type { Civ, Year } from '../types';
import type { World } from '../../world';
import { ownersAt } from '../engine/timeline';
import { ICE_SHEET_T } from '../../world';

export const CLAIM_STEP = 25;
const STEP = CLAIM_STEP;
/** 加权:每多一州,锚点"近"多少(世界单位²) */
const K_W = 50;
/** 冰盖离锚点多远以内才分(世界单位;1 单位 ≈ 19.5 km) */
const ICE_REACH = 55;
/** 海岛打分:航线从岛附近多远以内经过算数(世界单位,≈ 500 km);距离的平滑项 */
const LANE_R = 25;
const D0 = 20;
const OVERSEAS_MAX = 2;
const OVERSEAS_FAR = 500;
const ISLAND_MAX = 3;
const ISLAND_SHARE = 0.35;
const OVERSEAS_W = 0.6;

export interface ClaimAnchor {
  p: number;
  /** 权重 = K_W × 那时的国土州数 */
  w: number;
  /** 世界坐标(x 已展开到这片地的参考经度附近,不取模) */
  x: number;
  y: number;
}
export interface ClaimZone {
  regions: number[];
  anchors: ClaimAnchor[];
  /** 参考 x(这片地第一个州的治所 x);算距离时按世界宽度绕回到它附近 */
  x0: number;
}
export interface Claims {
  /** 这一份对应的年份档(STEP 年一档),作缓存键用 */
  bucket: number;
  /** 各州认领给了谁(-1 = 没认领 / 推演里本来就有主) */
  owner: Int16Array;
  zones: ClaimZone[];
  /** 各州在哪一片(-1 = 不在任何一片) */
  zoneOf: Int32Array;
  /** 不属于任何州的陆地地块(太小的岛)认领给了谁(按地块;-1 = 没有 / 本来就属于某州) */
  cellOwner: Int16Array;
}

const cache = new WeakMap<Civ, Map<number, Claims>>();

const eligible = (civ: Civ, p: number, y: Year): boolean => {
  const P = civ.polities[p];
  if (!P || P.founded > y || (P.ended !== undefined && P.ended <= y)) return false;
  return (P.modern?.[0] ?? Infinity) <= y || (P.modernName ?? Infinity) <= y;
};

/** year 那一档的认领 */
export function claimsAt(civ: Civ, world: World, year: Year): Claims {
  const bucket = Math.floor(year / STEP);
  worldOf.set(civ.regions, world);
  let m = cache.get(civ);
  if (!m) cache.set(civ, (m = new Map()));
  const hit = m.get(bucket);
  if (hit) return hit;
  const R = civ.regions;
  const n = R.count;
  const owner = new Int16Array(n).fill(-1);
  const zoneOf = new Int32Array(n).fill(-1);
  const zones: ClaimZone[] = [];
  const cellOwner = new Int16Array(world.mesh.n).fill(-1);
  const out: Claims = { bucket, owner, zones, zoneOf, cellOwner };
  const by = bucket * STEP;
  if (!civ.viable || by < 0) {
    m.set(bucket, out);
    return out;
  }
  const own = ownersAt(civ, Math.min(by, civ.endYear)).polity;
  const W = world.width;
  const sx = (r: number) => world.mesh.x[R.seat[r]];
  const sy = (r: number) => world.mesh.y[R.seat[r]];
  const near = (x: number, ref: number) => x + Math.round((ref - x) / W) * W;
  const isLand = (r: number) => R.seat[r] >= 0;
  const size = new Map<number, number>();
  for (let r = 0; r < n; r++) if (own[r] >= 0) size.set(own[r], (size.get(own[r]) ?? 0) + 1);
  /** 沿海的州:区内有地块挨着海洋 */
  const coastMemo = new Int8Array(n).fill(-1);
  const coastalRegion = (r: number): boolean => {
    if (coastMemo[r] >= 0) return coastMemo[r] === 1;
    let c = 0;
    const M = world.mesh;
    for (let q = R.cellStart[r]; q < R.cellStart[r + 1] && !c; q++) {
      const cell = R.cells[q];
      for (let k = M.adjStart[cell]; k < M.adjStart[cell + 1]; k++)
        if (world.water[M.adj[k]] === 1) {
          c = 1;
          break;
        }
    }
    coastMemo[r] = c;
    return c === 1;
  };
  /** 永久冰盖:州里地块的平均年均温 < ICE_SHEET_T */
  const icy = (r: number) => {
    let t = 0,
      k = 0;
    for (let q = R.cellStart[r]; q < R.cellStart[r + 1]; q++) {
      t += world.temperature[R.cells[q]];
      k++;
    }
    return k > 0 && t / k < ICE_SHEET_T;
  };
  // 有资格的国家的州(海岛找最近的认领国用)
  const ownedX: number[] = [],
    ownedY: number[] = [],
    ownedP: number[] = [];
  for (let r = 0; r < n; r++)
    if (own[r] >= 0 && isLand(r) && eligible(civ, own[r], by)) {
      ownedX.push(sx(r));
      ownedY.push(sy(r));
      ownedP.push(own[r]);
    }
  const lanes: { xs: number[]; ys: number[]; ps: number[] }[] = [];
  for (const rt of civ.routes) {
    if (rt.kind !== 'sea' || rt.built > by || (rt.abandoned !== undefined && rt.abandoned <= by) || rt.cells.length < 2) continue;
    const ends = [rt.cells[0], rt.cells[rt.cells.length - 1]].map((c) => (R.of[c] >= 0 ? own[R.of[c]] : -1)).filter((p) => p >= 0);
    if (!ends.length) continue;
    const xs: number[] = [],
      ys: number[] = [];
    for (let i = 0; i < rt.cells.length; i += 2) {
      xs.push(world.mesh.x[rt.cells[i]]);
      ys.push(world.mesh.y[rt.cells[i]]);
    }
    lanes.push({ xs, ys, ps: [...new Set(ends)] });
  }
  // 无主陆地州连成片(只走陆上相连的边)
  const seen = new Uint8Array(n);
  for (let r0 = 0; r0 < n; r0++) {
    if (seen[r0] || own[r0] >= 0 || !isLand(r0)) continue;
    const comp: number[] = [];
    const q = [r0];
    seen[r0] = 1;
    while (q.length) {
      const r = q.pop()!;
      comp.push(r);
      for (let k = R.adjStart[r]; k < R.adjStart[r + 1]; k++) {
        const j = R.adj[k];
        if (seen[j] || own[j] >= 0 || !isLand(j) || !(R.adjBorder[k] > 0)) continue;
        seen[j] = 1;
        q.push(j);
      }
    }
    // 挨着这片地、有资格的国家;各国的锚点 = 它贴着这片地的州的治所平均位置
    const x0 = sx(comp[0]);
    const acc = new Map<number, { x: number; y: number; k: number; ov?: boolean }>();
    for (const r of comp)
      for (let k = R.adjStart[r]; k < R.adjStart[r + 1]; k++) {
        const j = R.adj[k];
        const p = own[j];
        if (p < 0 || !(R.adjBorder[k] > 0) || !eligible(civ, p, by)) continue;
        const a = acc.get(p) ?? { x: 0, y: 0, k: 0 };
        a.x += near(sx(j), x0);
        a.y += sy(j);
        a.k++;
        acc.set(p, a);
      }
    // 隔海的工业国(和海岛的认领国):按国力 × 航线 ÷ 距离² 打分;锚点 = 这片地里离那国最近的沿海州
    const coastal = comp.filter(coastalRegion);
    if (coastal.length) {
      let cx = 0,
        cy = 0;
      for (const r of coastal) {
        cx += near(sx(r), x0);
        cy += sy(r);
      }
      cx /= coastal.length;
      cy /= coastal.length;
      const dmin = new Map<number, { d: number; i: number }>();
      for (let i = 0; i < ownedX.length; i++) {
        if (acc.has(ownedP[i])) continue;
        const dx = near(ownedX[i], cx) - cx,
          dy = ownedY[i] - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        const o = dmin.get(ownedP[i]);
        if (!o || d < o.d) dmin.set(ownedP[i], { d, i });
      }
      const lanesOf = new Map<number, number>();
      for (const L of lanes) {
        let hitL = false;
        for (let i = 0; i < L.xs.length && !hitL; i++) {
          const dx = near(L.xs[i], cx) - cx,
            dy = L.ys[i] - cy;
          if (dx * dx + dy * dy < LANE_R * LANE_R) hitL = true;
        }
        if (hitL) for (const p of L.ps) lanesOf.set(p, (lanesOf.get(p) ?? 0) + 1);
      }
      const cands = [...dmin]
        .map(([p, o]) => ({ p, o, sc: ((size.get(p) ?? 1) * (1 + 2 * (lanesOf.get(p) ?? 0))) / ((o.d + D0) * (o.d + D0)) }))
        .sort((a, b) => b.sc - a.sc || a.p - b.p);
      const landN = acc.size;
      let maxAdj = 0;
      for (const p of acc.keys()) maxAdj = Math.max(maxAdj, size.get(p) ?? 0);
      let taken = 0;
      for (const c of cands) {
        if (taken >= (landN ? OVERSEAS_MAX : ISLAND_MAX)) break;
        if (landN) {
          if ((size.get(c.p) ?? 0) < 0.5 * maxAdj || c.o.d > OVERSEAS_FAR) continue;
        } else if (c.sc < ISLAND_SHARE * cands[0].sc) break;
        let lr = -1,
          ld = Infinity;
        for (const r of coastal) {
          const dx = near(sx(r), ownedX[c.o.i]) - ownedX[c.o.i],
            dy = sy(r) - ownedY[c.o.i];
          const d = dx * dx + dy * dy;
          if (d < ld) {
            ld = d;
            lr = r;
          }
        }
        acc.set(c.p, { x: near(sx(lr), x0), y: sy(lr), k: 1, ov: true });
        taken++;
      }
    }
    if (!acc.size) continue;
    const anchors: ClaimAnchor[] = [...acc].sort((a, b) => a[0] - b[0]).map(([p, a]) => ({ p, w: K_W * (size.get(p) ?? 1) * (a.ov ? OVERSEAS_W : 1), x: a.x / a.k, y: a.y / a.k }));
    const zi = zones.length;
    zones.push({ regions: comp, anchors, x0 });
    for (const r of comp) {
      const x = sx(r),
        y = sy(r);
      const p = nearestAnchor(anchors, x, y, W);
      // 远处的冰盖不分(国际共管)
      if (icy(r)) {
        const a = anchors.find((q) => q.p === p)!;
        const dx = near(a.x, x) - x;
        if (dx * dx + (a.y - y) * (a.y - y) > ICE_REACH * ICE_REACH) continue;
      }
      zoneOf[r] = zi;
      owner[r] = p;
    }
  }
  // 不属于任何州的小礁、海岸碎块(陆地地块,和底图上细碎小岛落进的浅海地块;深海不管):跟离它最近的州走 —— 那州最后归谁(推演 / 认领)就归谁
  const finX: number[] = [],
    finY: number[] = [],
    finP: number[] = [];
  for (let r = 0; r < n; r++) {
    const p = own[r] >= 0 ? own[r] : owner[r];
    if (p < 0 || !isLand(r)) continue;
    finX.push(sx(r));
    finY.push(sy(r));
    finP.push(p);
  }
  if (finX.length)
    for (let c = 0; c < world.mesh.n; c++) {
      if (R.of[c] >= 0 || (world.water[c] !== 0 && !(world.water[c] === 1 && world.elevation[c] > -300))) continue;
      const cx = world.mesh.x[c],
        cy = world.mesh.y[c];
      let bi = -1,
        bd = Infinity;
      for (let i = 0; i < finX.length; i++) {
        const dx = near(finX[i], cx) - cx,
          dy = finY[i] - cy;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          bi = i;
        }
      }
      if (bi < 0 || (world.temperature[c] < ICE_SHEET_T && bd > ICE_REACH * ICE_REACH)) continue;
      // 推演里本来就有主的州旁边的海岸碎块:地图本来就借邻州上色,这里只管认领出来的和孤零零的
      cellOwner[c] = finP[bi];
    }
  m.set(bucket, out);
  return out;
}

/** (x, y) 按加权距离 d² − w 归最近的锚点;W = 世界宽度(给了就东西向各自按最近的一圈绕,不会有统一的接缝) */
export function nearestAnchor(anchors: readonly ClaimAnchor[], x: number, y: number, W = 0): number {
  let best = -1,
    bd = Infinity;
  for (const a of anchors) {
    let dx = a.x - x;
    if (W) dx -= Math.round(dx / W) * W;
    const d = dx * dx + (a.y - y) * (a.y - y) - a.w;
    if (d < bd) {
      bd = d;
      best = a.p;
    }
  }
  return best;
}

/** 推演的归属(out,会被改写)把无主的州按认领填上 */
export function applyClaims(civ: Civ, world: World, year: Year, polity: Int16Array): Claims {
  const c = claimsAt(civ, world, year);
  for (let r = 0; r < polity.length && r < c.owner.length; r++) if (polity[r] < 0 && c.owner[r] >= 0) polity[r] = c.owner[r];
  return c;
}

/** 显示用:国家层逐像素铺色时,认领出来的州按最近的锚点(直线分界)、没有州的小礁按地块的认领 */
export interface ClaimFill {
  claims: Claims;
  /** 这一年推演里无主、由认领填上的州 */
  filled: Uint8Array;
  worldW: number;
  /** 栅格:每世界单位几像素、宽、像素 → 地块、水 */
  scale: number;
  rasterW: number;
  cell: Int32Array;
  water: Uint8Array;
}

/** 推演归属里无主的州按认领填上;返回铺色用的 ClaimFill(polity 会被改写) */
export function claimFill(civ: Civ, world: World, year: Year, polity: Int16Array, raster: { scale: number; w: number; cell: Int32Array; water: Uint8Array }): ClaimFill {
  const claims = claimsAt(civ, world, year);
  const filled = new Uint8Array(polity.length);
  for (let r = 0; r < polity.length && r < claims.owner.length; r++)
    if (polity[r] < 0 && claims.owner[r] >= 0) {
      polity[r] = claims.owner[r];
      filled[r] = 1;
    }
  return { claims, filled, worldW: world.width, scale: raster.scale, rasterW: raster.w, cell: raster.cell, water: raster.water };
}

/** 像素 k(全分辨率栅格下标)、它的州 r:认领给了谁;不改 = −9 */
export function claimPixel(f: ClaimFill, k: number, r: number): number {
  const c = f.claims;
  if (r >= 0) {
    if (!f.filled[r]) return -9;
    const z = c.zoneOf[r];
    if (z < 0) return -9;
    const zone = c.zones[z];
    if (zone.anchors.length < 2) return -9;
    const wx = ((k % f.rasterW) + 0.5) / f.scale;
    const wy = (((k / f.rasterW) | 0) + 0.5) / f.scale;
    return nearestAnchor(zone.anchors, wx, wy, f.worldW);
  }
  if (f.water[k]) return -9;
  const cell = f.cell[k];
  if (cell < 0) return -9;
  const p = c.cellOwner[cell];
  return p >= 0 ? p : -9;
}

/** 世界坐标那一点在哪个州、是不是认领出来的那一片 z 里(陆地) */
function inZone(f: ClaimFill, regionOf: Int32Array, x: number, y: number, z: number): boolean {
  const W = f.worldW;
  const rh = f.water.length / f.rasterW;
  const ix = Math.floor(((((x % W) + W) % W) * f.scale)) % f.rasterW;
  const iy = Math.floor(y * f.scale);
  if (iy < 0 || iy >= rh) return false;
  const k = iy * f.rasterW + ix;
  if (f.water[k]) return false;
  const cell = f.cell[k];
  const r = cell >= 0 ? regionOf[cell] : -1;
  return r >= 0 && f.filled[r] === 1 && f.claims.zoneOf[r] === z;
}

/** 一条界线有多少点落在认领地 z 里(0–1) */
export function shareInZone(f: ClaimFill, regionOf: Int32Array, pts: Float32Array, z: number): number {
  let n = 0;
  for (let i = 0; i < pts.length; i += 2) if (inZone(f, regionOf, pts[i], pts[i + 1], z)) n++;
  return pts.length ? n / (pts.length / 2) : 0;
}

/**
 * 认领地里两两认领国之间的直线国界:沿两国的分界直线取样,留下"落在这片认领地里、且这两国正是最近的两个"的那几段。
 * left / right 照 SidedLine 的约定(沿线方向左手边 = left)
 */
export function claimBorderLines(f: ClaimFill, regionOf: Int32Array, sx: (r: number) => number, sy: (r: number) => number): { pts: Float32Array; left: number; right: number; zone: number }[] {
  const out: { pts: Float32Array; left: number; right: number; zone: number }[] = [];
  const W = f.worldW;
  f.claims.zones.forEach((zone, z) => {
    const an = zone.anchors;
    if (an.length < 2) return;
    /** 这片地的范围(治所展开到 ref 附近,外扩 40) */
    const box = (ref: number) => {
      let x0 = Infinity,
        x1 = -Infinity,
        y0 = Infinity,
        y1 = -Infinity;
      for (const r of zone.regions) {
        const x = sx(r) + Math.round((ref - sx(r)) / W) * W,
          y = sy(r);
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      return [x0 - 40, x1 + 40, y0 - 40, y1 + 40];
    };
    const pw = (a: ClaimAnchor, x: number, y: number) => {
      let dx = a.x - x;
      dx -= Math.round(dx / W) * W;
      return dx * dx + (a.y - y) * (a.y - y) - a.w;
    };
    for (let i = 0; i < an.length; i++)
      for (let j = i + 1; j < an.length; j++) {
        const A = an[i],
          B0 = an[j];
        // B 挪到离 A 最近的那一圈(两锚点之间按最短的东西向距离)
        const B = { ...B0, x: B0.x - Math.round((B0.x - A.x) / W) * W };
        const [x0, x1, y0, y1] = box((A.x + B.x) / 2);
        const nx = B.x - A.x,
          ny = B.y - A.y;
        const nn = nx * nx + ny * ny;
        if (!(nn > 0)) continue;
        const cc = (B.x * B.x + B.y * B.y - A.x * A.x - A.y * A.y - B.w + A.w) / 2;
        const px = (nx * cc) / nn,
          py = (ny * cc) / nn;
        const len = Math.sqrt(nn);
        const dx = -ny / len,
          dy = nx / len;
        // 直线和范围框相交的参数区间
        let t0 = -Infinity,
          t1 = Infinity;
        for (const [p, d, lo, hi] of [
          [px, dx, x0, x1],
          [py, dy, y0, y1],
        ] as const) {
          if (Math.abs(d) < 1e-9) {
            if (p < lo || p > hi) t0 = Infinity;
            continue;
          }
          const a = (lo - p) / d,
            b = (hi - p) / d;
          t0 = Math.max(t0, Math.min(a, b));
          t1 = Math.min(t1, Math.max(a, b));
        }
        if (!(t1 > t0)) continue;
        let run: [number, number] | null = null;
        const flush = () => {
          if (run && run[1] - run[0] >= 1.5) {
            const ax = px + dx * run[0],
              ay = py + dy * run[0],
              bx = px + dx * run[1],
              by = py + dy * run[1];
            // 沿线方向的左手边:叉积 d × (A − 起点) > 0 的那一侧是 A
            const cr = (bx - ax) * (A.y - ay) - (by - ay) * (A.x - ax);
            out.push({ pts: new Float32Array([ax, ay, bx, by]), left: cr > 0 ? A.p : B.p, right: cr > 0 ? B.p : A.p, zone: z });
          }
          run = null;
        };
        for (let t = t0; t <= t1; t += 0.75) {
          const x = px + dx * t,
            y = py + dy * t;
          const pa = pw(A, x, y);
          let ok = inZone(f, regionOf, x, y, z);
          if (ok) for (const C of an) if (C !== A && C !== B0 && pw(C, x, y) < pa - 1e-6) ok = false;
          if (ok) {
            if (run) run[1] = t;
            else run = [t, t];
          } else flush();
        }
        flush();
      }
  });
  return out;
}

// ---- 交互、国名、高亮这些"自己查这里归谁"的地方用(和地图画的一致)----

/** 认领算过的那份世界(高亮之类拿不到 world 的地方用;画地图时 claimsAt 会登记) */
const worldOf = new WeakMap<Civ['regions'], World>();
/** 登记这个文明(按州的划分;改了名的副本共用)对应的世界 */
export function rememberWorld(civ: Civ, world: World): void {
  worldOf.set(civ.regions, world);
}
/** 登记过的世界(编年史这些拿不到 world 的地方用;没登记 = undefined) */
export function knownWorld(civ: Civ): World | undefined {
  return worldOf.get(civ.regions);
}

/** 州一级:推演里无主的州按认领填上(拿不到 world 的不填);返回认领的年份档(没填 = −1) */
export function applyKnownClaims(civ: Civ, year: Year, polity: Int16Array): number {
  const w = worldOf.get(civ.regions);
  if (!w || !civ.viable) return -1;
  const c = claimsAt(civ, w, year);
  for (let r = 0; r < polity.length && r < c.owner.length; r++) if (polity[r] < 0 && c.owner[r] >= 0) polity[r] = c.owner[r];
  return c.bucket;
}

/** 像素 k(全分辨率栅格下标)这一年归哪国:推演有主按推演;认领地按直线(最近的锚点);不属于任何州的小礁按地块;−1 = 无主 / 水 */
export function polityAtPixel(civ: Civ, world: World, raster: { scale: number; w: number; cell: Int32Array; water: Uint8Array }, year: Year, k: number, sim?: ArrayLike<number>): number {
  if (k < 0 || k >= raster.water.length || raster.water[k]) return -1;
  const cell = raster.cell[k];
  if (cell < 0) return -1;
  const r = civ.regions.of[cell];
  const own = sim ?? ownersAt(civ, Math.min(year, civ.endYear)).polity;
  if (r >= 0 && own[r] >= 0) return own[r];
  if (!civ.viable) return -1;
  const c = claimsAt(civ, world, year);
  if (r < 0) return c.cellOwner[cell];
  if (c.owner[r] < 0) return -1;
  const z = c.zoneOf[r];
  const zone = z >= 0 ? c.zones[z] : null;
  if (!zone || zone.anchors.length < 2) return c.owner[r];
  return nearestAnchor(zone.anchors, ((k % raster.w) + 0.5) / raster.scale, (((k / raster.w) | 0) + 0.5) / raster.scale, world.width);
}

/** 世界坐标 (wx, wy) 这一年归哪国(同 polityAtPixel) */
export function polityAtWorld(civ: Civ, world: World, raster: { scale: number; w: number; cell: Int32Array; water: Uint8Array }, year: Year, wx: number, wy: number): number {
  const H = raster.water.length / raster.w;
  const ix = Math.floor(((((wx % world.width) + world.width) % world.width) * raster.scale)) % raster.w;
  const iy = Math.floor(wy * raster.scale);
  if (iy < 0 || iy >= H) return -1;
  return polityAtPixel(civ, world, raster, year, iy * raster.w + ix);
}
