/**
 * 本地分支 modern-pace:月球的地名和着陆点(编年史、航天页共用)。
 *
 * 地形见 gen/moon.ts(只由种子决定)。这里用 128 宽的小图判"某点在不在月海里",名字只按地物清单取(和分辨率无关),
 * 所以航天页画 1024 宽的大图、标的名字和编年史里写的一样。
 *   - 月海:正面低地那片叫"某某洋";盆地灌成的叫"某某海"(半径 180 km 以下的叫"某某湖")。字从 MARE_WORDS 里按种子洗牌取。
 *   - 环形山:最大的 CRATER_NAMES 个(灌成月海的盆地除外)按人名命名,"某某环形山";半径 150 km 以上没灌平的叫"某某盆地"。
 *     人名轮流用进了电气时代的各国的民族语感(照真月球:环形山以各国科学家命名)。
 *   - 地点描述:"静海南部""某某环形山内""某某环形山以北""月球高地";月背的前面加"月球背面";另给经纬度。
 */
import type { Civ } from '../types';
import { MOON_R, generateMoon, type Moon } from '../../moon';
import { personNamers } from '../naming';

export interface MoonPlace {
  kind: 'ocean' | 'mare' | 'lake' | 'crater' | 'basin';
  name: string;
  lon: number;
  lat: number;
  /** 半径 km */
  r: number;
}

export interface MoonAtlas {
  /** 128 宽的小图(判月海用) */
  moon: Moon;
  maria: MoonPlace[];
  craters: MoonPlace[];
}

const MARE_WORDS = ['宁', '澄', '霜', '晨', '暮', '镜', '银', '幽', '春', '秋', '岚', '雪', '虹', '潮', '寒', '晴', '雾', '星', '沙', '渊', '青', '玄', '霞', '梦', '澜', '汐', '烟', '露', '冰', '远', '寂', '虚', '苍', '琥珀', '翡翠', '珊瑚', '长风', '流云', '归鸿', '回声'];
const OCEAN_WORDS = ['长夜', '无垠', '苍茫', '寂寥', '永昼', '沉眠'];
/** 起名的环形山个数 */
const CRATER_NAMES = 70;

const hash = (a: number, b: number, c = 0) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

function shuffled<T>(a: readonly T[], seed: number, salt: number): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(hash(seed % 100003, salt, i) * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const cache = new WeakMap<Civ, MoonAtlas>();
const moons = new Map<number, Moon>();

/** 这个世界的月球小图(128 宽,按种子缓存) */
export function smallMoon(seed: number): Moon {
  let m = moons.get(seed);
  if (!m) {
    if (moons.size > 8) moons.clear();
    moons.set(seed, (m = generateMoon(seed, 128)));
  }
  return m;
}

export function moonAtlas(civ: Civ): MoonAtlas {
  const hit = cache.get(civ);
  if (hit) return hit;
  const moon = smallMoon(civ.seed);
  const words = shuffled(MARE_WORDS, civ.seed, 1);
  const oceans = shuffled(OCEAN_WORDS, civ.seed, 2);
  let wi = 0;
  const maria: MoonPlace[] = moon.maria.map((m, i) => {
    if (m.lowland) return { kind: 'ocean', name: `${oceans[i % oceans.length]}洋`, lon: m.lon, lat: m.lat, r: m.r };
    const w = words[wi++ % words.length];
    return m.r < 180 ? { kind: 'lake', name: `${w}湖`, lon: m.lon, lat: m.lat, r: m.r } : { kind: 'mare', name: `${w}海`, lon: m.lon, lat: m.lat, r: m.r };
  });
  // 起名用的语感:进了电气时代的国家的民族(没有就全部民族),按编号
  const styles: string[] = [];
  for (const p of civ.polities) {
    if ((p.modern?.length ?? 0) < 2) continue;
    const st = civ.cultures[p.culture]?.style;
    if (st && !styles.includes(st)) styles.push(st);
  }
  if (!styles.length) for (const c of civ.cultures) if (c.style && !styles.includes(c.style)) styles.push(c.style);
  if (!styles.length) styles.push('kingdom');
  const nm = personNamers(civ.seed);
  const used = new Set(maria.map((m) => m.name));
  const craters: MoonPlace[] = [];
  const flooded = new Set(moon.maria.filter((m) => !m.lowland).map((m) => `${m.lon},${m.lat}`));
  let k = 0;
  for (const c of moon.craters) {
    if (craters.length >= CRATER_NAMES) break;
    if (flooded.has(`${c.lon},${c.lat}`)) continue;
    let name = '';
    for (let t = 0; t < 6 && (!name || used.has(name)); t++, k++) {
      const n = nm(styles[k % styles.length]);
      const a = 90001 + k * 7;
      // 带姓的语感用全名(只用姓太容易重),不带姓的用名
      name = n.surnamed ? `${n.surname(a, 5)}${n.given(a, 2)}` : n.given(a, 3);
    }
    used.add(name);
    const basin = c.r >= 150;
    craters.push({ kind: basin ? 'basin' : 'crater', name: `${name}${basin ? '盆地' : '环形山'}`, lon: c.lon, lat: c.lat, r: c.r });
  }
  const out = { moon, maria, craters };
  cache.set(civ, out);
  return out;
}

const RAD = Math.PI / 180;
function vec(lon: number, lat: number): [number, number, number] {
  return [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
}
/** 球面上两点的距离 km */
export function moonDist(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const a = vec(lon1, lat1), b = vec(lon2, lat2);
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * MOON_R;
}
/** 从 (lon, lat) 往方位 brg(度,0 北 90 东)走 km 公里 */
export function moonOffset(lon: number, lat: number, brg: number, km: number): { lon: number; lat: number } {
  const d = km / MOON_R, b = brg * RAD, p = lat * RAD;
  const lat2 = Math.asin(Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b));
  const lon2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * Math.sin(lat2));
  let L = lon2 / RAD;
  L = ((((L + 180) % 360) + 360) % 360) - 180;
  return { lon: L, lat: lat2 / RAD };
}
/** a 看 b 在哪个方位(度,0 北 90 东) */
function bearing(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}
const DIR8 = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const dir8 = (b: number) => DIR8[Math.round(b / 45) % 8];

