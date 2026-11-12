/**
 * 本地分支 modern-pace:月球(航天页的月面图、编年史里的着陆点)。和地球那条生成管线无关:没有板块、没有大气和水,
 * 地形 = 原始高地(背面地壳厚、高一些) + 一片正面的低地 + 撞击坑(幂律:小坑极多、大坑极少;老的先砸、新的叠在上面) +
 * 月海(大撞击盆地和正面低地后来被玄武岩灌平,颜色深;灌平以后砸的坑少)。
 *
 * 等距圆柱:x 0 = 西经 180°,y 0 = 北纬 90°;经度 0 = 正对地球的那一点(正面中心),±90° 以外是背面。
 * 只由种子决定,和推演无关(同一个世界的月球永远一样)。
 */
import { smoothstep, subSeed } from './util';

/** 月球半径 km */
export const MOON_R = 1737.4;

export interface MoonCrater {
  /** 中心经纬度(度) */
  lon: number;
  lat: number;
  /** 半径 km */
  r: number;
  /** 先后:0 最老 … 1 最新 */
  age: number;
}

export interface MoonMare {
  lon: number;
  lat: number;
  /** 大致半径 km(按灌平的范围) */
  r: number;
  /** 这一片有多少格(越大越该叫"洋") */
  px: number;
  /** 是正面那片低地(不是撞击盆地) */
  lowland: boolean;
}

export interface Moon {
  w: number;
  h: number;
  /** 高程 m(相对平均半径) */
  elev: Float32Array;
  /** 月海 0..1(玄武岩,颜色深) */
  mare: Float32Array;
  /** 新坑的亮辐射纹 0..1 */
  ray: Float32Array;
  /** 半径 ≥ NAMED_R 的坑(按大小排,大的在前) */
  craters: MoonCrater[];
  maria: MoonMare[];
}

/** 列进 craters 的最小半径 km */
const NAMED_R = 25;
/** 撞击坑一共几个、最小 / 最大直径(km);累计个数 N(>D) ∝ D^-SLOPE */
const CRATERS = 16000;
const D_MIN = 14;
const D_MAX = 2600;
const SLOPE = 2;
/** 多老以后才灌月海(在这之后砸的坑都叠在月海上面) */
const FLOOD_AGE = 0.82;
/** 多新的坑带亮晕和辐射纹(最新的这一成);辐射纹只给直径 RAY_D km 以上的;纹长 RAY_MIN–RAY_MAX 倍半径 */
const RAY_AGE = 0.9;
const RAY_D = 28;
const RAY_MIN = 3;
const RAY_MAX = 30;
/** 正面低地灌到第几分位的高程 */
const LOW_FILL = 0.75;

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 球面上的值噪声(三维格点 + 三线性插值),fbm 用 */
function noise3(seed: number) {
  const h = (x: number, y: number, z: number) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const f = (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = x - xi, v = y - yi, w = z - zi;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v), sw = w * w * (3 - 2 * w);
    let r = 0;
    for (let c = 0; c < 8; c++) {
      const dx = c & 1, dy = (c >> 1) & 1, dz = (c >> 2) & 1;
      r += h(xi + dx, yi + dy, zi + dz) * (dx ? su : 1 - su) * (dy ? sv : 1 - sv) * (dz ? sw : 1 - sw);
    }
    return r * 2 - 1;
  };
  return (x: number, y: number, z: number, oct: number, scale: number) => {
    let s = 0, amp = 1, tot = 0, k = scale;
    for (let o = 0; o < oct; o++) {
      s += amp * f(x * k + o * 17.3, y * k - o * 9.1, z * k + o * 3.7);
      tot += amp;
      amp *= 0.5;
      k *= 2;
    }
    return s / tot;
  };
}

