/**
 * 本地分支 modern-pace 第五十七轮:城市改名 —— 推演完以后算每座城哪一年叫什么,不改推演。纯计算。
 *
 *   换主  城所在的州被别的民族的国家拿下、占住 40 年以上:按新主人的语感起个新名字(改在拿下以后 3–20 年)。
 *         近代(世上头一个国家进工业)以前概率低(8%),以后高(30%)
 *   光复  原来那个民族的国家拿回来:多半(70%)过 3–15 年改回原名
 *   迁都  近代以后迁到的新国都:三成改个新名字(新都新气象)
 *   革命  近代以后改制成共和 / 军政府的国家:国都一半改成开国执政的名字(东方语感"某某城",别的"某某堡");那一段政体结束就改回去
 * 新名字由城所在地块 + 第几次改名做键,按语感起(同一个世界永远一样);和别的城撞名就取下一个。
 * 显示:地图城名、编年史(按那条史事那一年)、城市面板都用 cityNameAt;每次改名在编年史里记一条(renameEntries)。
 */
import { createNamer, type Namer } from '../../names';
import { subSeed } from '../../util';
import { Layer, type Civ, type Year } from '../types';
import { capitalAt, polityName } from '../growth';
import { rulerAt } from './peopleInfo';
import type { ChronicleEntry } from './chronicle';
import { isNameToken, nameForm } from '../nameToken';

export type RenameCause = 'conquer' | 'restore' | 'capital' | 'revolution' | 'revert';
export interface CityRename {
  year: Year;
  name: string;
  /** 改名前叫什么 */
  from: string;
  cause: RenameCause;
  /** 改名的国家 */
  polity: number;
}

const hash = (a: number, b: number, c = 0) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

const cache = new WeakMap<Civ, CityRename[][]>();

/** 每座城的改名(按年份排好) */
export function cityRenames(civ0: Civ): CityRename[][] {
  const civ = civ0.history ?? civ0;
  const hit = cache.get(civ);
  if (hit) return hit;
  const S = civ.settlements;
  const out: CityRename[][] = S.map(() => []);
  cache.set(civ, out);
  if (!S.length || !civ.viable) return out;
  // 近代从哪年起:世上头一个国家进工业
  let modern = Infinity;
  for (const p of civ.polities) if (p.modern?.length && p.modern[0] < modern) modern = p.modern[0];
  // 各州归属的变化(国家层;按年份)
  const R = civ.regions.count;
  const owner: { year: number; p: number }[][] = Array.from({ length: R }, () => []);
  const log = civ.log;
  for (let i = 0; i < log.size; i++) if (log.layer[i] === Layer.Polity && log.region[i] < R) owner[log.region[i]].push({ year: log.year[i], p: log.value[i] });
  const cultureOf = (p: number) => (p >= 0 ? (civ.polities[p]?.culture ?? -1) : -1);
  const namers = new Map<string, Namer>();
  const seed = subSeed(civ.seed, 'civ-names-city-rename');
  const namerOf = (style: string) => {
    let n = namers.get(style);
    if (!n) namers.set(style, (n = createNamer(seed, style)));
    return n;
  };
  const taken = new Set<string>();
  const freshName = (sid: number, culture: number, k: number): string => {
    const style = civ.cultures[culture]?.style || 'kingdom';
    const next = namerOf(style).keyed('city', S[sid].cell, 100 + k);
    let g = next();
    for (let t = 0; t < 200 && (taken.has(g.zh) || g.zh === S[sid].name); t++) g = next();
    taken.add(g.zh);
    return g.zh;
  };
  // 候选事件(每座城):年份、原因、国家
  type Ev = { year: Year; cause: RenameCause; p: number; until?: Year };
  const evs: Ev[][] = S.map(() => []);
  // 换主 / 光复
  S.forEach((s, sid) => {
    const segs = owner[s.region] ?? [];
    for (let k = 0; k < segs.length; k++) {
      const y0 = segs[k].year, y1 = k + 1 < segs.length ? segs[k + 1].year : civ.endYear;
      if (y0 < s.founded || (s.ended !== undefined && y0 >= s.ended)) continue;
      const P = segs[k].p;
      if (P < 0) continue;
      const c = cultureOf(P);
      if (c === s.culture) evs[sid].push({ year: y0 + 3 + Math.floor(hash(sid, y0, 1) * 13), cause: 'restore', p: P, until: y1 });
      else if (y1 - y0 >= 40) evs[sid].push({ year: y0 + 3 + Math.floor(hash(sid, y0, 2) * 18), cause: 'conquer', p: P, until: y1 });
    }
  });
  // 迁都 / 革命(近代以后)
  for (const p of civ.polities) {
    (p.capitals ?? []).forEach((c, k) => {
      if (k === 0 || c.year < modern || !S[c.settlement]) return;
      evs[c.settlement].push({ year: c.year, cause: 'capital', p: p.id });
    });
    (p.dynasties ?? []).forEach((d, k) => {
      if (!d.regime || d.year < modern) return;
      const sid = capitalAt(p, d.year + 0.5);
      if (!S[sid]) return;
      const next = p.dynasties![k + 1]?.year ?? (p.ended ?? civ.endYear);
      evs[sid].push({ year: d.year + 1, cause: 'revolution', p: p.id, until: next });
    });
  }
  // 按年份逐座城走一遍:记着现在叫什么、按哪个民族起的
  S.forEach((s, sid) => {
    const list = evs[sid].sort((a, b) => a.year - b.year);
    let name = s.name;
    let culture = s.culture;
    let k = 0;
    let preRev: { name: string; culture: number } | null = null;
    for (const e of list) {
      if (e.year > civ.endYear || e.year < s.founded || (s.ended !== undefined && e.year >= s.ended)) continue;
      if (e.until !== undefined && e.year >= e.until) continue;
      const modernNow = e.year >= modern;
      const r = hash(sid, e.year, 7);
      let to: string | null = null;
      let cause = e.cause;
      if (e.cause === 'conquer') {
        const c = cultureOf(e.p);
        if (c >= 0 && c !== culture && r < (modernNow ? 0.3 : 0.08)) {
          to = freshName(sid, c, k++);
          culture = c;
        }
      } else if (e.cause === 'restore') {
        if (name !== s.name && r < 0.7) {
          to = s.name;
          culture = s.culture;
        }
      } else if (e.cause === 'capital') {
        if (r < 0.3) {
          const c = cultureOf(e.p);
          to = freshName(sid, c >= 0 ? c : culture, k++);
          if (c >= 0) culture = c;
        }
      } else if (e.cause === 'revolution') {
        const P = civ.polities[e.p];
        const ruler = rulerAt(civ, e.p, e.year);
        if (P && ruler?.name && r < 0.5) {
          preRev = { name, culture };
          to = `${ruler.name}${P.eastern ? '城' : '堡'}`;
          // 那一段政体结束:改回去
          if (e.until !== undefined && e.until < civ.endYear) list.push({ year: e.until + 1, cause: 'revert', p: e.p }), list.sort((a, b) => a.year - b.year);
        }
      } else if (e.cause === 'revert') {
        if (preRev) {
          to = preRev.name;
          culture = preRev.culture;
          preRev = null;
        }
      }
      if (to && to !== name) {
        out[sid].push({ year: e.year, name: to, from: name, cause, polity: e.p });
        name = to;
      }
      void cause;
    }
  });
  return out;
}

