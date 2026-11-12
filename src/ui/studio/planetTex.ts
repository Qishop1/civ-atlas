/**
 * 本地分支 modern-pace:行星、卫星的贴图(新建第一步示意图放大进"行星系统 / 行星表面"用)和画带贴图的球。
 *
 * 高清贴图都在后台线程算(planetTex.worker.ts,算法见 planetTexGen.ts):示意图一出来就把每颗都排上(prefetchSystem),
 * 正在看的那颗插到最前面;算好以前用一份当场算的小图顶着(条带 256 宽、环形山 128 宽)。
 *   岩质 / 超级地球(有大气)  世界生成器,1024 宽(选它当母星以后的地图就是这颗;默认那颗按当前世界参数长,和地图一模一样)
 *   岩质(没大气)/ 矮行星      环形山,512 宽
 *   气态 / 冰巨星 / 迷你海王星 条带,1024 宽
 *   卫星                        环形山,256 宽(按序号配色)
 */
import type { Planet } from '../../gen/system';
import type { WorldParams } from '../../gen/params';
import { airless, planetWorldParams } from '../../gen/planetWorld';
import { ringProfile, rockColor, type AirlessType, type RGB, type RingProfile, type Tex, type TexJob } from './planetTexGen';

export type { Tex } from './planetTexGen';
type V3 = [number, number, number];

// ---------------------------------------------------------------- 后台线程、队列、缓存

const ready = new Map<string, Tex>();
const waiting = new Map<string, TexJob>();
/** 排队的先后(数组头先算);正在算的那件 */
let order: string[] = [];
let running: string | null = null;
let worker: Worker | null = null;

