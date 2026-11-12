/**
 * 本地分支 modern-pace 第四十六轮:行星系统那一层的透视相机(原来是正交投影,看不出远近、看不到恒星)。
 *
 *   相机    镜头是空间里的一个点(eye),看着目标(tgt);视野竖直 FOV;屏幕坐标 = 透视除法
 *   画球    每个像素从镜头打一条射线,和球求交 → 法线 → 光照、贴图(双线性)、发光层;有大气的边缘加一圈散射光
 *   画环    射线和环面求交;被行星挡住的不画;行星的影子;迎光 / 透光;斜看更不透明;远看按像素宽度取平均
 *   恒星    按真实方向画(圆盘 + 辉光);在画面外 = 画面边上一个箭头指着它
 * 全部用世界坐标(行星为原点,公里;黄道坐标系)。
 */
import type { RingProfile, Tex } from './planetTexGen';

export type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const v3 = { dot, sub, cross, norm };

export interface Cam {
  eye: V3;
  /** 往前、往右、往上(单位向量) */
  f: V3;
  r: V3;
  u: V3;
  /** 焦距(CSS 像素);屏幕中心 */
  foc: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** 竖直视野 35° */
export const FOV = (35 * Math.PI) / 180;

export function makeCam(eye: V3, tgt: V3, upHint: V3, cx: number, cy: number, w: number, h: number): Cam {
  const f = norm(sub(tgt, eye));
  let r = cross(f, upHint);
  if (Math.hypot(r[0], r[1], r[2]) < 1e-6) r = cross(f, [1, 0, 0]);
  r = norm(r);
  const u = cross(r, f);
  return { eye, f, r, u, foc: h / 2 / Math.tan(FOV / 2), cx, cy, w, h };
}

/** 世界里的一点 → 屏幕 [x, y, 深度];在镜头后面 = null */
export function project(c: Cam, p: V3): [number, number, number] | null {
  const d = sub(p, c.eye);
  const z = dot(d, c.f);
  if (z <= 1e-6) return null;
  return [c.cx + (c.foc * dot(d, c.r)) / z, c.cy - (c.foc * dot(d, c.u)) / z, z];
}

/** 屏幕上一点 → 射线方向 */
function rayDir(c: Cam, px: number, py: number): V3 {
  const a = (px - c.cx) / c.foc, b = (c.cy - py) / c.foc;
  return norm([c.f[0] + a * c.r[0] + b * c.u[0], c.f[1] + a * c.r[1] + b * c.u[1], c.f[2] + a * c.r[2] + b * c.u[2]]);
}

const work = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** 画布上一块(包围盒,夹在画布里)按多大步长算:最多算 MAX_PX 个像素 */
function box(c: Cam, x0: number, y0: number, x1: number, y1: number, maxPx: number) {
  const X0 = Math.max(0, Math.floor(x0)), Y0 = Math.max(0, Math.floor(y0));
  const X1 = Math.min(c.w, Math.ceil(x1)), Y1 = Math.min(c.h, Math.ceil(y1));
  if (X1 <= X0 || Y1 <= Y0) return null;
  const step = Math.max(1, Math.ceil(Math.sqrt(((X1 - X0) * (Y1 - Y0)) / maxPx)));
  return { X0, Y0, bw: Math.ceil((X1 - X0) / step), bh: Math.ceil((Y1 - Y0) / step), step };
}

export interface Atmo {
  color: V3;
  strength: number;
}

/**
 * 射线法画带贴图的球。toBody = 世界里的法线 → 星体坐标(取经纬度);sun = 世界里的光照方向;ambient = 夜面底光。
 * 返回屏幕上的圆(中心、半径;拿来登记点击、写名字);看不见 = null
 */
export function drawSphereP(g: CanvasRenderingContext2D, c: Cam, C: V3, R: number, tex: Tex, toBody: (n: V3) => V3, sun: V3, ambient: number, atmo?: Atmo): { x: number; y: number; r: number } | null {
  const oc = sub(c.eye, C);
  const dist = Math.hypot(oc[0], oc[1], oc[2]);
  if (dist <= R) return null;
  const pc = project(c, C);
  const ang = Math.asin(Math.min(1, R / dist));
  const halo = atmo ? 1.04 : 1;
  let x0: number, y0: number, x1: number, y1: number, sx: number, sy: number, sr: number;
  if (pc && ang < 1.2) {
    // 离开画面中心的球投影出来是略扁的椭圆:包围盒放宽一点
    const off = Math.hypot(pc[0] - c.cx, pc[1] - c.cy) / c.foc;
    sr = c.foc * Math.tan(ang) * (1 + 0.6 * off * off) * halo;
    sx = pc[0];
    sy = pc[1];
    x0 = sx - sr - 2;
    x1 = sx + sr + 2;
    y0 = sy - sr - 2;
    y1 = sy + sr + 2;
  } else {
    // 贴得很近 / 中心在身后:整张画布都可能有
    if (!pc && dot(sub(C, c.eye), c.f) < -R) return null;
    sx = pc ? pc[0] : c.cx;
    sy = pc ? pc[1] : c.cy;
    sr = Math.max(c.w, c.h);
    x0 = 0;
    y0 = 0;
    x1 = c.w;
    y1 = c.h;
  }
  if (sr < 1.2 || !work) {
    if (pc) {
      g.fillStyle = 'rgb(160,160,160)';
      g.beginPath();
      g.arc(sx, sy, 1.2, 0, Math.PI * 2);
      g.fill();
    }
    return pc ? { x: sx, y: sy, r: Math.max(1.2, sr) } : null;
  }
  const b = box(c, x0, y0, x1, y1, 700000);
  if (!b) return { x: sx, y: sy, r: sr };
  const { X0, Y0, bw, bh, step } = b;
  work.width = bw;
  work.height = bh;
  const wg = work.getContext('2d')!;
  const img = wg.createImageData(bw, bh);
  const d = img.data;
  const TW = tex.w, TH = tex.h, P = tex.px, GL = tex.glow;
  const R2 = R * R, ocl = dot(oc, oc);
  const Rh = R * halo;
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const dir = rayDir(c, X0 + (i + 0.5) * step, Y0 + (j + 0.5) * step);
      const bb = dot(oc, dir);
      const perp2 = ocl - bb * bb;
      if (bb > 0 || perp2 > Rh * Rh) continue;
      const di = (j * bw + i) * 4;
      // 一个像素在那么远处有多宽(公里):边缘抗锯齿
      const pix = (-bb * step) / c.foc;
      if (perp2 > R2) {
        // 大气的外圈光晕(只在有大气时)
        if (!atmo) continue;
        const hh = (Math.sqrt(perp2) - R) / (Rh - R);
        const nn = norm(sub([c.eye[0] + -bb * dir[0], c.eye[1] + -bb * dir[1], c.eye[2] + -bb * dir[2]], C));
        const lit = Math.max(0, dot(nn, sun) + 0.25);
        const a = (1 - hh) * (1 - hh) * atmo.strength * Math.min(1, lit);
        d[di] = atmo.color[0];
        d[di + 1] = atmo.color[1];
        d[di + 2] = atmo.color[2];
        d[di + 3] = 255 * Math.min(1, a);
        continue;
      }
      const t = -bb - Math.sqrt(R2 - perp2);
      const hit: V3 = [c.eye[0] + t * dir[0], c.eye[1] + t * dir[1], c.eye[2] + t * dir[2]];
      const n: V3 = [(hit[0] - C[0]) / R, (hit[1] - C[1]) / R, (hit[2] - C[2]) / R];
      const lit = dot(n, sun);
      // 明暗交界留一点过渡
      const lk = Math.max(0, Math.min(1, (lit + 0.04) / 0.5));
      const k = ambient + (1 - ambient) * Math.min(1, lk * 1.15);
      const B = toBody(n);
      const fu = ((Math.atan2(B[1], B[0]) / Math.PI + 1) / 2) * TW - 0.5;
      const fv = Math.min(TH - 1, Math.max(0, (0.5 - Math.asin(Math.max(-1, Math.min(1, B[2]))) / Math.PI) * TH - 0.5));
      const u0 = Math.floor(fu), v0 = Math.floor(fv);
      const du = fu - u0, dv = fv - v0;
      const ua = ((u0 % TW) + TW) % TW, ub = (ua + 1) % TW, vb = Math.min(TH - 1, v0 + 1);
      const i00 = (v0 * TW + ua) * 4, i10 = (v0 * TW + ub) * 4, i01 = (vb * TW + ua) * 4, i11 = (vb * TW + ub) * 4;
      const w00 = (1 - du) * (1 - dv), w10 = du * (1 - dv), w01 = (1 - du) * dv, w11 = du * dv;
      let rr = (P[i00] * w00 + P[i10] * w10 + P[i01] * w01 + P[i11] * w11) * k;
      let gg = (P[i00 + 1] * w00 + P[i10 + 1] * w10 + P[i01 + 1] * w01 + P[i11 + 1] * w11) * k;
      let bl = (P[i00 + 2] * w00 + P[i10 + 2] * w10 + P[i01 + 2] * w01 + P[i11 + 2] * w11) * k;
      if (GL) {
        const gv = ((GL[i00 >> 2] * w00 + GL[i10 >> 2] * w10 + GL[i01 >> 2] * w01 + GL[i11 >> 2] * w11) / 255) * (1 - 0.6 * k);
        if (gv > 0.004) {
          rr += 255 * gv;
          gg += 120 * gv;
          bl += 45 * gv;
        }
      }
      if (atmo) {
        // 边缘的大气散射:越斜着看越亮,只在受光的那边
        const mu = Math.max(0, -dot(n, dir));
        const a = Math.pow(1 - mu, 3) * atmo.strength * Math.max(0, Math.min(1, lit + 0.3));
        rr += (atmo.color[0] - rr) * a;
        gg += (atmo.color[1] - gg) * a;
        bl += (atmo.color[2] - bl) * a;
      }
      d[di] = rr;
      d[di + 1] = gg;
      d[di + 2] = bl;
      const edge = (R - Math.sqrt(perp2)) / Math.max(1e-9, pix);
      d[di + 3] = 255 * Math.max(0, Math.min(1, edge));
    }
  }
  wg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(work, X0, Y0, bw * step, bh * step);
  return { x: sx, y: sy, r: sr / halo };
}

