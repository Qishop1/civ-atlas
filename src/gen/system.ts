/**
 * 本地分支 modern-pace:恒星系 —— 世界的第一层设定(新建世界的第一步;星球的气温跟着母星收到的辐射走)。
 *
 * 分两层:
 *   规格 SystemSpec  能编辑的那些:恒星(光谱型、次型、质量)、伴星(S 型 / P 型、间距)、各行星(种类、离恒星多远 —— 记成母星距离的倍数,
 *                    拖气温滑条时别的行星跟着挪、不会撞上母星 —— 半径、偏心、卫星)、小行星带、母星的倾角。
 *                    randomSpec(seed) 按种子随机出一份;编辑器改它(第一步「恒星系」)
 *   实体 StarSystem  由规格 + 世界的气温参数算出来:光度、温度、半径、寿命、宜居带、母星离恒星多远、一年几天、各行星的周期和平衡温度
 *
 *   恒星    主序星只开放 M / K / G / F(A / B / O 寿命几亿年以下,最后膨胀成巨星或炸成超新星,就算有了复杂生命也会被吞掉 —— 用户定:不给选);质量 → 光度(分段幂律)、半径、表面温度(斯特藩—玻尔兹曼)、寿命(10 Gyr × M^-2.5)、颜色(黑体)。
 *           随机时只出 F / G / K(按真实比例 K 0.53、G 0.33、F 0.14);M 型(宜居带近、母星会被潮汐锁定、耀斑多)编辑器里能选,habitability() 写明后果
 *   伴星    三成机会:S 型(伴星在 20–200 AU 外,行星只绕主星,只留伴星间距 1/3 以内的)或 P 型(两颗星挨着 0.05–0.3 AU 互绕,
 *           行星绕着两颗转,只留 3.5 倍间距以外的)。母星收到的辐射按 P 型两颗的光加起来、S 型只算主星
 *   母星    收到的辐射 S(地球 = 1)由世界的气温参数换算(fluxOfTemp):距离 a = √(L / S);一天 24 小时;
 *           一年几天按真实周期;自转轴倾角、指向按种子;一颗和月球一样的月亮(LUNA,月面图见 moon.ts)
 *   结构    按种子先抽一种:类太阳系 / 紧凑(内侧一串超级地球、迷你海王星)/ 热木星 / 偏心巨行星 / 稀疏 / 没有巨行星;
 *           种类:岩质、超级地球、迷你海王星、冰巨星、气态巨行星、矮行星。稳定:相邻周期比 ≥ 1.3(巨行星旁 ≥ 1.6),
 *           巨行星的轨道(含偏心)离母星的轨道至少 2.5 倍。小行星带 0–2 条,在空档里
 *   卫星    巨行星挂 1–5 颗有名字的大卫星(半径、轨道),另有一大群小的(只记个数)
 * 名字由调用方给(按民族语感起;见 story/systemText.ts),这里只给每颗一个稳定的键。
 */
import { subSeed } from './util';

export type PlanetKind = 'home' | 'rocky' | 'super' | 'mini' | 'gas' | 'ice' | 'dwarf';
export type StarClass = 'M' | 'K' | 'G' | 'F';
export type Arch = 'solar' | 'compact' | 'hotjup' | 'eccentric' | 'sparse' | 'nogiant';
export const ARCH_NAME: Record<Arch, string> = { solar: '类太阳系', compact: '紧凑型', hotjup: '热木星', eccentric: '偏心巨行星', sparse: '稀疏型', nogiant: '没有巨行星' };
export const KIND_NAME: Record<PlanetKind, string> = { home: '母星', rocky: '岩质行星', super: '超级地球', mini: '迷你海王星', gas: '气态巨行星', ice: '冰巨星', dwarf: '矮行星' };

// ---------------------------------------------------------------------------------------------------------------- 规格

export interface StarSpec {
  cls: StarClass;
  /** 次型 0–9(0 最热) */
  sub: number;
  /** 质量(太阳 = 1) */
  mass: number;
}
export interface MoonSpec {
  /** 起名用的键 */
  key: number;
  /** 半径 km、轨道半径(行星半径的几倍) */
  radius: number;
  dist: number;
}
export interface PlanetSpec {
  key: number;
  kind: Exclude<PlanetKind, 'home'>;
  /** 半长轴 = 母星的几倍 */
  ar: number;
  e: number;
  incl: number;
  node: number;
  m0: number;
  radius: number;
  ringed: boolean;
  /** 有名字的大卫星 + 小卫星的个数 */
  moons: MoonSpec[];
  small: number;
  color: [number, number, number];
  albedo: number;
  /** 本地分支 modern-pace 第四十二轮:温室效应让地表比平衡温度高多少 °C(岩质 / 超级地球才有意义;没有 = 按大小估) */
  greenhouse?: number;
}
export interface BeltSpec {
  /** 内外缘 = 母星距离的几倍;画几颗点 */
  inner: number;
  outer: number;
  count: number;
}
export interface SystemSpec {
  star: StarSpec;
  companion?: { star: StarSpec; mode: 'S' | 'P'; sep: number; e: number };
  arch: Arch;
  planets: PlanetSpec[];
  belts: BeltSpec[];
  /** greenhouse / albedo:换过母星的(选了别的行星当母星)记着它自己的温室和反照率,距离按它们算;没有 = 地球那样(按 fluxOfTemp) */
  home: { e: number; tilt: number; axisLon: number; greenhouse?: number; albedo?: number };
}

