/**
 * 本地分支 modern-pace 第六十轮:城市带 —— 推演完以后算哪些城连成了一片、叫什么,不改推演。纯计算。
 *
 * 建成区:每座城按人口和电气化程度(人均占地 60–300 m²)算一块建成区,半径再放大 3.5 倍(地图上看得见;和核爆闪光一样夸张),
 *         白天的城市层(CityLayer)和这里用同一个半径(builtRadiusKm)
 * 连片:   近代(世上头一个国家进工业)以后,每 10 年看一次:同一个国家的两座城(都 ≥ 30 万人)离得比两块建成区半径之和的 1.6 倍还近(通勤圈相接),
 *         就算连上;连通的一串(≥ 2 座)= 一条城市带。前后两次按共有的城认作同一条(名字不变)
 * 并为区: 小城(不到大城人口的 15%)离大城不到 1.5 个建成区半径 = 大城的一区:地图上平常不单独标,放大到街区一级才写区名
 * 起名:   挨着有名字的湾 → "某某湾区";大河的河口在带里 → "某某三角洲";大河穿过 → "某某河谷"("某某江流域");都不是 → "大某某"(最大那座城)。
 *         起了就不改(带子长大、最大的城换了也照旧叫)
 * 坐标:   推演结果里没有坐标,按 civMesh.ts 登记的网格算;没登记(还没拿到世界)= 没有城市带
 */
import type { Civ, Year } from '../types';
import { capitalAt, populationAt } from '../growth';
import { NAME_STYLES } from '../../names';
import { regionLabel, regionNamed } from './display';
import { CAP_COUNT, developmentAt } from '../development';
import { ownersAt } from '../engine/timeline';
import { KM_PER_UNIT } from '../scale';
import { civMesh, type CivMesh } from './civMesh';
import { cityNameAt } from './cityNames';
import type { ChronicleEntry } from './chronicle';
import { isNameToken, nameForm } from '../nameToken';

/** 建成区的地图半径(公里,已放大 3.5 倍):popK = 千人,elec = 电气化程度 0–1 */
export function builtRadiusKm(popK: number, elec: number): number {
  if (!(popK > 0)) return 0;
  return 3.5 * Math.sqrt((popK * (0.06 + 0.24 * Math.max(0, Math.min(1, elec)))) / Math.PI);
}

/** 一州的电气化程度(生产能力 5.5 → 7 对应 0 → 1;和夜景灯光同一个口径) */
export const elecOfProd = (prod: number) => Math.max(0, Math.min(1, (prod - 5.5) / 1.5));

export interface CityBelt {
  id: number;
  /** 按地名起的:civ.places 的下标 + 后缀(湾区 / 三角洲 / 谷 / 流域);没有 = "大" + core 成形那年的名字。名字显示时按那份历史拼(beltName) */
  place?: number;
  suffix?: string;
  /**
   * 不按地名起的叫法(第六十二轮):capital = 国都名 + 都市圈;abbr = 各城首字连起来(东方语感,京津);pair = 城名连写(西方语感,达拉斯–沃斯堡);
   * metro = 核心城所在州的州名 + 都会区;没有 = "大" + core
   */
  kind?: 'capital' | 'abbr' | 'pair' | 'metro';
  cities?: number[];
  region?: number;
  from: Year;
  /** 不再连片的那一年(没有 = 一直到最后) */
  to?: Year;
  /** 成形时最大的那座城 */
  core: number;
}

interface Sample {
  year: Year;
  /** 每座城属于哪条带(-1 = 不属于) */
  beltOf: Int32Array;
  /** 每座城是哪座城的一区(-1 = 不是) */
  districtOf: Int32Array;
}

interface Ev {
  year: Year;
  kind: 'form' | 'district' | 'end';
  belt?: number;
  members?: number[];
  small?: number[];
  big?: number;
  split?: boolean;
}

export interface Belts {
  belts: CityBelt[];
  samples: Sample[];
  events: Ev[];
}

const EMPTY: Belts = { belts: [], samples: [], events: [] };
const cache = new WeakMap<Civ, Belts>();
const STEP = 10;
const MIN_POP = 300;
/** 连片:两城距离 < 两块建成区半径之和 × 这个数(城与城之间的郊区、通勤走廊连起来;城市层沿路画走廊) */
export const LINK_K = 1.6;
/** 并为区:小城离大城不到大城建成区半径 × 这个数 */
export const DISTRICT_K = 1.5;