/**
 * 射线法画环:环面过行星中心 C、法线 ax,面内两个方向 e1 / e2;Rp = 行星半径(公里;环的内外径按它的倍数)。
 * 被行星挡住的不画;行星的影子落在环上的变暗;太阳和镜头在环面同一侧 = 迎光,另一侧 = 透光
 */
export function drawRingP(g: CanvasRenderingContext2D, c: Cam, C: V3, Rp: number, prof: RingProfile, ax: V3, e1: V3, e2: V3, sun: V3) {
  if (!work) return;
  // 包围盒:外圈采样投到屏幕上
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false, behind = false;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const R = prof.outer * Rp;
    const p: V3 = [C[0] + R * (Math.cos(a) * e1[0] + Math.sin(a) * e2[0]), C[1] + R * (Math.cos(a) * e1[1] + Math.sin(a) * e2[1]), C[2] + R * (Math.cos(a) * e1[2] + Math.sin(a) * e2[2])];
    const q = project(c, p);
    if (!q) {
      behind = true;
      continue;
    }
    any = true;
    x0 = Math.min(x0, q[0]);
    y0 = Math.min(y0, q[1]);
    x1 = Math.max(x1, q[0]);
    y1 = Math.max(y1, q[1]);
  }
  if (!any) return;
  if (behind) {
    x0 = 0;
    y0 = 0;
    x1 = c.w;
    y1 = c.h;
  }
  const b = box(c, x0 - 2, y0 - 2, x1 + 2, y1 + 2, 400000);
  if (!b) return;
  const { X0, Y0, bw, bh, step } = b;
  work.width = bw;
  work.height = bh;
  const wg = work.getContext('2d')!;
  const img = wg.createImageData(bw, bh);
  const d = img.data;
  const N = prof.op.length, span = prof.outer - prof.inner;
  const oc = sub(c.eye, C);
  const ocl = dot(oc, oc), R2 = Rp * Rp;
  const sx = dot(sun, e1), sy = dot(sun, e2), sz = dot(sun, ax);
  const eyeSide = Math.sign(dot(oc, ax));
  const same = Math.sign(sz) === eyeSide;
  const sunUp = Math.abs(sz);
  const toC = sub(C, c.eye);
  const planeD = dot(toC, ax);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const dir = rayDir(c, X0 + (i + 0.5) * step, Y0 + (j + 0.5) * step);
      const den = dot(dir, ax);
      if (Math.abs(den) < 1e-6) continue;
      const t = planeD / den;
      if (t <= 0) continue;
      const hx = c.eye[0] + t * dir[0] - C[0], hy = c.eye[1] + t * dir[1] - C[1], hz = c.eye[2] + t * dir[2] - C[2];
      const px = (hx * e1[0] + hy * e1[1] + hz * e1[2]) / Rp, py = (hx * e2[0] + hy * e2[1] + hz * e2[2]) / Rp;
      const rr = Math.hypot(px, py);
      if (rr < prof.inner || rr >= prof.outer) continue;
      // 行星挡着
      const bb = dot(oc, dir);
      const perp2 = ocl - bb * bb;
      if (perp2 < R2 && bb < 0) {
        const ts = -bb - Math.sqrt(R2 - perp2);
        if (ts > 0 && ts < t) continue;
      }
      const az = Math.abs(den);
      const foot = Math.max(1, (((t * step) / c.foc / Rp) * N) / span / Math.max(0.15, az));
      const f = ((rr - prof.inner) / span) * N;
      const i0 = Math.max(0, Math.floor(f - foot / 2)), i1 = Math.min(N, Math.max(i0 + 1, Math.ceil(f + foot / 2)));
      const op = (prof.sum[i1] - prof.sum[i0]) / (i1 - i0);
      if (op < 0.004) continue;
      const alpha = 1 - Math.pow(1 - Math.min(0.99, op), Math.min(6, 1 / Math.max(az, 0.02)));
      const bs = px * sx + py * sy;
      const shadow = bs < 0 && rr * rr - bs * bs < 1;
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
  g.drawImage(work, X0, Y0, bw * step, bh * step);
}