/** 经纬度(度) → 单位向量;经度 0 正对地球 = +x */
function vec(lon: number, lat: number): [number, number, number] {
  const a = (lon * Math.PI) / 180, b = (lat * Math.PI) / 180;
  return [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
}

/** 坑的形状(Pike 1977 的经验式,km):深度、坑缘高 */
function craterShape(D: number): { depth: number; rim: number; complex: boolean } {
  if (D < 15) return { depth: 0.2 * D, rim: 0.036 * D, complex: false };
  return { depth: 1.044 * D ** 0.301, rim: 0.236 * D ** 0.399, complex: true };
}

/**
 * 别的天体借这个生成器时的开关(本地分支 modern-pace;不给 = 月球原样):
 *   craters  撞击坑个数的倍数(老地面 > 1,地表新的 < 1)
 *   maria    要不要灌月海
 *   lowland  要不要月球那种正面低地 + 背面高地
 */
export interface MoonOpts {
  craters?: number;
  maria?: boolean;
  lowland?: boolean;
}

export function generateMoon(seed: number, w = 1024, opts: MoonOpts = {}): Moon {
  const h = w / 2;
  const n = w * h;
  const rand = rng(subSeed(seed, 'moon'));
  const elev = new Float32Array(n);
  const mare = new Float32Array(n);
  const ray = new Float32Array(n);
  // 每格的单位向量
  const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    for (let x = 0; x < w; x++) {
      const [a, b, c] = vec(((x + 0.5) / w) * 360 - 180, lat);
      const i = y * w + x;
      X[i] = a; Y[i] = b; Z[i] = c;
    }
  }
  // ---- 原始高地:起伏 + 背面地壳厚(高 1.5 km 上下) + 正面一大片低地(以后灌成"洋") ----
  const nz = noise3(subSeed(seed, 'moon-h') | 0);
  const nl = noise3(subSeed(seed, 'moon-l') | 0);
  const r0 = rand();
  const lowC = vec(-40 + 50 * (r0 - 0.5), 10 + 30 * (rand() - 0.5));
  const lowland = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const far = -X[i];
    const near = X[i] * lowC[0] + Y[i] * lowC[1] + Z[i] * lowC[2];
    const L = opts.lowland === false ? 0 : smoothstep(0.2, 0.55, near + 0.6 * nl(X[i], Y[i], Z[i], 5, 2.2));
    lowland[i] = L;
    elev[i] = 700 * nz(X[i], Y[i], Z[i], 6, 2.2) + (opts.lowland === false ? 0 : 1500 * Math.max(0, far)) - 1800 * L;
  }

  // ---- 撞击坑清单:直径按幂律抽,先后随机;大的偏老(大盆地都在早期) ----
  const list: (MoonCrater & { D: number })[] = [];
  const nCraters = Math.round(CRATERS * (opts.craters ?? 1));
  for (let k = 0; k < nCraters; k++) {
    const u = rand();
    const D = Math.min(D_MAX, D_MIN * Math.pow(u, -1 / SLOPE));
    const zc = rand() * 2 - 1;
    const lon = rand() * 360 - 180;
    const lat = (Math.asin(zc) * 180) / Math.PI;
    const age = D > 250 ? rand() * 0.6 : rand() ** 0.85;
    list.push({ lon, lat, r: D / 2, age, D });
  }
  list.sort((a, b) => a.age - b.age);

  const pxPerRad = h / Math.PI;
  const stamp = (c: (typeof list)[number]) => {
    const R = c.r;
    const a = R / MOON_R;
    const { depth, rim, complex } = craterShape(c.D);
    const H = depth * 1000, hr = rim * 1000;
    const reach = 2.4;
    const [cx, cy, cz] = vec(c.lon, c.lat);
    const yc = ((90 - c.lat) / 180) * h;
    const y0 = Math.max(0, Math.floor(yc - reach * a * pxPerRad) - 1);
    const y1 = Math.min(h - 1, Math.ceil(yc + reach * a * pxPerRad) + 1);
    // 中心那格当底:坑里的高程按它算(高地上的坑底高、月海上的坑底低)
    const ic = Math.min(h - 1, Math.max(0, Math.floor(yc))) * w + Math.min(w - 1, Math.max(0, Math.floor(((c.lon + 180) / 360) * w)));
    const ref = elev[ic];
    const fr = complex ? Math.min(0.55, 0.25 + c.D / 600) : 0.05;
    const peak = complex && c.D > 35 && c.D < 300 ? H * 0.35 : 0;
    const basin = c.D >= 300;
    const cosR = Math.cos(Math.min(Math.PI, reach * a));
    for (let y = y0; y <= y1; y++) {
      const lat = 90 - ((y + 0.5) / h) * 180;
      const cl = Math.cos((lat * Math.PI) / 180);
      const dl = cl > 1e-3 ? (reach * a) / cl : 10;
      let xs = 0, xe = w - 1;
      const full = dl >= Math.PI;
      if (!full) {
        const xc = ((c.lon + 180) / 360) * w;
        const span = (dl / (2 * Math.PI)) * w + 1;
        xs = Math.floor(xc - span);
        xe = Math.ceil(xc + span);
      }
      for (let xx = xs; xx <= xe; xx++) {
        const x = ((xx % w) + w) % w;
        const i = y * w + x;
        const dot = X[i] * cx + Y[i] * cy + Z[i] * cz;
        if (dot < cosR) continue;
        const d = Math.acos(Math.min(1, dot)) / a;
        let p: number;
        if (d < 1) {
          const s = Math.max(0, (d - fr) / (1 - fr));
          p = -H + (H + hr) * s * s;
          if (peak) p += peak * Math.exp(-((d / 0.13) ** 2));
          if (basin) p += 0.35 * hr * Math.exp(-(((d - 0.55) / 0.05) ** 2));
        } else {
          p = hr * d ** -3 * (1 - smoothstep(1.7, reach, d));
          if (basin) p += 0.15 * hr * Math.exp(-(((d - 1.5) / 0.06) ** 2));
        }
        const k = smoothstep(0.7, 1.12, d);
        elev[i] = d < 1.12 ? ref + (elev[i] - ref) * k + p : elev[i] + p;
        if (d < 1) mare[i] *= 0.55 + 0.45 * k;
        // 年轻的坑:坑里和坑外一圈溅射物亮(越新越亮);辐射纹另扫(rays)
        if (c.age > RAY_AGE && d < 2.4) {
          const fresh = (c.age - RAY_AGE) / (1 - RAY_AGE);
          ray[i] = Math.max(ray[i], (0.25 + 0.75 * fresh ** 2) * (1 - smoothstep(0.8, 2.4, d)));
        }
      }
    }
  };

  // 辐射纹:每道一个方位角、粗细(方位上的角宽)、长度(几倍半径)、亮度;先画进按方位分的表,每格记最亮那道的亮度和长度,
  // 扫格子时查表(不用逐道算)。越新越亮、越长;大坑的纹伸得远(最多 RAY_MAX 倍半径,封顶 90°)
  const RAY_BINS = 2048;
  const tabB = new Float32Array(RAY_BINS);
  const tabL = new Float32Array(RAY_BINS);
  const rays = (c: (typeof list)[number]) => {
    const a = c.r / MOON_R;
    const fresh = (c.age - RAY_AGE) / (1 - RAY_AGE);
    // 只有最新的几个拖出长纹(新鲜度的四次方),其余短而淡
    const maxL = RAY_MIN + (RAY_MAX - RAY_MIN) * fresh ** 4 * Math.min(1, c.D / 70);
    const reach = Math.min(Math.PI / 2, maxL * a);
    tabB.fill(0);
    tabL.fill(0);
    const K = Math.round((12 + rand() * 12) * (1 + 1.5 * fresh ** 2));
    for (let k = 0; k < K; k++) {
      const th = rand() * 2 * Math.PI;
      const wd = 0.012 + 0.05 * rand() ** 2;
      const L = (0.3 + 0.7 * rand()) * maxL;
      const b = (0.35 + 0.65 * rand()) * (0.15 + 0.85 * fresh ** 2.5);
      const span = Math.ceil((3 * wd * RAY_BINS) / (2 * Math.PI));
      const b0 = Math.round((th * RAY_BINS) / (2 * Math.PI));
      for (let j = -span; j <= span; j++) {
        const bin = (((b0 + j) % RAY_BINS) + RAY_BINS) % RAY_BINS;
        const v = b * Math.exp(-(((j * 2 * Math.PI) / RAY_BINS / wd) ** 2));
        if (v > tabB[bin]) {
          tabB[bin] = v;
          tabL[bin] = L;
        }
      }
    }
    const [cx, cy, cz] = vec(c.lon, c.lat);
    // 坑中心的切平面:东、北两个方向
    let ex = -cy, ey = cx, ez = 0;
    const el = Math.hypot(ex, ey) || 1;
    if (el < 1e-6) { ex = 0; ey = 1; } else { ex /= el; ey /= el; }
    const nx = cy * ez - cz * ey, ny = cz * ex - cx * ez, nz = cx * ey - cy * ex;
    const cosR = Math.cos(reach);
    const yc = ((90 - c.lat) / 180) * h;
    const y0 = Math.max(0, Math.floor(yc - reach * pxPerRad) - 1);
    const y1 = Math.min(h - 1, Math.ceil(yc + reach * pxPerRad) + 1);
    for (let y = y0; y <= y1; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const dot = X[i] * cx + Y[i] * cy + Z[i] * cz;
        if (dot < cosR) continue;
        const d = Math.acos(Math.min(1, dot)) / a;
        if (d < 1.2) continue;
        const ang = Math.atan2(X[i] * ex + Y[i] * ey + Z[i] * ez, X[i] * nx + Y[i] * ny + Z[i] * nz);
        const bin = Math.floor(((ang + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI) * RAY_BINS) % RAY_BINS;
        const L = tabL[bin];
        if (!L || d > L) continue;
        const v = tabB[bin] * smoothstep(1.2, 2, d) * (1 - smoothstep(L * 0.4, L, d));
        if (v > ray[i]) ray[i] = v;
      }
  };

  // ---- 灌月海:老盆地(正面多、背面少)和正面低地,低于水位的灌平 ----
  const nm = noise3(subSeed(seed, 'moon-m') | 0);
  const flood = () => {
    const maria: MoonMare[] = [];
    const dirty = new Uint8Array(n);
    const fill = (inside: (i: number) => number, level: number) => {
      let cnt = 0;
      let sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < n; i++) {
        const m = inside(i);
        if (m <= 0 || elev[i] >= level + 350 * nm(X[i], Y[i], Z[i], 4, 9)) continue;
        elev[i] = level + (elev[i] - level) * 0.04;
        mare[i] = Math.max(mare[i], Math.min(1, m * 1.5));
        dirty[i] = 1;
        cnt++;
        sx += X[i]; sy += Y[i]; sz += Z[i];
      }
      return { cnt, sx, sy, sz };
    };
    for (const c of list) {
      if (c.D < 280 || c.age > FLOOD_AGE) continue;
      const [cx, cy, cz] = vec(c.lon, c.lat);
      const nearSide = cx > 0.15;
      if (rand() > (nearSide ? 0.6 : 0.1)) continue;
      const a = c.r / MOON_R;
      const cosA = Math.cos(a * 1.2);
      const ic = Math.floor(((90 - c.lat) / 180) * h) * w + Math.floor(((c.lon + 180) / 360) * w);
      const { depth } = craterShape(c.D);
      const level = elev[Math.min(n - 1, Math.max(0, ic))] + depth * 1000 * (0.3 + 0.3 * rand());
      const r = fill((i) => (X[i] * cx + Y[i] * cy + Z[i] * cz >= cosA ? 1 : 0), level);
      if (r.cnt > 0) maria.push({ lon: c.lon, lat: c.lat, r: c.r, px: r.cnt, lowland: false });
    }
    // 正面低地:取低地中心一带的平均高程当水位
    // 水位取低地里第 LOW_FILL 分位的高程:大半灌平,高处露出来当孤岛、边缘参差
    const lows: number[] = [];
    for (let i = 0; i < n; i++) if (lowland[i] > 0.5) lows.push(elev[i]);
    lows.sort((x, y) => x - y);
    const cnt = lows.length;
    if (cnt) {
      const r = fill((i) => lowland[i], lows[Math.floor(cnt * LOW_FILL)]);
      if (r.cnt > 0) {
        const L = Math.hypot(r.sx, r.sy, r.sz);
        const lon = (Math.atan2(r.sy, r.sx) * 180) / Math.PI;
        const lat = (Math.asin(r.sz / L) * 180) / Math.PI;
        maria.push({ lon, lat, r: Math.sqrt(r.cnt / n) * 2 * MOON_R, px: r.cnt, lowland: true });
      }
    }
    // 月海边缘软一点
    const m2 = mare.slice();
    for (let y = 1; y < h - 1; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!dirty[i] && !dirty[i - w] && !dirty[i + w]) continue;
        const l = y * w + ((x + w - 1) % w), r = y * w + ((x + 1) % w);
        m2[i] = (mare[i] * 4 + mare[l] + mare[r] + mare[i - w] + mare[i + w]) / 8;
      }
    mare.set(m2);
    return maria;
  };

  let maria: MoonMare[] = [];
  let flooded = false;
  for (const c of list) {
    if (!flooded && c.age > FLOOD_AGE) {
      if (opts.maria !== false) maria = flood();
      flooded = true;
    }
    stamp(c);
  }
  if (!flooded && opts.maria !== false) maria = flood();
  for (const c of list) if (c.age > RAY_AGE && c.D > RAY_D) rays(c);
  // 细碎的起伏(小于一格的坑、风化层),不然高地太光
  const nf = noise3(subSeed(seed, 'moon-f') | 0);
  for (let i = 0; i < n; i++) elev[i] += 90 * nf(X[i], Y[i], Z[i], 3, 70);
  // 玄武岩深浅不一(不同期的熔岩)
  const nt = noise3(subSeed(seed, 'moon-t') | 0);
  for (let i = 0; i < n; i++) if (mare[i] > 0) mare[i] *= 0.82 + 0.3 * nt(X[i], Y[i], Z[i], 4, 5);

  const craters = list
    .filter((c) => c.r >= NAMED_R)
    .sort((a, b) => b.r - a.r)
    .map(({ lon, lat, r, age }) => ({ lon, lat, r, age }));
  // 低地那片在前,其余按盆地大小(不按格数:格数随分辨率变,名字要和分辨率无关)
  maria.sort((a, b) => Number(b.lowland) - Number(a.lowland) || b.r - a.r);
  return { w, h, elev, mare, ray, craters, maria };
}