// ---------------------------------------------------------------------------------------------------------------- 恒星

/** 各光谱型的质量范围 [最轻(次型 9), 最重(次型 0)] */
export const CLASS_MASS: Record<StarClass, [number, number]> = {
  M: [0.08, 0.45],
  K: [0.45, 0.8],
  G: [0.8, 1.04],
  F: [1.04, 1.4],
};
export const STAR_CLASSES: readonly StarClass[] = ['M', 'K', 'G', 'F'];

/** 光谱型 + 次型 → 质量(在这一型的范围里按次型插值) */
export function massOf(cls: StarClass, sub: number): number {
  const [lo, hi] = CLASS_MASS[cls];
  const t = 1 - Math.max(0, Math.min(9, sub)) / 9;
  return lo + (hi - lo) * t;
}
/** 质量 → 光谱型 + 次型 */
export function classOf(mass: number): { cls: StarClass; sub: number } {
  for (const cls of STAR_CLASSES) {
    const [lo, hi] = CLASS_MASS[cls];
    if (mass <= hi || cls === 'F') {
      const m = Math.max(lo, Math.min(hi, mass));
      const t = (m - lo) / (hi - lo);
      return { cls, sub: Math.round(9 - 9 * t) };
    }
  }
  return { cls: 'G', sub: 2 };
}

export interface Star {
  cls: StarClass;
  sub: number;
  label: string;
  mass: number;
  /** 光度、半径(太阳 = 1)、表面温度 K、主序寿命(亿年) */
  lum: number;
  rsun: number;
  temp: number;
  life: number;
  /** 半径 km */
  radius: number;
  color: [number, number, number];
}