/**
 * 恒星:按真实方向 dir(单位向量)画在背景里 —— 圆盘(按视角大小,至少几像素)+ 辉光,旁边写名字;
 * 在画面外(或在身后)= 画面边上一个箭头指着它
 */
export function drawStarP(
  g: CanvasRenderingContext2D,
  c: Cam,
  dir: V3,
  angR: number,
  col: V3,
  label: string,
  /** 显卡画圆盘和辉光(给了就只在这里写字);hidden = 被星体挡住(不写字) */
  gpu?: { star: (x: number, y: number, r0: number, gr: number) => void; hidden: boolean },
) {
  const z = dot(dir, c.f);
  const a = dot(dir, c.r), b = dot(dir, c.u);
  const [cr, cg, cb] = col;
  if (z > 0) {
    const x = c.cx + (c.foc * a) / z, y = c.cy - (c.foc * b) / z;
    if (x > -40 && y > -40 && x < c.w + 40 && y < c.h + 40) {
      const r0 = Math.max(4, c.foc * Math.tan(angR));
      if (gpu) {
        gpu.star(x, y, r0, r0 * 9 + 30);
        if (gpu.hidden) return;
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        g.fillStyle = 'rgba(255,240,210,0.85)';
        g.fillText(label, x, y + r0 + 18);
        return;
      }
      const gl = g.createRadialGradient(x, y, 0, x, y, r0 * 9 + 30);
      gl.addColorStop(0, `rgba(${cr},${cg},${cb},0.9)`);
      gl.addColorStop(0.12, `rgba(${cr},${cg},${cb},0.45)`);
      gl.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      g.fillStyle = gl;
      g.beginPath();
      g.arc(x, y, r0 * 9 + 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = `rgb(${Math.min(255, cr + 40)},${Math.min(255, cg + 40)},${Math.min(255, cb + 40)})`;
      g.beginPath();
      g.arc(x, y, r0, 0, Math.PI * 2);
      g.fill();
      g.font = '12px sans-serif';
      g.textAlign = 'center';
      g.fillStyle = 'rgba(255,240,210,0.85)';
      g.fillText(label, x, y + r0 + 18);
      return;
    }
  }
  // 画面外:从画面中心朝它的方向,贴着边画个箭头
  let dx = a, dy = -b;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const m = 34;
  const kx = dx > 0 ? (c.w - m - c.cx) / dx : dx < 0 ? (m - c.cx) / dx : Infinity;
  // 上边让开按钮栏(约 60 像素)
  const ky = dy > 0 ? (c.h - m - c.cy) / dy : dy < 0 ? (m + 40 - c.cy) / dy : Infinity;
  const k = Math.min(kx, ky);
  const x = c.cx + dx * k, y = c.cy + dy * k;
  g.save();
  g.translate(x, y);
  g.rotate(Math.atan2(dy, dx));
  g.fillStyle = `rgba(${cr},${cg},${cb},0.95)`;
  g.beginPath();
  g.moveTo(12, 0);
  g.lineTo(-6, -7);
  g.lineTo(-6, 7);
  g.closePath();
  g.fill();
  g.restore();
  g.font = '12px sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,240,210,0.85)';
  g.fillText(label, x - dx * 26, y - dy * 26 + 4);
}

/** 球在屏幕上的圆(中心、半径;登记点击、写名字用,不画);看不见 = null */
export function sphereScreen(c: Cam, C: V3, R: number): { x: number; y: number; r: number } | null {
  const oc = sub(c.eye, C);
  const dist = Math.hypot(oc[0], oc[1], oc[2]);
  if (dist <= R) return null;
  const pc = project(c, C);
  if (!pc) return null;
  return { x: pc[0], y: pc[1], r: c.foc * Math.tan(Math.asin(Math.min(1, R / dist))) };
}

/** 从镜头看 p 那一点,半路有没有被这些球挡住(轨道线、恒星的字被星体挡住的不画) */
export function occluded(c: Cam, p: V3, balls: readonly { C: V3; R: number }[]): boolean {
  const d = sub(p, c.eye);
  const L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-9) return false;
  const dir: V3 = [d[0] / L, d[1] / L, d[2] / L];
  for (const b of balls) {
    const oc = sub(c.eye, b.C);
    const bb = dot(oc, dir);
    const perp2 = dot(oc, oc) - bb * bb;
    if (bb >= 0 || perp2 >= b.R * b.R) continue;
    const t = -bb - Math.sqrt(b.R * b.R - perp2);
    if (t > 0 && t < L) return true;
  }
  return false;
}
