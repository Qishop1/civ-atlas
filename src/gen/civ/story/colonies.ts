/**
 * 本地分支 modern-pace 第三十七轮:太空殖民地(只读推演结果和航天这一线,不改推演;事件只进航天面板,不进编年史)。
 *
 * 四种:
 *   月球   各国的月球基地(spaceText 的 base)长成城:几十人起,按 logistic 涨到上限(5–60 万);人口过一万改叫"某某城"
 *   火星   各国的火星定居(mars)那年起:几百人起,上限 50–500 万
 *   轨道城 同步轨道环合龙以后 5–15 年起,环上 2–4 处居住区(各在两座电梯之间),上限 100–800 万
 *   小行星带 有了火星定居的国家,30–50 年后在小行星带建开采站,上限 1–8 万
 * 归属:建它的国家;那国亡了 —— 那年有地球联邦就归联邦,没有就自立。
 * 自治:人口过门槛(月球 2 万、火星 10 万、轨道城 50 万、小行星带 1 万)、建了 40 年以上,再过 0–10 年。
 * 独立:自治后 30–80 年,一定机会 —— 母国是地球联邦的:举行独立公投、和平脱离;不是的:打一场 2–8 年的独立战争,
 *       六成打赢独立,四成被镇压(之后 50 年再起一次,这回必定独立)。独立后叫"某某共和国"(火星头一个独立的叫"火星共和国")。
 * 全都按种子、国家编号挑,同一个世界每次一样。
 */
import type { Civ, Polity, Year } from '../types';
import { polityName } from '../growth';
import { craftName, orbitalRing, spaceHash as hash, spaceRace, spaceTowers } from './spaceText';
import type { ChronicleEntry, Importance } from './chronicle';
import { starSystem } from './systemText';

export type ColonyBody = 'moon' | 'mars' | 'ring' | 'belt';
export const BODY_NAME: Record<ColonyBody, string> = { moon: '月球', mars: '行星', ring: '轨道城', belt: '小行星带' };
/** 这个世界里这一类叫什么:行星 = 殖民的那颗(恒星系生成的),小行星带 = 带的名字 */
export function bodyName(civ: Civ, b: ColonyBody): string {
  if (b === 'mars') return starSystem(civ).targetName;
  if (b === 'belt') return starSystem(civ).beltName ?? '小行星带';
  return BODY_NAME[b];
}

export interface Colony {
  id: number;
  body: ColonyBody;
  /** 起初的名字(月球"某某基地"、火星"某某定居点"、轨道城"某某居住区"、小行星带"某某开采站") */
  name: string;
  /** 长成城以后的名字 */
  city: string;
  founder: number;
  founded: Year;
  /** 月球上的位置(度) / 轨道环上的经度 */
  lon?: number;
  lat?: number;
  p0: number;
  cap: number;
  /** logistic 的增长率(每年) */
  r: number;
  /** 母国亡了那年归了谁:联邦的编号 / 自立(-1) */
  handover?: { year: Year; to: number };
  autonomy?: Year;
  /** 独立:哪年、怎么(公投 / 战争)、战争哪年开打;叫什么 */
  independence?: { year: Year; how: 'referendum' | 'war'; warFrom?: Year; name: string };
  /** 打输了的那场独立战争 */
  crushed?: { from: Year; to: Year };
}

const POP0: Record<ColonyBody, number> = { moon: 40, mars: 300, ring: 5000, belt: 60 };
const CAP: Record<ColonyBody, [number, number]> = { moon: [5e4, 6e5], mars: [5e5, 5e6], ring: [1e6, 8e6], belt: [1e4, 8e4] };
const RATE: Record<ColonyBody, [number, number]> = { moon: [0.07, 0.11], mars: [0.06, 0.09], ring: [0.08, 0.12], belt: [0.05, 0.08] };
const AUTO_POP: Record<ColonyBody, number> = { moon: 2e4, mars: 1e5, ring: 5e5, belt: 1e4 };
/** 每一类最多几处 */
const MAX_PER: Record<ColonyBody, number> = { moon: 6, mars: 6, ring: 4, belt: 3 };
/** 改叫"城"的人口 */
const CITY_POP = 1e4;
/** 独立的机会:母国是联邦的(公投)/ 不是的(战争) */
const FREE_FED = 0.5;
const FREE_WAR = 0.55;