/** 黑体颜色(Tanner Helland 的近似) */
function blackbody(T: number): [number, number, number] {
  const t = T / 100;
  const cl = (x: number) => Math.max(0, Math.min(255, Math.round(x)));
  const r = t <= 66 ? 255 : cl(329.698727446 * Math.pow(t - 60, -0.1332047592));
  const g = t <= 66 ? cl(99.4708025861 * Math.log(t) - 161.1195681661) : cl(288.1221695283 * Math.pow(t - 60, -0.0755148492));
  const b = t >= 66 ? 255 : t <= 19 ? 0 : cl(138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return [r, g, b];
}

/** 主序星的物理量 */
export function starOf(s: StarSpec): Star {
  const M = s.mass;
  const lum = M < 0.43 ? 0.23 * Math.pow(M, 2.3) : M < 2 ? Math.pow(M, 4) : M < 55 ? 1.4 * Math.pow(M, 3.5) : 32000 * M;
  const rsun = M < 1 ? Math.pow(M, 0.8) : Math.pow(M, 0.57);
  const temp = 5772 * Math.pow(lum / (rsun * rsun), 0.25);
  return { cls: s.cls, sub: s.sub, label: `${s.cls}${s.sub}`, mass: M, lum, rsun, temp, life: 100 * Math.pow(M, -2.5), radius: 696000 * rsun, color: blackbody(temp) };
}

/** 这种恒星旁的类地星球说得通吗:没问题 = null;否则一句后果 */
export function habitability(s: Star): string | null {
  if (s.cls === 'M') return '宜居带离恒星很近:母星多半被潮汐锁定(一面永远白天),耀斑频繁;地图仍按有昼夜画';
  return null;
}

// ---------------------------------------------------------------------------------------------------------------- 实体

export interface Planet {
  key: number;
  kind: PlanetKind;
  /** 半长轴 AU、偏心率、倾角(度,对母星轨道面 = 黄道)、升交点经度(度)、第 0 年的平近点角(度) */
  a: number;
  e: number;
  incl: number;
  node: number;
  m0: number;
  /** 公转周期(按标准年 = 365.25 天) */
  period: number;
  radius: number;
  color: [number, number, number];
  ringed: boolean;
  /** 卫星一共几颗(大的 + 小的)、有名字的大卫星 */
  moons: number;
  major: MoonSpec[];
  albedo: number;
  /** 平衡温度 °C */
  teq: number;
  /** 温室 °C、地表温度 °C(岩质 / 超级地球;别的 = 平衡温度) */
  greenhouse: number;
  surface: number;
  /** 宜居候选:岩质 / 超级地球、0.6–1.5 地球半径、地表和地球(15°C)差不到 ±12°C(地图气温滑条的范围)—— 能选它当母星 */
  habitable: boolean;
}

export interface StarSystem {
  spec: SystemSpec;
  arch: Arch;
  star: Star;
  /** 伴星:物理量 + S / P 型、间距 AU、互绕周期(标准年) */
  companion?: Star & { mode: 'S' | 'P'; sep: number; e: number; period: number };
  /** 母星这边看的总光度(P 型两颗加起来) */
  lum: number;
  /** 宜居带(AU,保守:辐射 1.1–0.53) */
  hz: [number, number];
  planets: Planet[];
  home: number;
  flux: number;
  /** 母星绕一圈几天(标准天) */
  yearDays: number;
  tilt: number;
  axisLon: number;
  belts: { inner: number; outer: number; count: number }[];
  /** 第一条小行星带(旧接口) */
  belt?: { inner: number; outer: number };
  frost: number;
}

export const LUNA = { radius: 1737.4, a: 384400, periodDays: 27.32, incl: 5.14 };
export const AU_KM = 1.496e8;
export const HOME_RADIUS = 6371;

const FEEDBACK = 1.4;
export function fluxOfTemp(dT: number): number {
  return Math.pow(1 + dT / (288 * FEEDBACK), 4);
}
export function tempOfFlux(S: number): number {
  return (Math.pow(S, 0.25) - 1) * 288 * FEEDBACK;
}

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
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const COLORS: Record<Exclude<PlanetKind, 'home'>, [number, number, number][]> = {
  rocky: [
    [190, 110, 80],
    [170, 160, 150],
    [210, 180, 130],
    [150, 130, 110],
  ],
  super: [
    [160, 140, 120],
    [120, 130, 140],
    [190, 150, 110],
  ],
  mini: [
    [140, 190, 210],
    [170, 200, 190],
  ],
  gas: [
    [215, 180, 140],
    [225, 200, 160],
    [200, 150, 110],
  ],
  ice: [
    [150, 200, 220],
    [110, 160, 220],
  ],
  dwarf: [
    [180, 170, 160],
    [200, 190, 175],
  ],
};
const RADIUS: Record<Exclude<PlanetKind, 'home'>, [number, number]> = {
  dwarf: [500, 1400],
  rocky: [2200, 7800],
  super: [8500, 12500],
  mini: [13000, 24000],
  ice: [22000, 28000],
  gas: [45000, 80000],
};
const ALBEDO: Record<Exclude<PlanetKind, 'home'>, [number, number]> = { dwarf: [0.1, 0.6], rocky: [0.1, 0.35], super: [0.15, 0.35], mini: [0.3, 0.45], ice: [0.28, 0.32], gas: [0.3, 0.38] };
const giant = (k: PlanetKind) => k === 'gas' || k === 'ice';

/** 按种子随机出一份规格(星球的气温不影响规格:别的行星按母星距离的倍数记) */
export function randomSpec(seed: number): SystemSpec {
  const r = rng(subSeed(seed, 'system'));
  const u = r();
  const cls: StarClass = u < 0.53 ? 'K' : u < 0.86 ? 'G' : 'F';
  const sub = Math.floor(r() * 10);
  const star: StarSpec = { cls, sub, mass: massOf(cls, sub) };
  const S0 = starOf(star);
  let companion: SystemSpec['companion'];
  if (r() < 0.3) {
    const m2 = star.mass * lerp(0.2, 0.95, r());
    const c2 = classOf(m2);
    const mode: 'S' | 'P' = r() < 0.3 ? 'P' : 'S';
    companion = { star: { ...c2, mass: m2 }, mode, sep: mode === 'P' ? lerp(0.05, 0.3, r()) : lerp(20, 200, r()) * Math.sqrt(S0.lum), e: lerp(0, 0.3, r()) };
  }
  // 母星大约在哪(给"倍数"定标用;真正的距离按气温算)
  const L = S0.lum + (companion?.mode === 'P' ? starOf(companion.star).lum : 0);
  const aH = Math.sqrt(L);
  const frost = (2.7 * Math.sqrt(L)) / aH;
  const v = r();
  const arch: Arch = v < 0.35 ? 'solar' : v < 0.55 ? 'compact' : v < 0.65 ? 'hotjup' : v < 0.75 ? 'eccentric' : v < 0.9 ? 'sparse' : 'nogiant';
  const planets: PlanetSpec[] = [];
  let key = 1;
  const mk = (kind: PlanetSpec['kind'], ar: number, e = lerp(0, 0.1, r() ** 2)): PlanetSpec => {
    const [r0, r1] = RADIUS[kind];
    const cs = COLORS[kind];
    const [a0, a1] = ALBEDO[kind];
    const nMajor = kind === 'gas' ? 2 + Math.floor(r() * 4) : kind === 'ice' ? 1 + Math.floor(r() * 3) : kind === 'mini' ? Math.floor(r() * 2) : r() < 0.3 ? 1 : 0;
    const moons: MoonSpec[] = Array.from({ length: nMajor }, (_, i) => ({ key: key * 10 + i, radius: lerp(giant(kind) ? 400 : 100, giant(kind) ? 2700 : 900, r() ** 1.5), dist: lerp(4, 40, r()) * (1 + i * 0.6) }));
    return {
      key: key++,
      kind,
      ar,
      e,
      incl: lerp(0, giant(kind) ? 2.5 : 4, r()),
      node: r() * 360,
      m0: r() * 360,
      radius: lerp(r0, r1, r()),
      ringed: giant(kind) ? r() < (kind === 'gas' ? 0.35 : 0.5) : false,
      moons,
      small: giant(kind) ? Math.floor(lerp(3, 60, r() ** 2)) : 0,
      color: cs[Math.floor(r() * cs.length)],
      albedo: lerp(a0, a1, r()),
    };
  };
  const inner = (n: number, kinds: PlanetSpec['kind'][], step: [number, number]) => {
    let ar = 1;
    for (let k = 0; k < n; k++) {
      ar /= lerp(step[0], step[1], r());
      if (ar * aH < 0.03) break;
      planets.push(mk(kinds[Math.floor(r() * kinds.length)], ar));
    }
    return ar;
  };
  let outerAr = 1;
  const outer = (kinds: PlanetSpec['kind'][], n: number, step: [number, number], from = 1) => {
    let ar = from;
    for (let k = 0; k < n; k++) {
      ar *= lerp(step[0], step[1], r());
      planets.push(mk(kinds[Math.floor(r() * kinds.length)], ar));
    }
    outerAr = ar;
    return ar;
  };
  const belts: BeltSpec[] = [];
  const belt = (lo: number) => {
    const inner = lo;
    const out = inner * lerp(1.25, 1.5, r());
    belts.push({ inner, outer: out, count: Math.round(lerp(500, 1800, r())) });
    return out;
  };
  const giantsFrom = (from: number, nGas: number, nIce: number) => {
    let ar = Math.max(from * lerp(1.5, 1.9, r()), frost * 1.3, 2.5);
    for (let k = 0; k < nGas + nIce; k++) {
      planets.push(mk(k < nGas ? 'gas' : 'ice', ar));
      ar *= lerp(1.6, 2.1, r());
    }
    outerAr = ar;
  };
  switch (arch) {
    case 'solar': {
      inner(r() < 0.15 ? 0 : 1 + Math.floor(r() * 3), ['rocky', 'rocky', 'super'], [1.4, 1.9]);
      let ar = 1;
      const nOut = Math.floor(r() * 3);
      for (let k = 0; k < nOut; k++) {
        const na = ar * lerp(1.4, 1.8, r());
        if (na > frost * 0.85) break;
        ar = na;
        planets.push(mk(r() < 0.8 ? 'rocky' : 'dwarf', ar));
      }
      if (r() < 0.7) ar = belt(Math.max(ar * 1.3, frost * 0.75));
      giantsFrom(ar, 1 + Math.floor(r() * 3), Math.floor(r() * 3));
      if (r() < 0.3) belt(outerAr * 1.3);
      break;
    }
    case 'compact': {
      inner(3 + Math.floor(r() * 4), ['super', 'mini', 'rocky', 'mini'], [1.25, 1.6]);
      if (r() < 0.5) outer(['rocky', 'super'], 1, [1.35, 1.7]);
      if (r() < 0.4) giantsFrom(outerAr, 0, 1);
      break;
    }
    case 'hotjup': {
      planets.push(mk('gas', lerp(0.03, 0.08, r()) / aH, lerp(0, 0.05, r())));
      if (r() < 0.5) outer(['rocky', 'super'], 1, [1.4, 1.8]);
      if (r() < 0.6) giantsFrom(outerAr, r() < 0.5 ? 1 : 0, 1);
      break;
    }
    case 'eccentric': {
      inner(Math.floor(r() * 3), ['rocky', 'super'], [1.4, 1.9]);
      let ar = 1;
      if (r() < 0.5) ar = belt(Math.max(1.6, frost * 0.7));
      const e = lerp(0.3, 0.6, r());
      // 近日点也得离母星够远
      const a = Math.max((ar * 1.6) / (1 - e), 2.5 / (1 - e), frost * 1.5);
      planets.push(mk('gas', a, e));
      outerAr = a * (1 + e);
      if (r() < 0.5) planets.push(mk('ice', outerAr * lerp(1.6, 2.2, r())));
      break;
    }
    case 'sparse': {
      const n = Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        if (r() < 0.5) inner(1, ['rocky', 'super'], [1.5, 2.5]);
        else giantsFrom(Math.max(outerAr, 1.5), r() < 0.6 ? 1 : 0, r() < 0.4 ? 1 : 0);
      }
      break;
    }
    case 'nogiant': {
      inner(1 + Math.floor(r() * 3), ['rocky', 'super'], [1.35, 1.8]);
      let ar = outer(['rocky', 'super', 'dwarf'], 1 + Math.floor(r() * 3), [1.35, 1.8]);
      const nb = r() < 0.4 ? 2 : r() < 0.7 ? 1 : 0;
      for (let k = 0; k < nb; k++) ar = belt(ar * 1.3) * lerp(1.5, 2.5, r());
      break;
    }
  }
  // 伴星留出的地方:S 型只留伴星间距 1/3 以内,P 型只留 3.5 倍间距以外(都按母星距离的倍数比)
  const keep = (ar: number) => !companion || (companion.mode === 'S' ? ar * aH < companion.sep / 3 : ar * aH > companion.sep * 3.5);
  const kept = planets.filter((p) => keep(p.ar * (1 + p.e)) && keep(p.ar * (1 - p.e)));
  // 稳定:按距离排,太挤的去掉(巨行星旁周期比 1.6、别的 1.3);不扫母星
  kept.sort((a, b) => a.ar - b.ar);
  const stable: PlanetSpec[] = [];
  let prev = { ar: 1, giant: false };
  const home = { ar: 1, giant: false };
  const all = [...kept.filter((p) => p.ar < 1).reverse()];
  // 先往里:从母星开始往内一颗颗看
  for (const p of all) {
    const ratio = prev.ar / p.ar;
    const need = Math.pow(giant(p.kind) || prev.giant ? 1.6 : 1.3, 2 / 3);
    const sweep = giant(p.kind) && p.ar * (1 + p.e) * 2.5 > 1;
    if (ratio >= need && !sweep && !(p.kind === 'gas' && arch === 'hotjup' ? false : false)) {
      stable.push(p);
      prev = { ar: p.ar, giant: giant(p.kind) };
    }
  }
  prev = home;
  for (const p of kept.filter((q) => q.ar >= 1)) {
    const ratio = p.ar / prev.ar;
    const need = Math.pow(giant(p.kind) || prev.giant ? 1.6 : 1.3, 2 / 3);
    const sweep = giant(p.kind) && p.ar * (1 - p.e) < 2.5;
    if (ratio >= need && !sweep) {
      stable.push(p);
      prev = { ar: p.ar, giant: giant(p.kind) };
    }
  }
  // 热木星:贴着恒星的那颗巨行星照留(它在母星里面很远)
  if (arch === 'hotjup') {
    const hj = planets.find((p) => p.kind === 'gas' && p.ar * aH < 0.1);
    if (hj && keep(hj.ar) && !stable.includes(hj)) stable.push(hj);
  }
  stable.sort((a, b) => a.ar - b.ar);
  // 倾角(对黄道 = 母星的轨道面):另一路随机数,不动上面的行星布局。紧凑型很平;类太阳系 0–5°、偶尔 5–8°;
  // 偏心巨行星、热木星外侧的巨行星四成 10–40°(被别的行星甩过);另有一成系统,外侧随机一颗错开 10–35°
  const ri = rng(subSeed(seed, 'system-incl'));
  for (const p of stable) {
    const base = arch === 'compact' ? lerp(0, 2, ri()) : arch === 'solar' ? (ri() < 0.15 ? lerp(5, 8, ri()) : lerp(0, 5, ri())) : lerp(0, 4, ri());
    const tossed = (arch === 'eccentric' || arch === 'hotjup') && giant(p.kind) && p.ar > 1 && ri() < 0.4;
    p.incl = tossed ? lerp(10, 40, ri()) : base;
  }
  const outerOnes = stable.filter((p) => p.ar > 1);
  if (outerOnes.length && ri() < 0.1) outerOnes[Math.floor(ri() * outerOnes.length)].incl = lerp(10, 35, ri());
  // 温室:5–65°C(大气厚薄各不相同;金星那种几百度的、火星那种几度的都算在两头),小行星按大小打折
  const rg = rng(subSeed(seed, 'system-greenhouse'));
  for (const p of stable) if (p.kind === 'rocky' || p.kind === 'super') p.greenhouse = Math.round(Math.min(greenhouseCap(p.radius), lerp(0, 100, rg() ** 1.3) * Math.min(1, p.radius / (0.8 * HOME_RADIUS))));
  // 宜居候选:有大小合适的岩质行星的系统里,离母星最近的那颗六成机会大气刚好(温室抵掉冷热)、能选它当母星;第二颗五成
  // (按气温参数 0 估平衡温度;温室不超过按大小的上限 greenhouseCap)
  // 地表 = 平衡温度(看反照率)+ 温室:温室不超过按大小的上限,反照率 0.05(深色陆地)–0.7(厚云);
  // 两样一起凑到 15 ± 8°C 就算凑成(内侧太热的靠云多反光,外侧太冷的靠厚大气)
  const fits = stable
    .filter((p) => (p.kind === 'rocky' || p.kind === 'super') && p.radius >= 0.6 * HOME_RADIUS && p.radius <= 1.5 * HOME_RADIUS)
    .sort((a, b) => Math.abs(Math.log(a.ar)) - Math.abs(Math.log(b.ar)));
  let made = 0;
  for (const p of fits) {
    if (made >= 2) break;
    const go = rg() < (made === 0 ? 0.6 : 0.5);
    const want = 15 + lerp(-8, 8, rg());
    const cap = greenhouseCap(p.radius);
    const base = 278 * Math.pow(p.ar, -0.5);
    for (const g of [lerp(5, cap, rg()), cap, 5]) {
      const A = 1 - Math.pow((want - g + 273) / base, 4);
      if (A >= 0.05 && A <= 0.7) {
        if (go) {
          p.greenhouse = Math.round(g);
          p.albedo = A;
          made++;
        }
        break;
      }
    }
  }
  const okBelts = belts.filter((b) => keep(b.inner) && keep(b.outer) && !stable.some((p) => p.ar > b.inner * 0.95 && p.ar < b.outer * 1.05));
  return { star, ...(companion ? { companion } : {}), arch, planets: stable, belts: okBelts, home: { e: lerp(0, 0.03, r()), tilt: lerp(15, 30, r()), axisLon: r() * 360 } };
}