function pump() {
  if (running || !order.length) return;
  const id = order.shift()!;
  const job = waiting.get(id);
  if (!job) return pump();
  running = id;
  try {
    worker ??= new Worker(new URL('./planetTex.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: string; px?: Uint8ClampedArray; glow?: Uint8ClampedArray; w?: number; h?: number; error?: string }>) => {
      const m = e.data;
      if (m.px && m.w && m.h) ready.set(m.id, { px: m.px, w: m.w, h: m.h, ...(m.glow ? { glow: m.glow } : {}) });
      waiting.delete(m.id);
      running = null;
      pump();
    };
    worker.postMessage({ id, job });
  } catch {
    running = null;
  }
}

/** 要一张高清的:有了就给,没有就排上(urgent = 插到最前面) */
function want(id: string, job: TexJob, urgent: boolean): Tex | null {
  const hit = ready.get(id);
  if (hit) return hit;
  if (!waiting.has(id)) {
    if (ready.size > 60) ready.clear();
    waiting.set(id, job);
    order.push(id);
  }
  if (urgent && id !== running) order = [id, ...order.filter((x) => x !== id)];
  pump();
  return null;
}

const lowCache = new Map<string, Tex>();
function low(id: string, f: () => Tex): Tex {
  let t = lowCache.get(id);
  if (!t) {
    if (lowCache.size > 60) lowCache.clear();
    lowCache.set(id, (t = f()));
  }
  return t;
}

/** 高清图算好以前顶着的:一块纯色(在主线程上当场算小图最慢要 0.1 秒多,一颗行星加几颗卫星就卡;高清图几秒内就到) */
function flatTex(c: RGB): Tex {
  const px = new Uint8ClampedArray(8 * 4 * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = 255;
  }
  return { px, w: 8, h: 4 };
}

/** 这颗的贴图任务:默认那颗母星(key 0)按当前世界参数长 */
function jobOf(seed: number, p: Planet, homeParams: WorldParams | null): { id: string; job: TexJob; lowJob: () => Tex } {
  const s = (seed * 31 + p.key * 7919) >>> 0;
  if (p.kind === 'gas' || p.kind === 'ice' || p.kind === 'mini') {
    const [str, storm, haze] = p.kind === 'gas' ? [0.22, true, 0] : p.kind === 'ice' ? [0.06, false, 0.15] : [0.05, false, 0.3];
    return { id: `b:${s}:${p.color}:${p.teq}`, job: { kind: 'band', seed: s, color: p.color, strength: str, storm, haze, w: 1024, teq: p.teq }, lowJob: () => flatTex(p.color) };
  }
  const col = rockColor(s, p.color);
  if (p.kind === 'home' && homeParams) return { id: `w:home:${JSON.stringify(homeParams)}`, job: { kind: 'world', params: homeParams, habitable: true, color: [120, 150, 190], w: 1024 }, lowJob: () => flatTex(p.color) };
  if (airless(p)) {
    const type = airlessTypeOf(s, p.kind, p.teq);
    return { id: `a:${s}:${type}:${col}`, job: { kind: 'airless', seed: s, type, color: col, size: 512, teq: p.teq }, lowJob: () => flatTex(p.color) };
  }
  const params = planetWorldParams(seed, p);
  return { id: `w:${params.seed}:${params.temperature}:${p.habitable ? 1 : 0}:${col}`, job: { kind: 'world', params, habitable: p.habitable, color: col, w: 1024 }, lowJob: () => flatTex(p.color) };
}

/** 一颗行星的贴图;hd = 是不是高清的(不是 = 小图顶着,高清的在后台算) */
export function planetTexture(seed: number, p: Planet, homeParams: WorldParams | null, urgent = true): { tex: Tex; hd: boolean } {
  const j = jobOf(seed, p, homeParams);
  const hi = want(j.id, j.job, urgent);
  return hi ? { tex: hi, hd: true } : { tex: low(j.id, j.lowJob), hd: false };
}

/** 示意图一出来:把每颗(连同大卫星)都排上 */
export function prefetchSystem(seed: number, planets: readonly Planet[], homeParams: WorldParams | null) {
  for (const p of planets) {
    const j = jobOf(seed, p, homeParams);
    want(j.id, j.job, false);
    p.major.forEach((m, idx) => moonTexture(seed, p, m, idx, false));
  }
}

function hash01(s: number): number {
  let n = Math.imul(s ^ 0x9e3779b9, 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

/**
 * 没大气的行星 / 矮行星挑哪种地表(按平衡温度,种子再抽):
 *   很热(> 600°C)多半是熔岩世界;250–600°C 有时是;冷(< −100°C)的矮行星多半是冰原 + 暗斑或冰壳,小岩质的有时是冰壳;
 *   其余老坑地居多,三成多有月海
 */
export function airlessTypeOf(s: number, kind: string, teq: number): AirlessType {
  const r = hash01(s ^ 0x1234567);
  if (teq > 600) return r < 0.7 ? 'lava' : 'old';
  if (teq > 250) return r < 0.25 ? 'lava' : 'old';
  if (teq < -100) {
    if (kind === 'dwarf') return r < 0.5 ? 'plains' : r < 0.75 ? 'ice' : 'old';
    return r < 0.4 ? 'ice' : r < 0.8 ? 'old' : 'mare';
  }
  return r < 0.35 ? 'mare' : 'old';
}

/**
 * 卫星的地表:看母行星(巨行星还是岩质)、冷热、第几颗、多大 ——
 *   冷的巨行星:最里那颗四成是火山卫星(潮汐加热);最大的那颗(半径 > 1500 km)三成有雾霭大气;其余冰壳 55%、老坑地 45%
 *   暖的巨行星 / 岩质行星:老坑地、有月海的;很热的:有时熔岩
 */
export function moonTypeOf(s: number, parent: Planet, idx: number, radius: number, biggest: boolean): AirlessType {
  const r = hash01(s ^ 0x7654321);
  const giant = parent.kind === 'gas' || parent.kind === 'ice' || parent.kind === 'mini';
  if (parent.teq > 600) return r < 0.5 ? 'lava' : 'old';
  if (giant && parent.teq < -100) {
    if (idx === 0 && r < 0.4) return 'volcanic';
    if (biggest && radius > 1500 && r < 0.3) return 'haze';
    return hash01(s ^ 0x55aa) < 0.55 ? 'ice' : 'old';
  }
  return r < 0.4 ? 'mare' : 'old';
}

const MOON_TINTS: RGB[] = [
  [205, 200, 195],
  [180, 165, 150],
  [150, 145, 140],
  [200, 185, 165],
  [120, 115, 110],
];
/** 这颗卫星的地表类型(贴图、数据卡同一个) */
export function moonKind(seed: number, parent: Planet, m: { key: number; radius: number }, idx: number): AirlessType {
  const s = (seed * 131 + m.key * 977) >>> 0;
  const biggest = parent.major.length > 0 && m.radius >= Math.max(...parent.major.map((q) => q.radius));
  return moonTypeOf(s, parent, idx, m.radius, biggest);
}

export function moonTexture(seed: number, parent: Planet, m: { key: number; radius: number }, idx: number, urgent = true): Tex {
  // 第四十九轮:母星的月球 = 推演里登月的那颗(gen/moon.ts 原样,种子 = 文明种子;没另设文明种子时就是地图种子)
  if (parent.kind === 'home') {
    const id = `luna:${seed}`;
    return want(id, { kind: 'luna', seed, size: 1024 }, urgent) ?? low(id, () => flatTex([170, 170, 170]));
  }
  const s = (seed * 131 + m.key * 977) >>> 0;
  const type = moonKind(seed, parent, m, idx);
  const color = rockColor(s, MOON_TINTS[idx % MOON_TINTS.length]);
  const id = `m:${s}:${type}:${color}`;
  return want(id, { kind: 'airless', seed: s, type, color, size: 1024, teq: parent.teq }, urgent) ?? low(id, () => flatTex(color));
}

// ---------------------------------------------------------------- 画球

const work = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * 正射投影画一个带贴图的球:toBody = 屏上法线(右、上、朝外)→ 星体坐标(取经纬度);sun = 屏上的光照方向;
 * 贴图双线性取样;大球按最多 560 像素算一份再拉上去
 */
export function drawTexSphere(g: CanvasRenderingContext2D, cx: number, cy: number, R: number, tex: Tex, toBody: (n: V3) => V3, sun: V3, ambient = 0.06) {
  if (R < 1.5 || !work) {
    g.fillStyle = 'rgb(160,160,160)';
    g.beginPath();
    g.arc(cx, cy, Math.max(1.2, R), 0, Math.PI * 2);
    g.fill();
    return;
  }
  const size = Math.min(560, Math.ceil(R * 2));
  work.width = size;
  work.height = size;
  const wg = work.getContext('2d')!;
  const img = wg.createImageData(size, size);
  const d = img.data;
  const half = size / 2;
  const TW = tex.w, TH = tex.h, P = tex.px, GL = tex.glow;
  for (let py = 0; py < size; py++) {
    const y = (half - py - 0.5) / half;
    for (let px = 0; px < size; px++) {
      const x = (px + 0.5 - half) / half;
      const q = x * x + y * y;
      if (q > 1) continue;
      const z = Math.sqrt(1 - q);
      const lit = Math.max(0, x * sun[0] + y * sun[1] + z * sun[2]);
      const k = ambient + (1 - ambient) * Math.min(1, lit * 1.1);
      const B = toBody([x, y, z]);
      // 双线性:经度绕圈,纬度夹住
      const fu = ((Math.atan2(B[1], B[0]) / Math.PI + 1) / 2) * TW - 0.5;
      const fv = Math.min(TH - 1, Math.max(0, (0.5 - Math.asin(Math.max(-1, Math.min(1, B[2]))) / Math.PI) * TH - 0.5));
      const u0 = Math.floor(fu), v0 = Math.floor(fv);
      const du = fu - u0, dv = fv - v0;
      const ua = ((u0 % TW) + TW) % TW, ub = (ua + 1) % TW, vb = Math.min(TH - 1, v0 + 1);
      const i00 = (v0 * TW + ua) * 4, i10 = (v0 * TW + ub) * 4, i01 = (vb * TW + ua) * 4, i11 = (vb * TW + ub) * 4;
      const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
      const di = (py * size + px) * 4;
      d[di] = (P[i00] * w00 + P[i10] * w10 + P[i01] * w01 + P[i11] * w11) * k;
      d[di + 1] = (P[i00 + 1] * w00 + P[i10 + 1] * w10 + P[i01 + 1] * w01 + P[i11 + 1] * w11) * k;
      d[di + 2] = (P[i00 + 2] * w00 + P[i10 + 2] * w10 + P[i01 + 2] * w01 + P[i11 + 2] * w11) * k;
      if (GL) {
        const gv = ((GL[i00 >> 2] * w00 + GL[i10 >> 2] * w10 + GL[i01 >> 2] * w01 + GL[i11 >> 2] * w11) / 255) * (1 - 0.6 * k);
        if (gv > 0.004) {
          d[di] += 255 * gv;
          d[di + 1] += 120 * gv;
          d[di + 2] += 45 * gv;
        }
      }
      d[di + 3] = q > 0.985 ? 255 * Math.max(0, (1 - q) / 0.015) : 255;
    }
  }
  wg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(work, cx - R, cy - R, R * 2, R * 2);
}

// ---------------------------------------------------------------- 画环

const ringCache = new Map<string, RingProfile>();
/** 这颗的环(按种子、种类,缓存) */
export function ringOf(seed: number, p: Planet): RingProfile {
  const id = `${seed}:${p.key}:${p.kind}:${p.color}`;
  let r = ringCache.get(id);
  if (!r) {
    if (ringCache.size > 40) ringCache.clear();
    ringCache.set(id, (r = ringProfile((seed * 131 + p.key * 7919) >>> 0, p.kind, p.color)));
  }
  return r;
}

const ringWork = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/**
 * 逐像素画环(行星画完以后叠上去):环面 = 行星坐标的 z = 0 平面;rv / uv / vv = 屏幕右、上、朝观者在行星坐标里的方向;
 * Rpx = 行星半径的像素数;sunE = 太阳方向(行星坐标)。
 *   被行星挡住的(在行星圆盘里、又在行星后面)不画;行星的影子落在环上的变暗;
 *   太阳和观者在环面同一侧 = 迎光(亮),另一侧 = 透光(只有稀薄的地方微微发亮);
 *   斜着看光程变长更不透明;远看时一个像素盖住的那段半径取平均,细环不闪
 */
export function drawRing(g: CanvasRenderingContext2D, cx: number, cy: number, Rpx: number, prof: RingProfile, rv: V3, uv: V3, vv: V3, sunE: V3, vw: number, vh: number) {
  if (!ringWork || Math.abs(vv[2]) < 1e-3) return;
  const ext = prof.outer * Rpx;
  const x0 = Math.max(0, Math.floor(cx - ext)), x1 = Math.min(vw, Math.ceil(cx + ext));
  const y0 = Math.max(0, Math.floor(cy - ext)), y1 = Math.min(vh, Math.ceil(cy + ext));
  if (x1 <= x0 || y1 <= y0) return;
  const step = (x1 - x0) * (y1 - y0) > 900000 ? 2 : 1;
  const bw = Math.ceil((x1 - x0) / step), bh = Math.ceil((y1 - y0) / step);
  ringWork.width = bw;
  ringWork.height = bh;
  const wg = ringWork.getContext('2d')!;
  const img = wg.createImageData(bw, bh);
  const d = img.data;
  const N = prof.op.length, span = prof.outer - prof.inner;
  const vz = vv[2], az = Math.abs(vz);
  const same = Math.sign(sunE[2]) === Math.sign(vz);
  const sunUp = Math.abs(sunE[2]);
  // 一个像素在环面上盖住多宽(半径方向,按格数),至少一格
  const foot = Math.max(1, ((step / Rpx) * N) / span / Math.max(0.15, az));
  const pathK = Math.min(6, 1 / Math.max(az, 0.02));
  for (let j = 0; j < bh; j++) {
    const Y = -((y0 + (j + 0.5) * step) - cy) / Rpx;
    for (let i = 0; i < bw; i++) {
      const X = (x0 + (i + 0.5) * step - cx) / Rpx;
      const t = -(X * rv[2] + Y * uv[2]) / vz;
      const Px = X * rv[0] + Y * uv[0] + t * vv[0];
      const Py = X * rv[1] + Y * uv[1] + t * vv[1];
      const rr = Math.hypot(Px, Py);
      if (rr < prof.inner || rr >= prof.outer) continue;
      if (X * X + Y * Y < 1 && t < 0) continue;
      const f = ((rr - prof.inner) / span) * N;
      const i0 = Math.max(0, Math.floor(f - foot / 2)), i1 = Math.min(N, Math.max(i0 + 1, Math.ceil(f + foot / 2)));
      const op = (prof.sum[i1] - prof.sum[i0]) / (i1 - i0);
      if (op < 0.004) continue;
      const alpha = 1 - Math.pow(1 - Math.min(0.99, op), pathK);
      // 行星的影子:从这一点朝太阳走,碰到行星就在影子里
      const b = Px * sunE[0] + Py * sunE[1];
      const shadow = b < 0 && rr * rr - b * b < 1;
      let L = same ? 0.8 + 0.4 * Math.min(1, Math.sqrt(sunUp) * 1.5) : 0.25 + 0.55 * (1 - op);
      if (shadow) L *= 0.08;
      const ci = Math.min(N - 1, Math.floor(f)) * 3;
      const o = (j * bw + i) * 4;
      d[o] = prof.col[ci] * L;
      d[o + 1] = prof.col[ci + 1] * L;
      d[o + 2] = prof.col[ci + 2] * L;
      d[o + 3] = alpha * 255;
    }
  }
  wg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(ringWork, x0, y0, bw * step, bh * step);
}

/** 第五十轮:银河的天空贴图(后台线程算一次;没算好 = null,先只画星点) */
export function skyTexture(seed: number): Tex | null {
  return want(`sky:${seed}`, { kind: 'sky', seed, w: 1024 }, true);
}