/** t 年的人口(logistic) */
export function colonyPop(c: Colony, t: Year): number {
  if (t < c.founded) return 0;
  return c.cap / (1 + (c.cap / c.p0 - 1) * Math.exp(-c.r * (t - c.founded)));
}
/** 人口第一次到 n 的年份(到不了 = Infinity) */
function yearAtPop(c: Colony, n: number): Year {
  if (n <= c.p0) return c.founded;
  if (n >= c.cap) return Infinity;
  return c.founded + Math.log((c.cap / c.p0 - 1) / (c.cap / n - 1)) / c.r;
}

/** t 年归谁:国家编号;自立 / 独立了 = -1 */
export function colonyOwner(c: Colony, t: Year): number {
  if (c.independence && t >= c.independence.year) return -1;
  if (c.handover && t >= c.handover.year) return c.handover.to;
  return c.founder;
}
/** t 年的名字 */
export function colonyName(c: Colony, t: Year): string {
  if (c.independence && t >= c.independence.year) return c.independence.name;
  return colonyPop(c, t) >= CITY_POP ? c.city : c.name;
}
/** t 年的状态 */
export function colonyState(c: Colony, t: Year): string {
  if (c.independence && t >= c.independence.year) return '独立';
  if (c.independence?.warFrom !== undefined && t >= c.independence.warFrom) return '独立战争中';
  if (c.crushed && t >= c.crushed.from && t < c.crushed.to) return '独立战争中';
  if (c.handover && c.handover.to < 0 && t >= c.handover.year) return '自立';
  if (c.autonomy !== undefined && t >= c.autonomy) return '自治';
  return '直辖';
}
/** "约 3200 人""约 12 万人""约 1.2 亿人" */
export function headText(n: number): string {
  if (n >= 1e8) return `约 ${(n / 1e8).toFixed(1).replace(/\.0$/, '')} 亿人`;
  if (n >= 1e4) return `约 ${n >= 1e5 ? Math.round(n / 1e4) : (n / 1e4).toFixed(1).replace(/\.0$/, '')} 万人`;
  return `约 ${Math.max(10, Math.round(n / 10) * 10)} 人`;
}

const cache = new WeakMap<Civ, Colony[]>();