/**
 * 母星离恒星多远(AU):没换过母星的按 fluxOfTemp(地球那样的大气);换过的按它自己的温室、反照率,
 * 让"平衡温度 + 温室 − 15 = 气温参数"
 */
export function homeDistance(spec: SystemSpec, lum: number, temperature: number): number {
  const g = spec.home.greenhouse;
  if (g === undefined) return Math.sqrt(lum / fluxOfTemp(temperature));
  const alb = spec.home.albedo ?? 0.3;
  const teqK = Math.max(60, temperature + 15 - g + 273);
  return Math.pow((278 * Math.pow(1 - alb, 0.25) * Math.pow(lum, 0.25)) / teqK, 2);
}

/**
 * 温室最多能有多强(°C):越小的引力越弱,留不住厚大气(火星就是这样丢了大气)。
 * 半径(地球 = 1)< 0.5 约 10;0.5–0.9 从 10 到 40;0.9–1.2 从 40 到 100;1.2–1.6 从 100 到 200
 */
export function greenhouseCap(radius: number): number {
  const r = radius / HOME_RADIUS;
  const seg = (a: number, b: number, x0: number, x1: number) => a + ((b - a) * (Math.min(x1, Math.max(x0, r)) - x0)) / (x1 - x0);
  if (r < 0.5) return 10;
  if (r < 0.9) return seg(10, 40, 0.5, 0.9);
  if (r < 1.2) return seg(40, 100, 0.9, 1.2);
  return seg(100, 200, 1.2, 1.6);
}