/** 画成 RGBA(灰度底色:高地亮、月海暗、新坑亮;西北来光的晕渲) */
export function moonRgba(m: Moon, out = new Uint8ClampedArray(m.w * m.h * 4)): Uint8ClampedArray {
  const { w, h, elev, mare, ray } = m;
  const kmPx = (Math.PI * MOON_R) / h;
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180;
    const cl = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    // 本地分支 modern-pace:东西向的坡度按球面上的实际距离取样 —— 越靠近极点,左右相邻两格在球面上越近,
    // 同一点起伏除以很小的距离,坡度放大几十倍,贴到球上就是从极点往外辐射的条纹;隔 k 格取(k ≈ 1 / cos 纬度),两点距离和赤道附近差不多
    // (纬度 48° 以内 k = 1,和原来一样)
    const k = Math.max(1, Math.min(w >> 3, Math.round(1 / Math.max(0.005, Math.cos((lat * Math.PI) / 180)))));
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const l = y * w + ((x + w - k) % w), r = y * w + ((x + k) % w);
      const u = y > 0 ? i - w : i, d = y < h - 1 ? i + w : i;
      const gx = k === 1 ? (elev[r] - elev[l]) / (2 * kmPx * cl * 1000) : (elev[r] - elev[l]) / (2 * k * kmPx * Math.max(0.005, Math.cos((lat * Math.PI) / 180)) * 1000);
      const gy = (elev[d] - elev[u]) / (2 * kmPx * 1000);
      // 光从西北上方来
      const shade = Math.max(0, Math.min(1.5, 1 + (-gx * 0.7 + gy * 0.7) * 5));
      const base = 0.64 - 0.28 * mare[i] + 0.22 * ray[i];
      const v = Math.max(0, Math.min(1, base * (0.35 + 0.65 * shade)));
      const o = i * 4;
      // 月海略偏蓝褐,高地略偏暖
      out[o] = 255 * v * (1 + 0.03 * (1 - mare[i]));
      out[o + 1] = 255 * v;
      out[o + 2] = 255 * v * (0.97 + 0.04 * mare[i]);
      out[o + 3] = 255;
    }
  }
  return out;
}
