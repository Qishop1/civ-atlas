/**
 * 做法表(practices.ts)在界面、编年史里:某国某一年有了哪几样做法,铁路、电报的句子写到哪一州。
 * 国都那州的能力按发展度的快照插值(推演里按国都那州此刻的能力现算,快照之间可能差几年);只读推演结果,不改历史。
 * 纯计算,不碰 DOM。
 */
import { AdjKind, type Civ, type Year } from '../types';
import { CAP_COUNT, LEVEL_SCALE, eraLevel } from '../development';
import { capitalAt, populationAt, ruralPopulationAt } from '../growth';
import { regionLabel, regionNamed } from './display';
import { ownersAt, type Owners } from '../engine/timeline';
import { practiceMask } from '../practices';
import { KM_PER_UNIT } from '../scale';

const row = new Float64Array(CAP_COUNT);

/** 国都所在的州(没有 = −1) */
function capRegion(civ: Pick<Civ, 'polities' | 'settlements'>, p: number, year: Year): number {
  const P = civ.polities[p];
  if (!P) return -1;
  return civ.settlements[capitalAt(P, year)]?.region ?? -1;
}

/** 国家 p 在 year 这一年有了哪几样做法(按位,见 practices.ts;没有发展度、查不到国都那州 = null) */
export function practicesAt(civ: Pick<Civ, 'development' | 'polities' | 'settlements'>, p: number, year: Year): number | null {
  const dev = civ.development;
  const ys = dev?.snapYears;
  if (!dev || !ys?.length) return null;
  const r = capRegion(civ, p, year);
  if (r < 0) return null;
  // 前后两份快照线性插值(和 developmentAt 一样,只算这一州)
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  const a = dev.snaps[Math.max(0, lo - 1)];
  const b = dev.snaps[Math.min(ys.length - 1, lo)];
  const t = lo <= 0 || lo >= ys.length ? 0 : (year - ys[lo - 1]) / (ys[lo] - ys[lo - 1]);
  const o = r * CAP_COUNT;
  if (o + CAP_COUNT > a.length || o + CAP_COUNT > b.length) return null;
  for (let c = 0; c < CAP_COUNT; c++) row[c] = (a[o + c] + (b[o + c] - a[o + c]) * t) / LEVEL_SCALE;
  return practiceMask(row, 0, eraLevel(row, 0));
}

let owners: Owners | undefined;

/**
 * 国家 p 在 year 这一年离国都最远的州(陆路走几州;一样远的挑人口上限大的;有名字的优先),给"铁路成,自京师至某州"用。
 * 只有国都一州 = −1
 */
export function farRegion(civ: Civ, p: number, year: Year): number {
  const start = capRegion(civ, p, year);
  if (start < 0) return -1;
  owners = ownersAt(civ, year, owners);
  const own = owners.polity;
  const reg = civ.regions;
  const hops = new Map<number, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i];
    for (let e = reg.adjStart[x]; e < reg.adjStart[x + 1]; e++) {
      const k = reg.adjKind[e];
      if (k === AdjKind.Strait || k === AdjKind.SeaRoute) continue;
      const y = reg.adj[e];
      if (own[y] !== p || hops.has(y)) continue;
      hops.set(y, hops.get(x)! + 1);
      queue.push(y);
    }
  }
  let best = -1;
  let bestKey = -Infinity;
  for (const [y, h] of hops) {
    if (y === start) continue;
    const key = (regionNamed(civ, y) ? 1e6 : 0) + h * 1e3 + Math.min(999, reg.capacity[y] / 1000);
    if (key > bestKey) {
      bestKey = key;
      best = y;
    }
  }
  return best;
}

/** 州名(给句子用;没名字写"第 N 州") */
export function farName(civ: Civ, r: number): string {
  return r >= 0 ? regionLabel(civ, r) : '';
}

/**
 * 本地分支 modern-pace:国家 p 在 year 那一刻从国都到州 to 的陆路里程(公里;只走本国的陆上邻接,治所到治所,最短的那条)。
 * 走不到 = −1
 */
export function landKm(civ: Civ, p: number, year: Year, to: number): number {
  const start = capRegion(civ, p, year);
  if (start < 0 || to < 0) return -1;
  owners = ownersAt(civ, year, owners);
  const own = owners.polity;
  const reg = civ.regions;
  const dist = new Map<number, number>([[start, 0]]);
  const open: number[] = [start];
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i])! < dist.get(open[bi])!) bi = i;
    const x = open.splice(bi, 1)[0];
    if (x === to) break;
    const dx = dist.get(x)!;
    for (let e = reg.adjStart[x]; e < reg.adjStart[x + 1]; e++) {
      const k = reg.adjKind[e];
      if (k === AdjKind.Strait || k === AdjKind.SeaRoute) continue;
      const y = reg.adj[e];
      if (own[y] !== p) continue;
      const nd = dx + reg.adjLen[e];
      if (nd < (dist.get(y) ?? Infinity)) {
        if (!dist.has(y)) open.push(y);
        dist.set(y, nd);
      }
    }
  }
  const d = dist.get(to);
  return d === undefined ? -1 : d * KM_PER_UNIT;
}

/**
 * 本地分支 modern-pace 第十八轮:城市群 —— 国家 p 在 year 那一刻人口最多的那座城为中心,两步以内(陆上相邻)本国州里的城、乡人口合计(千人);
 * 返回 [合计, 中心城名];没有城 = [0, '']
 */
export function metroOf(civ: Civ, p: number, year: Year): [number, string] {
  owners = ownersAt(civ, year, owners);
  const own = owners.polity;
  let center = -1;
  let best = 0;
  for (let i = 0; i < civ.settlements.length; i++) {
    const s = civ.settlements[i];
    if (s.region < 0 || own[s.region] !== p) continue;
    const k = populationAt(s, year);
    if (k > best) {
      best = k;
      center = i;
    }
  }
  if (center < 0) return [0, ''];
  const reg = civ.regions;
  const r0 = civ.settlements[center].region;
  const hop = new Map<number, number>([[r0, 0]]);
  const queue = [r0];
  for (let q = 0; q < queue.length; q++) {
    const x = queue[q];
    if (hop.get(x)! >= METRO_HOPS) continue;
    for (let e = reg.adjStart[x]; e < reg.adjStart[x + 1]; e++) {
      const k = reg.adjKind[e];
      if (k === AdjKind.Strait || k === AdjKind.SeaRoute) continue;
      const y = reg.adj[e];
      if (own[y] !== p || hop.has(y)) continue;
      hop.set(y, hop.get(x)! + 1);
      queue.push(y);
    }
  }
  let sum = 0;
  for (const r of hop.keys()) sum += ruralPopulationAt(civ, r, year);
  for (const s of civ.settlements) if (hop.has(s.region)) sum += populationAt(s, year);
  return [sum, civ.settlements[center].name ?? ''];
}
/** 城市群算到中心城外几步(陆上相邻的州) */
const METRO_HOPS = 2;