/** 没写温室的岩质行星:按大小估(地球大小 = 地球的 33°C) */
export function greenhouseOf(radius: number): number {
  return Math.round(33 * Math.min(1, radius / (0.8 * HOME_RADIUS)));
}

/**
 * 换母星:把规格里的第 key 颗当成新的母星 —— 别的行星按新母星的距离重新换算倍数,原来的母星变成一颗普通的岩质行星(地球大小、留在原来的轨道上)。
 * 返回新规格;世界参数(种子、气温……)由调用方按 planetWorldParams 换
 */
export function promoteToHome(spec: SystemSpec, key: number): SystemSpec {
  const c = spec.planets.find((p) => p.key === key);
  if (!c) return spec;
  const k = c.ar;
  const nextKey = Math.max(0, ...spec.planets.map((p) => p.key)) + 1;
  const oldHome: PlanetSpec = {
    key: nextKey,
    kind: 'rocky',
    ar: 1 / k,
    e: spec.home.e,
    incl: c.incl,
    node: (c.node + 180) % 360,
    m0: 0,
    radius: HOME_RADIUS,
    ringed: false,
    moons: [{ key: nextKey * 10, radius: 1737, dist: 60 }],
    small: 0,
    color: [120, 150, 190],
    albedo: 0.3,
    greenhouse: 33,
  };
  const planets = [...spec.planets.filter((p) => p.key !== key).map((p) => ({ ...p, ar: p.ar / k })), oldHome].sort((a, b) => a.ar - b.ar);
  return { ...spec, planets, belts: spec.belts.map((b) => ({ ...b, inner: b.inner / k, outer: b.outer / k })), home: { ...spec.home, e: c.e, greenhouse: c.greenhouse ?? greenhouseOf(c.radius), albedo: c.albedo } };
}