/** 网格上离 (x, y) 最近的地块(粗查;只用来看端点是不是海岸) */
function nearestCell(m: CivMesh, grid: Map<string, number[]>, gs: number, x: number, y: number): number {
  const gx = Math.floor(x / gs), gy = Math.floor(y / gs);
  let best = -1, bd = Infinity;
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++)
      for (const i of grid.get(`${gx + a},${gy + b}`) ?? []) {
        const d = (m.x[i] - x) ** 2 + (m.y[i] - y) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
  return best;
}

export function cityBelts(civ0: Civ): Belts {
  const civ = civ0.history ?? civ0;
  const hit = cache.get(civ);
  if (hit) return hit;
  const mesh = civMesh(civ0) ?? civMesh(civ);
  if (!mesh) return EMPTY;
  const S = civ.settlements;
  if (!S.length || !civ.viable) {
    cache.set(civ, EMPTY);
    return EMPTY;
  }
  let modern = Infinity;
  for (const p of civ.polities) if (p.modern?.length && p.modern[0] < modern) modern = p.modern[0];
  const out: Belts = { belts: [], samples: [], events: [] };
  cache.set(civ, out);
  if (!Number.isFinite(modern)) return out;
  const W = mesh.width;
  const KM = KM_PER_UNIT;
  const sx = S.map((s) => mesh.x[s.cell]), sy = S.map((s) => mesh.y[s.cell]);
  const distKm = (i: number, j: number) => {
    let dx = Math.abs(sx[i] - sx[j]);
    dx = Math.min(dx, W - dx);
    return Math.hypot(dx, sy[i] - sy[j]) * KM;
  };
  const distPtKm = (i: number, x: number, y: number) => {
    let dx = Math.abs(sx[i] - x);
    dx = Math.min(dx, W - dx);
    return Math.hypot(dx, sy[i] - y) * KM;
  };
  // 起名要用的地理名、最近地块的格子
  const bays = civ.places.filter((p) => p.kind === 'sea' && (p.defaultName ?? p.name).endsWith('湾'));
  const rivers = civ.places.filter((p) => p.kind === 'river');
  const seas = civ.places.filter((p) => p.kind === 'sea' && !(p.defaultName ?? p.name).endsWith('洋') && !(p.defaultName ?? p.name).endsWith('湾'));
  const gs = 8;
  const cellGrid = new Map<string, number[]>();
  for (let i = 0; i < mesh.n; i++) {
    const k = `${Math.floor(mesh.x[i] / gs)},${Math.floor(mesh.y[i] / gs)}`;
    (cellGrid.get(k) ?? cellGrid.set(k, []).get(k)!).push(i);
  }
  const usedNames = new Set<number>();
  const nameBelt = (members: number[], core: number, rad: number[]): { place?: number; suffix?: string } => {
    const near = (path: Float32Array, i: number, lim: number) => {
      for (let k = 0; k < path.length; k += 2) if (distPtKm(i, path[k], path[k + 1]) <= lim) return true;
      return false;
    };
    const pick = (cands: { place: number; suffix: string }[]) => cands.find((c) => !usedNames.has(c.place));
    // 湾:有城离湾的标注线不远(建成区半径 + 150 公里)
    const bayHits = bays
      .map((b) => ({ b, d: Math.min(...members.map((i) => Math.min(...Array.from({ length: b.path.length / 2 }, (_, k) => distPtKm(i, b.path[k * 2], b.path[k * 2 + 1])) ) - rad[i])) }))
      .filter((h) => h.d <= 150)
      .sort((a, b) => a.d - b.d)
      .map((h) => ({ place: civ.places.indexOf(h.b), suffix: '区' }));
    // 河:至少两座城挨着河(建成区半径 + 120 公里);端点在海岸、又挨着带里的城 = 河口在带里
    const riverHits: { place: number; suffix: string }[] = [];
    for (const r of rivers) {
      const on = members.filter((i) => near(r.path, i, rad[i] + 120));
      if (on.length < 2) continue;
      const ends: [number, number][] = [
        [r.path[0], r.path[1]],
        [r.path[r.path.length - 2], r.path[r.path.length - 1]],
      ];
      const delta = ends.some(([x, y2]) => {
        const c = nearestCell(mesh, cellGrid, gs, x, y2);
        return c >= 0 && civ.habitat.coastDist[c] === 1 && members.some((i) => distPtKm(i, x, y2) <= rad[i] + 60);
      });
      const nm0 = r.defaultName ?? r.name;
      riverHits.push({ place: civ.places.indexOf(r), suffix: delta ? '三角洲' : nm0.endsWith('河') ? '谷' : '流域' });
    }
    // 海:带里两座以上的海岸城,离得最近的那片海(洋、湾以外)是同一片 → "环某某海"
    const seaHits: { place: number; suffix: string }[] = [];
    if (seas.length) {
      const cnt = new Map<number, number>();
      for (const i of members) {
        if (civ.habitat.coastDist[S[i].cell] !== 1) continue;
        let best = -1, bd = Infinity;
        for (const sea of seas) {
          let d = Infinity;
          for (let k = 0; k < sea.path.length; k += 2) d = Math.min(d, distPtKm(i, sea.path[k], sea.path[k + 1]));
          if (d < bd) (bd = d), (best = civ.places.indexOf(sea));
        }
        if (best >= 0 && bd < 1500) cnt.set(best, (cnt.get(best) ?? 0) + 1);
      }
      for (const [pl, c] of [...cnt].sort((a, b) => b[1] - a[1])) if (c >= 2) seaHits.push({ place: pl, suffix: '' });
    }
    void core;
    const hit = pick([...bayHits, ...riverHits, ...seaHits]);
    if (!hit) return {};
    usedNames.add(hit.place);
    return hit;
  };

  let dev: Float32Array | undefined;
  let own: ReturnType<typeof ownersAt> | undefined;
  let prevBelt = new Int32Array(S.length).fill(-1);
  let prevDist = new Int32Array(S.length).fill(-1);
  const y0 = Math.ceil(modern / STEP) * STEP;
  const years: number[] = [];
  for (let y = y0; y < civ.endYear; y += STEP) years.push(y);
  years.push(Math.floor(civ.endYear));
  for (const y of years) {
    if (civ.development) dev = developmentAt(civ.development, y, dev);
    own = ownersAt(civ, y, own);
    const pop = S.map((s) => (s.founded > y || (s.ended !== undefined && s.ended <= y) ? 0 : populationAt(s, y)));
    const rad = S.map((s, i) => builtRadiusKm(pop[i], dev ? elecOfProd(dev[s.region * CAP_COUNT]) : 0));
    const pol = S.map((s) => own!.polity[s.region]);
    // 格子:按最大半径的两倍多一点分桶
    const maxR = Math.max(1, ...rad);
    const bucket = (2 * LINK_K * 1.2 * maxR + 1) / KM;
    const grid = new Map<string, number[]>();
    S.forEach((_, i) => {
      if (pop[i] < MIN_POP * 0.1) return;
      const k = `${Math.floor(sx[i] / bucket)},${Math.floor(sy[i] / bucket)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    });
    const nbx = Math.ceil(W / bucket);
    const parent = S.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const district = new Int32Array(S.length).fill(-1);
    S.forEach((_, i) => {
      if (pop[i] < MIN_POP * 0.1) return;
      const gx = Math.floor(sx[i] / bucket), gy = Math.floor(sy[i] / bucket);
      for (let a = -1; a <= 1; a++)
        for (let b = -1; b <= 1; b++)
          for (const j of grid.get(`${(((gx + a) % nbx) + nbx) % nbx},${gy + b}`) ?? []) {
            if (j <= i || pol[i] < 0 || pol[i] !== pol[j]) continue;
            const d = distKm(i, j);
            // 并为区:小的落在大的建成区里
            const [big, small] = pop[i] >= pop[j] ? [i, j] : [j, i];
            if (pop[small] < 0.15 * pop[big] && d < DISTRICT_K * rad[big]) {
              if (district[small] < 0 || pop[big] > pop[district[small]]) district[small] = big;
              continue;
            }
            const stay = prevBelt[i] >= 0 && prevBelt[i] === prevBelt[j] ? 1.2 : 1;
            if (pop[i] >= MIN_POP && pop[j] >= MIN_POP && d < LINK_K * stay * (rad[i] + rad[j])) parent[find(i)] = find(j);
          }
    });
    // 区的区:挂到最终的大城上;大城自己是区的不算
    for (let i = 0; i < S.length; i++) {
      let b = district[i];
      for (let t = 0; t < 8 && b >= 0 && district[b] >= 0; t++) b = district[b];
      district[i] = b === i ? -1 : b;
    }
    // 区和它的大城算一串(城并成一座也还是那条带,不算"散了")
    for (let i = 0; i < S.length; i++) if (district[i] >= 0) parent[find(i)] = find(district[i]);
    const comps = new Map<number, number[]>();
    S.forEach((_, i) => {
      if (district[i] < 0 && pop[i] < MIN_POP) return;
      if (district[i] >= 0 && pop[i] <= 0) return;
      const r = find(i);
      (comps.get(r) ?? comps.set(r, []).get(r)!).push(i);
    });
    const beltOf = new Int32Array(S.length).fill(-1);
    const claimed = new Set<number>();
    const list = [...comps.values()].filter((m) => m.length >= 2).sort((a, b) => b.length - a.length);
    for (const m of list) {
      // 和上一次的哪条共有的城最多
      const cnt = new Map<number, number>();
      for (const i of m) if (prevBelt[i] >= 0) cnt.set(prevBelt[i], (cnt.get(prevBelt[i]) ?? 0) + 1);
      let id = -1, bc = 0;
      for (const [b, c] of cnt) if (!claimed.has(b) && c > bc) (id = b), (bc = c);
      if (id < 0) {
        const core = m.reduce((a, b) => (pop[b] > pop[a] ? b : a), m[0]);
        id = out.belts.length;
        // 起名的先后:有国都 → 某某都市圈;挨着湾 / 河 / 海 → 地理名;一城独大(≥ 第二大的 2.5 倍)→ 大某某;
        // 两三座差不多大(≥ 最大的 40%)→ 东方取首字、西方城名连写;四座以上 → 州名 + 都会区(州没名字 → 大某某)
        const main = m.filter((i) => district[i] < 0).sort((a, b) => pop[b] - pop[a]);
        const Pol = pol[core] >= 0 ? civ.polities[pol[core]] : undefined;
        const cap = Pol ? capitalAt(Pol, y + 0.5) : -1;
        let desc: Partial<CityBelt> = {};
        if (cap >= 0 && m.includes(cap)) desc = { kind: 'capital', cities: [cap] };
        else {
          const geo = nameBelt(m, core, rad);
          if (geo.place !== undefined) desc = geo;
          else if (main.length >= 2 && pop[main[0]] < 2.5 * pop[main[1]]) {
            const comp = main.filter((i) => pop[i] >= 0.4 * pop[main[0]]);
            // 东方还是西方的叫法按这几座城自己的语感(民族的起名风格),都是东方 → 取首字;混着的连写
            // 东方语感里的"边塞"出的是音译名(哈齐尔、呼和乌拉),不取首字
            const east = comp.slice(0, 3).filter((i) => {
              const st = civ.cultures[S[i].culture]?.style;
              return st !== 'frontier' && NAME_STYLES.find((x) => x.id === st)?.family === 'eastern';
            }).length;
            if (comp.length <= 3) desc = { kind: east === Math.min(3, comp.length) ? 'abbr' : 'pair', cities: comp.slice(0, 3) };
            else if (regionNamed(civ, S[core].region)) desc = { kind: 'metro', region: S[core].region };
          }
        }
        out.belts.push({ id, ...desc, from: y, core });
        out.events.push({ year: y, kind: 'form', belt: id, members: [...m].sort((a, b) => pop[b] - pop[a]) });
      }
      claimed.add(id);
      for (const i of m) beltOf[i] = id;
      // 区也算这条带的
    }
    for (let i = 0; i < S.length; i++) if (district[i] >= 0 && beltOf[district[i]] >= 0) beltOf[i] = beltOf[district[i]];
    // 散了的带
    const was = new Set<number>();
    for (const b of prevBelt) if (b >= 0) was.add(b);
    for (const b of was)
      if (!claimed.has(b)) {
        out.belts[b].to = y;
        const mem: number[] = [];
        prevBelt.forEach((v, i) => v === b && district[i] < 0 && pop[i] > 0 && mem.push(i));
        const split = new Set(mem.map((i) => pol[i])).size > 1;
        out.events.push({ year: y, kind: 'end', belt: b, split });
      }
    // 新并的区(按大城归在一起)
    const newD = new Map<number, number[]>();
    for (let i = 0; i < S.length; i++) if (district[i] >= 0 && prevDist[i] !== district[i]) (newD.get(district[i]) ?? newD.set(district[i], []).get(district[i])!).push(i);
    for (const [big, small] of newD) out.events.push({ year: y, kind: 'district', big, small });
    out.samples.push({ year: y, beltOf, districtOf: district });
    prevBelt = beltOf;
    prevDist = district;
  }
  // 不到 30 年就散了的带不记(连上又断开的抖动):事件去掉,取样里当作不属于任何带
  const short = new Set(out.belts.filter((b) => b.to !== undefined && b.to - b.from < 30).map((b) => b.id));
  if (short.size) {
    out.events = out.events.filter((e) => e.belt === undefined || !short.has(e.belt));
    for (const sm of out.samples) for (let i = 0; i < sm.beltOf.length; i++) if (short.has(sm.beltOf[i])) sm.beltOf[i] = -1;
  }
  return out;
}

/** 城市带的名字(按传进来的这份历史拼:地名、城名都照它) */
export function beltName(civ: Civ, b: CityBelt): string {
  const cn = (i: number) => cityNameAt(civ, i, b.from);
  if (b.kind === 'capital' && b.cities?.length) return `${cn(b.cities[0])}都市圈`;
  if (b.kind === 'abbr' && b.cities?.length) return b.cities.map((i) => (isNameToken(cn(i)) ? nameForm(cn(i), 'f') : firstChar(cn(i)))).join('');
  if (b.kind === 'pair' && b.cities?.length) return b.cities.map(cn).join('–');
  if (b.kind === 'metro' && b.region !== undefined) return `${regionLabel(civ, b.region)}都会区`;
  if (b.place !== undefined && b.place >= 0 && civ.places[b.place]) {
    const pl = civ.places[b.place];
    return pl.kind === 'sea' && !b.suffix ? `环${pl.name}` : pl.name + (b.suffix ?? '');
  }
  const c = cityNameAt(civ, b.core, b.from);
  // 占位符(后台线程算编年史用的那份):写法记号 b,换名字时再去尾字(nameTokens.ts 的 applyForm)
  return `大${isNameToken(c) ? nameForm(c, 'b') : beltStem(c)}`;
}

/** 城名的头一个字(简称用:京津) */
export function firstChar(c: string): string {
  return [...c][0] ?? c;
}

/** "大某某"用的城名:去掉结尾的镇、关、渡、村、庄(三个字以上才去) */
export function beltStem(c: string): string {
  return c.length > 2 && /[镇关渡村庄]$/.test(c) ? c.slice(0, -1) : c;
}

/** year 那一年的样子(最近一次 ≤ year 的取样;近代以前 = null) */
export function beltStateAt(civ: Civ, year: Year): Sample | null {
  const { samples } = cityBelts(civ);
  if (!samples.length || year < samples[0].year) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (samples[mid].year <= year) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo];
}

/** 城市带的编年史条目(成形、并为区、散了);城名写那一年的名字(城的占位符按那条史事的年份换) */
export function beltEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const B = cityBelts(civ);
  if (!B.events.length) return [];
  const S = civ.settlements;
  const out: ChronicleEntry[] = [];
  let id = idBase;
  let own: ReturnType<typeof ownersAt> | undefined;
  let ownY = NaN;
  const ownerAt = (sid: number, y: Year) => {
    if (y !== ownY) {
      own = ownersAt(civ.history ?? civ, y, own);
      ownY = y;
    }
    return own!.polity[S[sid].region];
  };
  const nm = (sid: number, y: Year) => cityNameAt(civ, sid, y);
  const list = (ids: number[], y: Year) => (ids.length <= 4 ? ids.map((i) => nm(i, y)).join('、') : `${ids.slice(0, 3).map((i) => nm(i, y)).join('、')}等${ids.length}城`);
  for (const e of B.events) {
    let text = '';
    let sid = -1;
    let importance: 1 | 2 = 1;
    let regions: number[] = [];
    if (e.kind === 'form') {
      const b = B.belts[e.belt!];
      sid = b.core;
      importance = 2;
      text = `${list(e.members!, e.year)}城区连成一片,世称${beltName(civ, b)}`;
      regions = e.members!.map((i) => S[i].region);
    } else if (e.kind === 'district') {
      sid = e.big!;
      const sm = e.small!;
      text = sm.length === 1 ? `${nm(sm[0], e.year)}并入${nm(e.big!, e.year)},为其一区` : `${list(sm, e.year)}并入${nm(e.big!, e.year)},为其诸区`;
      regions = [S[e.big!].region, ...sm.map((i) => S[i].region)];
    } else {
      const b = B.belts[e.belt!];
      sid = b.core;
      text = e.split ? `${beltName(civ, b)}诸城分属异国,不复连成一片` : `${beltName(civ, b)}衰落,城区不再相连`;
      regions = [S[b.core].region];
    }
    const p = ownerAt(sid, e.year);
    out.push({
      id: id++,
      kind: 'rename',
      year: e.year,
      end: e.year,
      text,
      tag: '并',
      importance,
      polities: p >= 0 ? [p] : [],
      regions: [...new Set(regions)],
      settlement: sid,
    });
  }
  return out;
}