/** 第 sid 座城在 year 年叫什么(没改过 = 原名;civ 套了用户改名的,原名就是用户起的名字) */
export function cityNameAt(civ: Civ, sid: number, year: Year): string {
  const base = civ.settlements[sid]?.name ?? '';
  const list = cityRenames(civ)[sid];
  if (!list?.length || !(year >= list[0].year)) return base;
  let name = base;
  for (const r of list) {
    if (r.year > year) break;
    name = r.cause === 'restore' || r.cause === 'revert' ? (r.name === (civ.history ?? civ).settlements[sid]?.name ? base : r.name) : r.name;
  }
  return name;
}



/**
 * 改名的编年史条目。旧名写成"那一刻以前的名字"(原名用城的名字本身,显示时按年份换,见 nameTokens.ts 的 restoreEntries),新名直接写
 */
export function renameEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  let id = idBase;
  cityRenames(civ).forEach((list, sid) => {
    const s = civ.settlements[sid];
    for (const r of list) {
      const P = civ.polities[r.polity];
      const who = P ? polityName(P, r.year) : '';
      // 城名的占位符显示时按那条史事的年份换成当时的名字;原名要的是"原来叫什么",加写法记号 0 = 不按年份换
      const orig = (t: string) => (isNameToken(t) ? nameForm(t, '0') : t);
      const text =
        r.cause === 'conquer'
          ? `${who}据有${r.from}后,按本族的叫法改名为${r.name}`
          : r.cause === 'restore'
            ? `${who}光复${r.from},改回旧名${orig(r.name)}`
            : r.cause === 'capital'
              ? `${who}定都${r.from},改名为${r.name}`
              : r.cause === 'revolution'
                ? `${who}革命后,以开国执政之名将${r.from}改名为${r.name}`
                : `${who}政权更迭,${r.from}改回旧名${orig(r.name)}`;
      out.push({
        id: id++,
        kind: 'rename',
        year: r.year,
        end: r.year,
        text,
        tag: '名',
        importance: r.cause === 'revolution' || r.cause === 'capital' ? 2 : 1,
        polities: r.polity >= 0 ? [r.polity] : [],
        regions: [s.region],
        settlement: sid,
      });
    }
  });
  return out.sort((a, b) => a.year - b.year);
}