/** 规格 + 气温参数 → 实体 */
export function realizeSystem(spec: SystemSpec, temperature = 0): StarSystem {
  const star = starOf(spec.star);
  const c = spec.companion ? starOf(spec.companion.star) : null;
  const lum = star.lum + (c && spec.companion!.mode === 'P' ? c.lum : 0);
  const mass = star.mass + (c && spec.companion!.mode === 'P' ? c.mass : 0);
  const homeA = homeDistance(spec, lum, temperature);
  const flux = lum / (homeA * homeA);
  const period = (a: number) => Math.sqrt((a * a * a) / mass);
  const teq = (a: number, alb: number) => Math.round(278 * Math.pow(lum, 0.25) * Math.pow(a, -0.5) * Math.pow(1 - alb, 0.25) - 273);
  const planets: Planet[] = spec.planets.map((p) => {
    const a = p.ar * homeA;
    const tq = teq(a, p.albedo);
    const solid = p.kind === 'rocky' || p.kind === 'super';
    const gh = solid ? (p.greenhouse ?? greenhouseOf(p.radius)) : 0;
    const surface = Math.round(tq + gh);
    const habitable = solid && p.radius >= 0.6 * HOME_RADIUS && p.radius <= 1.5 * HOME_RADIUS && Math.abs(surface - 15) <= 12;
    return { key: p.key, kind: p.kind, a, e: p.e, incl: p.incl, node: p.node, m0: p.m0, period: period(a), radius: p.radius, color: p.color, ringed: p.ringed, moons: p.moons.length + p.small, major: p.moons, albedo: p.albedo, teq: tq, greenhouse: gh, surface, habitable };
  });
  planets.push({ key: 0, kind: 'home', a: homeA, e: spec.home.e, incl: 0, node: 0, m0: 0, period: period(homeA), radius: HOME_RADIUS, color: [70, 130, 210], ringed: false, moons: 1, major: [], albedo: 0.3, teq: teq(homeA, 0.3), greenhouse: 33, surface: 15 + temperature, habitable: true });
  planets.sort((x, y) => x.a - y.a);
  const belts = spec.belts.map((b) => ({ inner: b.inner * homeA, outer: b.outer * homeA, count: b.count }));
  const comp = c && spec.companion ? { ...c, mode: spec.companion.mode, sep: spec.companion.sep, e: spec.companion.e, period: Math.sqrt(Math.pow(spec.companion.sep, 3) / (star.mass + c.mass)) } : undefined;
  return {
    spec,
    arch: spec.arch,
    star,
    ...(comp ? { companion: comp } : {}),
    lum,
    hz: [Math.sqrt(lum / 1.1), Math.sqrt(lum / 0.53)],
    planets,
    home: planets.findIndex((p) => p.kind === 'home'),
    flux,
    yearDays: period(homeA) * 365.25,
    tilt: spec.home.tilt,
    axisLon: spec.home.axisLon,
    belts,
    ...(belts[0] ? { belt: { inner: belts[0].inner, outer: belts[0].outer } } : {}),
    frost: 2.7 * Math.sqrt(lum),
  };
}

/** seed = 世界种子;temperature = 世界的气温参数(°C);spec = 编辑过的规格(不给 = 按种子随机) */
export function generateSystem(seed: number, temperature = 0, spec?: SystemSpec): StarSystem {
  return realizeSystem(spec ?? randomSpec(seed), temperature);
}

// ---------------------------------------------------------------------------------------------------------------- 位置

