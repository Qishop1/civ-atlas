/**
 * 本地分支 modern-pace 第五十五轮:道路细化 + 城里的街道。纯计算,不碰 DOM。
 *
 * 推演里的路是一串地块中心(每段几十公里),画出来是长直线。这里按主图栅格把它细化成跟着地形走的路:
 *   refineRoad   每段取中点,在垂直方向试几个偏移,挑"爬坡少 + 不下水 + 不绕太远"的那个(加一点按位置定的扰动),
 *                再对两半递归,直到一段不到半个栅格像素。端点(城、岔口)不动。结果只由地形决定,同一条路每次一样
 *   cityStreets  从城心和进城的路出发长出街道:每条街一步步往前(方向慢慢偏),隔几步往两侧分出支街;
 *                走出城区(密度不够)、碰到水、撞上已有的街就停(撞上就连过去);条数按人口封顶
 * 坐标一律是世界坐标(x 可以展开到图外,取地形时按世界宽绕回)。
 */
import type { Raster } from '../../gen/raster';

export type Pt = [number, number];

const hash2 = (x: number, y: number, s: number) => {
  let h = (Math.imul(Math.floor(x * 97) | 0, 0x27d4eb2d) ^ Math.imul(Math.floor(y * 89) | 0, 0x165667b1) ^ s) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** 栅格上的海拔(双线性)、是不是水;x 绕回 */
export function terrainOf(raster: Raster, worldW: number) {
  const W = raster.w, H = raster.h, s = raster.scale;
  const elev = (x: number, y: number) => {
    let fx = ((((x % worldW) + worldW) % worldW) * s) - 0.5;
    const fy = Math.min(H - 1, Math.max(0, y * s - 0.5));
    if (fx < 0) fx += W;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
    const x1 = (x0 + 1) % W, y1 = Math.min(H - 1, y0 + 1);
    const e = raster.elev;
    return (e[y0 * W + x0] * (1 - dx) + e[y0 * W + x1] * dx) * (1 - dy) + (e[y1 * W + x0] * (1 - dx) + e[y1 * W + x1] * dx) * dy;
  };
  const water = (x: number, y: number) => {
    const ix = Math.floor(((((x % worldW) + worldW) % worldW) * s)) % W;
    const iy = Math.min(H - 1, Math.max(0, Math.floor(y * s)));
    return raster.water[iy * W + ix] !== 0;
  };
  return { elev, water, px: 1 / s };
}

/** 一条路(展开的世界坐标,[x0, y0, x1, y1, …])细化成跟着地形走的折线 */
export function refineRoad(pts: ArrayLike<number>, T: ReturnType<typeof terrainOf>, seed = 0): Float32Array {
  const out: number[] = [pts[0], pts[1]];
  const minLen = T.px * 0.5;
  // 一段的代价:爬坡(米 / 世界单位,放大)+ 长度 + 中间下水的重罚
  const cost = (ax: number, ay: number, bx: number, by: number) => {
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    const climb = Math.abs(T.elev(bx, by) - T.elev(ax, ay));
    const wet = T.water((ax + bx) / 2, (ay + by) / 2) ? 1e6 : 0;
    return L * 1 + (climb / 600) * T.px * 2 + wet;
  };
  const rec = (ax: number, ay: number, bx: number, by: number, depth: number) => {
    const L = Math.hypot(bx - ax, by - ay);
    if (L < minLen || depth > 9) {
      out.push(bx, by);
      return;
    }
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    const nx = -(by - ay) / (L || 1), ny = (bx - ax) / (L || 1);
    let best = 0, bc = Infinity;
    for (const t of [-0.28, -0.14, 0, 0.14, 0.28]) {
      const px = mx + nx * L * t, py = my + ny * L * t;
      // 一点扰动(按位置定):路不会每处都死板地取最优
      const c = cost(ax, ay, px, py) + cost(px, py, bx, by) + L * 0.12 * hash2(px, py, seed + depth);
      if (c < bc) {
        bc = c;
        best = t;
      }
    }
    const px = mx + nx * L * best, py = my + ny * L * best;
    rec(ax, ay, px, py, depth + 1);
    rec(px, py, bx, by, depth + 1);
  };
  for (let i = 1; i < pts.length / 2; i++) rec(pts[(i - 1) * 2], pts[(i - 1) * 2 + 1], pts[i * 2], pts[i * 2 + 1], 0);
  return Float32Array.from(out);
}

/**
 * 一座城的街道(折线,世界坐标)。
 *   c       城心;dirs 进城的路的方向(弧度;没有 = 按城定一个)
 *   urban   这一点的城区密度 0–1(< 0.15 = 城外)
 *   step    一步多长(世界单位);maxSeg 最多几段
 */
export function cityStreets(c: Pt, dirs: readonly number[], urban: (x: number, y: number) => number, T: ReturnType<typeof terrainOf>, step: number, maxSeg: number, seed: number, radius = Infinity): Float32Array[] {
  const streets: Float32Array[] = [];
  // 已有街道的点(按格子查最近的)
  const cellSz = step * 0.9;
  const grid = new Map<string, Pt[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / cellSz)},${Math.floor(y / cellSz)}`;
  const addPt = (p: Pt) => {
    const k = keyOf(p[0], p[1]);
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  };
  const near = (x: number, y: number, r: number, skip: Pt | null): Pt | null => {
    const gx = Math.floor(x / cellSz), gy = Math.floor(y / cellSz);
    let best: Pt | null = null, bd = r;
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++)
        for (const p of grid.get(`${gx + a},${gy + b}`) ?? []) {
          if (p === skip) continue;
          const d = Math.hypot(p[0] - x, p[1] - y);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
    return best;
  };
  type Agent = { x: number; y: number; a: number; major: boolean; left: number };
  const queue: Agent[] = [];
  const base = dirs.length ? dirs : [hash2(c[0], c[1], seed) * Math.PI * 2];
  const majorLeft = Math.max(4, Math.min(12, Math.round(radius / (step * 1.2))));
  for (const d of base) queue.push({ x: c[0], y: c[1], a: d, major: true, left: majorLeft });
  // 主街的反方向也长一条(路穿城而过)
  for (const d of base.slice(0, 2)) queue.push({ x: c[0], y: c[1], a: d + Math.PI, major: true, left: majorLeft });
  let segs = 0;
  let qi = 0;
  while (qi < queue.length && segs < maxSeg) {
    const ag = queue[qi++];
    const line: number[] = [ag.x, ag.y];
    let last: Pt = [ag.x, ag.y];
    addPt(last);
    let x = ag.x, y = ag.y, a = ag.a;
    for (let k = 0; k < ag.left && segs < maxSeg; k++) {
      // 方向慢慢偏(主街偏得少)
      a += (hash2(x, y, seed + 7) - 0.5) * (ag.major ? 0.18 : 0.3);
      const L = step * (ag.major ? 1.2 : 0.9) * (0.85 + 0.3 * hash2(x, y, seed + 11));
      const nx = x + Math.cos(a) * L, ny = y + Math.sin(a) * L;
      const u = urban(nx, ny);
      // 只在城里:离城心不超过城的半径、城区够密(相对密度 ≥ 0.45)
      if (u < 0.45 || T.water(nx, ny) || Math.hypot(nx - c[0], ny - c[1]) > radius) break;
      // 撞上已有的街:连过去,停
      const hit = k > 0 ? near(nx, ny, step * 0.55, last) : null;
      if (hit) {
        line.push(hit[0], hit[1]);
        segs++;
        break;
      }
      line.push(nx, ny);
      segs++;
      x = nx;
      y = ny;
      last = [x, y];
      addPt(last);
      // 隔几步往两侧分出支街(城心密,城郊稀)
      if (k % 2 === 1 && hash2(x, y, seed + 13) < 0.35 + 0.5 * u) {
        const side = hash2(x, y, seed + 17) < 0.5 ? 1 : -1;
        queue.push({ x, y, a: a + side * (Math.PI / 2) + (hash2(x, y, seed + 19) - 0.5) * 0.3, major: false, left: Math.round(4 + 10 * u) });
        if (hash2(x, y, seed + 23) < 0.4 * u) queue.push({ x, y, a: a - side * (Math.PI / 2), major: false, left: Math.round(3 + 8 * u) });
      }
    }
    if (line.length >= 4) streets.push(Float32Array.from(line));
  }
  return streets;
}