export function colonies(civ: Civ): Colony[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const race = spaceRace(civ);
  const end = civ.endYear;
  const out: Colony[] = [];
  const P = (id: number) => civ.polities[id];
  const fedAt = (y: Year) => civ.polities.find((q) => q.federation !== undefined && q.federation <= y && (q.ended === undefined || q.ended > y));
  const add = (body: ColonyBody, p: Polity, founded: Year, name: string, city: string, k: number, at?: { lon: number; lat?: number }) => {
    if (founded > end) return;
    const [c0, c1] = CAP[body];
    const [r0, r1] = RATE[body];
    const c: Colony = {
      id: out.length,
      body,
      name,
      city,
      founder: p.id,
      founded,
      ...(at ? { lon: at.lon, ...(at.lat !== undefined ? { lat: at.lat } : {}) } : {}),
      p0: POP0[body],
      cap: c0 * Math.pow(c1 / c0, hash(p.id, k, 1)),
      r: r0 + (r1 - r0) * hash(p.id, k, 2),
    };
    out.push(c);
  };
  // 月球:各国的月球基地
  for (const [pid, b] of race.bases) {
    const p = P(pid);
    const n = craftName(civ, p, 77);
    add('moon', p, b.year, `${n}基地`, `${n}城`, 1, { lon: b.lon, lat: b.lat });
  }
  // 火星:各国的火星定居
  for (const [pid, m] of race.done) {
    const y = m.get('mars');
    if (y === undefined) continue;
    const p = P(pid);
    const n = craftName(civ, p, 8 * 13 + 1 + 101);
    add('mars', p, y, `${n}定居点`, `新${n}`, 2);
    // 小行星带:30–50 年后(恒星系里有带才有)
    if (!starSystem(civ).sys.belt) continue;
    const yb = y + 30 + Math.floor(hash(pid, 3, 3) * 21);
    const nb = craftName(civ, p, 131);
    add('belt', p, yb, `${nb}开采站`, nb.endsWith('港') ? `${nb}城` : `${nb}港`, 3);
  }
  // 轨道城:轨道环合龙以后,两座电梯之间的环段上各一处(最多 4 处)
  const ring = orbitalRing(civ);
  if (ring && ring.end <= end) {
    const towers = spaceTowers(civ);
    const owner = P(ring.polity);
    ring.segs.slice(0, 4).forEach((s, k) => {
      const la = civ.regions.lon?.[towers[s.a].region] ?? 0;
      const lb = civ.regions.lon?.[towers[s.b].region] ?? 0;
      const span = ((lb - la + 360) % 360) || 360;
      const lon = ((la + span * (0.3 + 0.4 * hash(ring.polity, 10 + k, 4)) + 540) % 360) - 180;
      const n = craftName(civ, owner, 151 + k);
      add('ring', owner, ring.end + 5 + Math.floor(hash(ring.polity, 10 + k, 5) * 11), `${n}居住区`, `${n}环城`, 10 + k, { lon });
    });
  }
  // 每一类最多几处(最早建的那几处;后来的国家只发了定居任务、没留下长久的殖民地)
  const kept: Colony[] = [];
  const count: Partial<Record<ColonyBody, number>> = {};
  for (const c of [...out].sort((a, b) => a.founded - b.founded || a.id - b.id)) {
    const n = count[c.body] ?? 0;
    if (n >= MAX_PER[c.body]) continue;
    count[c.body] = n + 1;
    kept.push(c);
  }
  out.length = 0;
  kept.sort((a, b) => a.id - b.id).forEach((c, i) => out.push({ ...c, id: i }));
  // 归属、自治、独立
  let marsFree = false;
  for (const c of out.sort((a, b) => a.founded - b.founded || a.id - b.id)) {
    const p = P(c.founder);
    const k = c.id + 50;
    if (p.ended !== undefined && p.ended > c.founded && p.ended <= end) {
      const F = fedAt(p.ended);
      c.handover = { year: p.ended, to: F && F.id !== p.id ? F.id : -1 };
    }
    if (c.handover?.to === -1) continue;
    const ya = Math.max(yearAtPop(c, AUTO_POP[c.body]), c.founded + 40) + Math.floor(hash(c.founder, k, 6) * 11);
    if (ya > end) continue;
    c.autonomy = ya;
    const yi = ya + 30 + Math.floor(hash(c.founder, k, 7) * 51);
    if (yi > end) continue;
    const lord = P(colonyOwner(c, yi));
    if (!lord) continue;
    const fed = lord.federation !== undefined && lord.federation <= yi;
    const freeName = () => {
      if (c.body === 'mars' && !marsFree) {
        marsFree = true;
        return `${starSystem(civ).targetName.replace(/的卫星$/, '')}共和国`;
      }
      return `${c.city}共和国`;
    };
    if (fed) {
      if (hash(c.founder, k, 8) < FREE_FED) c.independence = { year: yi, how: 'referendum', name: freeName() };
    } else if (hash(c.founder, k, 8) < FREE_WAR) {
      const len = 2 + Math.floor(hash(c.founder, k, 9) * 7);
      if (hash(c.founder, k, 10) < 0.6) {
        if (yi + len <= end) c.independence = { year: yi + len, how: 'war', warFrom: yi, name: freeName() };
      } else {
        c.crushed = { from: yi, to: yi + len };
        const y2 = yi + len + 50;
        const len2 = 2 + Math.floor(hash(c.founder, k, 11) * 5);
        if (y2 + len2 <= end) c.independence = { year: y2 + len2, how: 'war', warFrom: y2, name: freeName() };
      }
    }
  }
  out.sort((a, b) => a.id - b.id);
  cache.set(civ, out);
  return out;
}