function kepler(M: number, e: number): number {
  let E = M;
  for (let k = 0; k < 8; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** t 标准年这颗行星的位置(AU;x、y 在黄道面上,z 朝北) */
export function planetAt(p: Planet, t: number): [number, number, number] {
  const M = ((((p.m0 / 360 + t / p.period) % 1) + 1) % 1) * 2 * Math.PI;
  const E = kepler(M, p.e);
  const xo = p.a * (Math.cos(E) - p.e);
  const yo = p.a * Math.sqrt(1 - p.e * p.e) * Math.sin(E);
  return orbitToEcliptic(xo, yo, p);
}

export function orbitToEcliptic(xo: number, yo: number, p: { node: number; incl: number }): [number, number, number] {
  const O = (p.node * Math.PI) / 180, i = (p.incl * Math.PI) / 180;
  const x1 = xo * Math.cos(O) - yo * Math.cos(i) * Math.sin(O);
  const y1 = xo * Math.sin(O) + yo * Math.cos(i) * Math.cos(O);
  return [x1, y1, yo * Math.sin(i)];
}

/**
 * t 标准年两颗恒星的位置(AU):P 型绕共同质心互绕;S 型主星在原点附近(只挪一点),伴星在远处慢慢绕。没有伴星 = 主星在原点
 */
export function starsAt(sys: StarSystem, t: number): { primary: [number, number, number]; companion?: [number, number, number] } {
  const c = sys.companion;
  if (!c) return { primary: [0, 0, 0] };
  const q = c.mass / (sys.star.mass + c.mass);
  const M = (((t / c.period) % 1) + 1) % 1;
  const E = kepler(M * 2 * Math.PI, c.e);
  const x = c.sep * (Math.cos(E) - c.e), y = c.sep * Math.sqrt(1 - c.e * c.e) * Math.sin(E);
  return { primary: [-x * q, -y * q, 0], companion: [x * (1 - q), y * (1 - q), 0] };
}

/** t 标准年月亮相对母星的位置(km) */
export function lunaAt(t: number): [number, number, number] {
  const ang = ((t * 365.25) / LUNA.periodDays) * 2 * Math.PI;
  const i = (LUNA.incl * Math.PI) / 180;
  return [LUNA.a * Math.cos(ang), LUNA.a * Math.sin(ang) * Math.cos(i), LUNA.a * Math.sin(ang) * Math.sin(i)];
}

/** 母星的朝向:t 标准年时星体坐标 → 黄道坐标(一天 24 小时转一圈 + 每公转一圈多转一圈) */
export function homeSpin(sys: StarSystem, t: number): (v: [number, number, number]) => [number, number, number] {
  const P = sys.planets[sys.home].period;
  const th = 2 * Math.PI * t * (365.25 + 1 / P);
  const e = (sys.tilt * Math.PI) / 180, l = (sys.axisLon * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th), ce = Math.cos(e), se = Math.sin(e), cl = Math.cos(l), sl = Math.sin(l);
  return ([x, y, z]) => {
    const x1 = x * ct - y * st, y1 = x * st + y * ct;
    const y2 = y1 * ce - z * se, z2 = y1 * se + z * ce;
    return [x1 * cl - y2 * sl, x1 * sl + y2 * cl, z2];
  };
}

export function homeSpinInv(sys: StarSystem, t: number): (v: [number, number, number]) => [number, number, number] {
  const P = sys.planets[sys.home].period;
  const th = 2 * Math.PI * t * (365.25 + 1 / P);
  const e = (sys.tilt * Math.PI) / 180, l = (sys.axisLon * Math.PI) / 180;
  const ct = Math.cos(th), st = Math.sin(th), ce = Math.cos(e), se = Math.sin(e), cl = Math.cos(l), sl = Math.sin(l);
  return ([x, y, z]) => {
    const x1 = x * cl + y * sl, y2 = -x * sl + y * cl;
    const y1 = y2 * ce + z * se, z1 = -y2 * se + z * ce;
    return [x1 * ct + y1 * st, -x1 * st + y1 * ct, z1];
  };
}

// ---------------------------------------------------------------------------------------------------------------- 存档

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null);
const ARCHES: readonly Arch[] = ['solar', 'compact', 'hotjup', 'eccentric', 'sparse', 'nogiant'];
const KINDS: readonly PlanetSpec['kind'][] = ['rocky', 'super', 'mini', 'gas', 'ice', 'dwarf'];

function cleanStar(o: unknown): StarSpec | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>;
  const cls = STAR_CLASSES.includes(x.cls as StarClass) ? (x.cls as StarClass) : null;
  const sub = num(x.sub, 0, 9);
  if (!cls || sub === null) return null;
  const [lo, hi] = CLASS_MASS[cls];
  const mass = num(x.mass, lo, hi) ?? massOf(cls, Math.round(sub));
  return { cls, sub: Math.round(sub), mass };
}