/** 小图上这点的月海值 0..1 */
export function mareAt(m: Moon, lon: number, lat: number): number {
  const x = Math.min(m.w - 1, Math.max(0, Math.floor(((lon + 180) / 360) * m.w)));
  const y = Math.min(m.h - 1, Math.max(0, Math.floor(((90 - lat) / 180) * m.h)));
  return m.mare[y * m.w + x];
}

/** 正面 / 背面:经度 ±90° 以外是背面(对地球看不见,着陆要中继卫星) */
export const farSide = (lon: number) => Math.abs(lon) > 90;

/** "北纬 3.2°、东经 23.5°" */
export function moonCoordText(lon: number, lat: number): string {
  const f = (v: number) => Math.abs(v).toFixed(1).replace(/\.0$/, '');
  return `${lat >= 0 ? '北纬' : '南纬'} ${f(lat)}°、${lon >= 0 ? '东经' : '西经'} ${f(lon)}°`;
}

/** 这一点叫什么:"宁海南部""某某环形山内""某某环形山以北""月球高地"(月背的前面加"月球背面") */
export function moonPlaceName(at: MoonAtlas, lon: number, lat: number): string {
  const back = farSide(lon) ? '月球背面' : '';
  // 在哪个起了名的环形山里(取最小的那个)
  let inside: MoonPlace | null = null;
  for (const c of at.craters) if (moonDist(lon, lat, c.lon, c.lat) < c.r && (!inside || c.r < inside.r)) inside = c;
  if (inside) return `${back}${inside.name}${inside.kind === 'basin' ? '' : '内'}`;
  if (mareAt(at.moon, lon, lat) > 0.45) {
    let best: MoonPlace | null = null;
    let bs = Infinity;
    for (const m of at.maria) {
      const s = moonDist(lon, lat, m.lon, m.lat) / m.r;
      if (s < bs) { bs = s; best = m; }
    }
    if (best) {
      if (bs < 0.4) return `${back}${best.name}`;
      return `${back}${best.name}${dir8(bearing(best.lon, best.lat, lon, lat))}部`;
    }
  }
  let near: MoonPlace | null = null;
  let ns = Infinity;
  for (const c of at.craters) {
    const s = (moonDist(lon, lat, c.lon, c.lat) - c.r) / c.r;
    if (s < 2.5 && s < ns) { ns = s; near = c; }
  }
  if (near) return `${back}${near.name}以${dir8(bearing(near.lon, near.lat, lon, lat))}`;
  return back ? '月球背面高地' : '月球高地';
}

/**
 * 自动挑的着陆点:正面低纬的月海(越大越可能、越靠赤道越可能),海里随机一点(落在月海上的才要,试几次);
 * 没有合适的月海就挑正面赤道附近一点。k = 第几回挑(同一国的不同任务)
 */
export function autoMoonSite(at: MoonAtlas, pid: number, k: number): { lon: number; lat: number } {
  const cands = at.maria.filter((m) => Math.abs(m.lon) < 75 && Math.abs(m.lat) < 45);
  if (!cands.length) return { lon: Math.round((hash(pid, k, 1) - 0.5) * 60), lat: Math.round((hash(pid, k, 2) - 0.5) * 30) };
  // 按半径的平方根加权:大洋不至于把人全吸过去
  const wts = cands.map((m) => Math.sqrt(m.r) * Math.cos(m.lat * RAD));
  let u = hash(pid, k, 3) * wts.reduce((a, b) => a + b, 0);
  let m = cands[cands.length - 1];
  for (let i = 0; i < cands.length; i++) if ((u -= wts[i]) <= 0) { m = cands[i]; break; }
  // 海里随机一点,落在月海上的才要;试不出来就取试过的里头月海值最高的那一点(不退回中心,免得各国挤在一处)
  let best = { lon: m.lon, lat: m.lat };
  let bv = -1;
  for (let t = 0; t < 24; t++) {
    const p = moonOffset(m.lon, m.lat, hash(pid, k, 10 + t) * 360, Math.sqrt(hash(pid, k, 40 + t)) * 0.7 * m.r);
    if (Math.abs(p.lon) >= 85 || Math.abs(p.lat) > 60) continue;
    const v = mareAt(at.moon, p.lon, p.lat);
    if (v > 0.6) return p;
    if (v > bv) { bv = v; best = p; }
  }
  return best;
}