/** 殖民地的事件(航天面板列,和 spaceEntries 一起):建立(月球、火星的建立 spaceText 已写,这里写轨道城、小行星带)、人口过一万 / 十万 / 百万、归属变了、自治、独立 */
export function colonyEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  let id = idBase;
  const end = civ.endYear;
  const pn = (pid: number, y: Year) => (pid >= 0 && civ.polities[pid] ? polityName(civ.polities[pid], y) : '');
  const push = (c: Colony, y: Year, text: string, importance: Importance) => {
    if (y > end) return;
    const owner = colonyOwner(c, Math.max(c.founded, y - 0.01));
    out.push({ id: id++, kind: 'era', year: y, end: y, text, tag: '天', importance, polities: owner >= 0 ? [owner] : [c.founder], regions: [], settlement: -1 });
  };
  for (const c of colonies(civ)) {
    const B = bodyName(civ, c.body);
    if (c.body === 'ring') push(c, c.founded, `${pn(c.founder, c.founded)}在同步轨道环上建成第一批居住舱「${c.name}」,首批 ${c.p0} 名居民迁入`, 2);
    if (c.body === 'belt') push(c, c.founded, `${pn(c.founder, c.founded)}在小行星带建立「${c.name}」,开采金属和水冰`, 1);
    for (const [n, word, imp] of [[1e4, '一万', 1], [1e5, '十万', 2], [1e6, '一百万', 2]] as const) {
      const y = yearAtPop(c, n);
      if (y > end || y === Infinity) continue;
      const rename = n === CITY_POP && c.city !== c.name ? `,改称「${c.city}」` : '';
      push(c, y, `${B}「${colonyName(c, y - 0.01)}」人口突破${word}${rename}`, imp);
    }
    if (c.handover) {
      const was = pn(c.founder, c.handover.year - 0.01);
      push(c, c.handover.year, c.handover.to >= 0 ? `${was}灭亡,${B}「${colonyName(c, c.handover.year)}」改归${pn(c.handover.to, c.handover.year)}` : `${was}灭亡,${B}「${colonyName(c, c.handover.year)}」失去母国,自立`, 2);
    }
    if (c.autonomy !== undefined) push(c, c.autonomy, `${B}「${colonyName(c, c.autonomy)}」(${headText(colonyPop(c, c.autonomy))})获得自治,设立自己的议会`, 2);
    if (c.crushed) {
      push(c, c.crushed.from, `${B}「${colonyName(c, c.crushed.from)}」宣布独立,${pn(colonyOwner(c, c.crushed.from), c.crushed.from)}派兵镇压,独立战争爆发`, 2);
      push(c, c.crushed.to, `${B}「${colonyName(c, c.crushed.to)}」的独立战争失败,${pn(colonyOwner(c, c.crushed.to), c.crushed.to)}恢复控制`, 2);
    }
    const I = c.independence;
    if (I) {
      const lord = pn(colonyOwner(c, I.year - 0.01), I.year);
      if (I.how === 'referendum') push(c, I.year, `${B}「${colonyName(c, I.year - 0.01)}」举行独立公投,多数赞成脱离${lord};「${I.name}」和平成立,人口${headText(colonyPop(c, I.year))}`, 3);
      else {
        if (I.warFrom !== undefined) push(c, I.warFrom, `${B}「${colonyName(c, I.warFrom)}」宣布独立,${lord}派兵镇压,独立战争爆发`, 2);
        push(c, I.year, `${B}独立战争结束,${lord}承认「${I.name}」独立,人口${headText(colonyPop(c, I.year))}`, 3);
      }
    }
  }
  return out;
}