/** 存档里读回来的规格:认不出的项丢掉,数夹到合理范围;整个认不出 = null(按种子随机) */
export function cleanSystemSpec(o: unknown): SystemSpec | null {
  if (!o || typeof o !== 'object') return null;
  const x = o as Record<string, unknown>;
  const star = cleanStar(x.star);
  if (!star) return null;
  let companion: SystemSpec['companion'];
  if (x.companion && typeof x.companion === 'object') {
    const c = x.companion as Record<string, unknown>;
    const cs = cleanStar(c.star);
    const mode = c.mode === 'P' || c.mode === 'S' ? c.mode : null;
    const sep = num(c.sep, mode === 'P' ? 0.02 : 5, mode === 'P' ? 1 : 1000);
    if (cs && mode && sep !== null) companion = { star: cs, mode, sep, e: num(c.e, 0, 0.8) ?? 0 };
  }
  const planets: PlanetSpec[] = [];
  for (const p of Array.isArray(x.planets) ? x.planets.slice(0, 16) : []) {
    if (!p || typeof p !== 'object') continue;
    const q = p as Record<string, unknown>;
    const kind = KINDS.includes(q.kind as PlanetSpec['kind']) ? (q.kind as PlanetSpec['kind']) : null;
    const ar = num(q.ar, 0.01, 500);
    if (!kind || ar === null) continue;
    const [r0, r1] = RADIUS[kind];
    const moons: MoonSpec[] = [];
    for (const m of Array.isArray(q.moons) ? q.moons.slice(0, 8) : []) {
      const mm = m as Record<string, unknown>;
      const radius = num(mm?.radius, 50, 3000), dist = num(mm?.dist, 2, 200);
      if (radius !== null && dist !== null) moons.push({ key: Math.round(num(mm.key, 0, 1e6) ?? moons.length), radius, dist });
    }
    const col = Array.isArray(q.color) && q.color.length === 3 && q.color.every((v) => typeof v === 'number') ? (q.color.map((v) => Math.max(0, Math.min(255, Math.round(v as number)))) as [number, number, number]) : COLORS[kind][0];
    planets.push({
      key: Math.round(num(q.key, 1, 1e6) ?? planets.length + 1),
      kind,
      ar,
      e: num(q.e, 0, 0.9) ?? 0,
      incl: num(q.incl, 0, 30) ?? 0,
      node: num(q.node, 0, 360) ?? 0,
      m0: num(q.m0, 0, 360) ?? 0,
      radius: num(q.radius, r0 * 0.5, r1 * 1.5) ?? (r0 + r1) / 2,
      ringed: q.ringed === true,
      moons,
      small: Math.round(num(q.small, 0, 200) ?? 0),
      color: col,
      albedo: num(q.albedo, 0.02, 0.9) ?? 0.3,
      ...(num(q.greenhouse, 0, 600) !== null ? { greenhouse: num(q.greenhouse, 0, 600)! } : {}),
    });
  }
  const belts: BeltSpec[] = [];
  for (const b of Array.isArray(x.belts) ? x.belts.slice(0, 3) : []) {
    const bb = b as Record<string, unknown>;
    const inner = num(bb?.inner, 0.05, 500), outer = num(bb?.outer, 0.05, 600);
    if (inner !== null && outer !== null && outer > inner) belts.push({ inner, outer, count: Math.round(num(bb.count, 100, 3000) ?? 800) });
  }
  const h = (x.home && typeof x.home === 'object' ? x.home : {}) as Record<string, unknown>;
  return {
    star,
    ...(companion ? { companion } : {}),
    arch: ARCHES.includes(x.arch as Arch) ? (x.arch as Arch) : 'solar',
    planets: planets.sort((a, b) => a.ar - b.ar),
    belts,
    home: {
      e: num(h.e, 0, 0.2) ?? 0.01,
      tilt: num(h.tilt, 0, 60) ?? 23,
      axisLon: num(h.axisLon, 0, 360) ?? 0,
      ...(num(h.greenhouse, 0, 600) !== null ? { greenhouse: num(h.greenhouse, 0, 600)! } : {}),
      ...(num(h.albedo, 0.02, 0.9) !== null ? { albedo: num(h.albedo, 0.02, 0.9)! } : {}),
    },
  };
}

/** 新加一颗:按种类给典型的大小、颜色、卫星(编辑器"+ 某种行星") */
export function newPlanetSpec(kind: PlanetSpec['kind'], ar: number, key: number): PlanetSpec {
  const [r0, r1] = RADIUS[kind];
  const [a0, a1] = ALBEDO[kind];
  const g = giant(kind);
  return {
    key,
    kind,
    ar,
    e: 0.02,
    incl: 1,
    node: (key * 137) % 360,
    m0: (key * 83) % 360,
    radius: (r0 + r1) / 2,
    ringed: false,
    moons: g ? [{ key: key * 10, radius: 1500, dist: 15 }, { key: key * 10 + 1, radius: 1000, dist: 28 }] : [],
    small: g ? 12 : 0,
    color: COLORS[kind][key % COLORS[kind].length],
    albedo: (a0 + a1) / 2,
  };
}

/** 这份规格有哪些不稳的地方(编辑器提示,不拦):相邻太挤、巨行星扫过母星、在伴星留出的地方以外 */
export function specWarnings(spec: SystemSpec): string[] {
  const out: string[] = [];
  const ps = [...spec.planets.map((p) => ({ ar: p.ar, e: p.e, g: giant(p.kind), key: p.key })), { ar: 1, e: spec.home.e, g: false, key: 0 }].sort((a, b) => a.ar - b.ar);
  for (let i = 1; i < ps.length; i++) {
    const need = Math.pow(ps[i].g || ps[i - 1].g ? 1.6 : 1.3, 2 / 3);
    if (ps[i].ar / ps[i - 1].ar < need) out.push(`${ps[i - 1].key ? `行星 ${ps[i - 1].key}` : '母星'}和${ps[i].key ? `行星 ${ps[i].key}` : '母星'}挨得太近,轨道不稳`);
  }
  for (const p of spec.planets) if (giant(p.kind) && p.ar * (1 - p.e) < 2.5 && p.ar * (1 + p.e) * 2.5 > 1 && p.ar * (1 + p.e) > 0.15) out.push(`行星 ${p.key} 是巨行星,轨道离母星太近,会把母星甩出去`);
  return out;
}
