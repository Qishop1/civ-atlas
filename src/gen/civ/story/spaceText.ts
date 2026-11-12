/**
 * 本地分支 modern-pace 第二十六轮:太空任务(编年史,标签"天";只读推演结果,不改推演)。
 *
 * 航天这一线(development.ts 的发明:人造卫星、载人航天、深空探测、空间站、月球基地、火星殖民)原来只有一句
 * "某城在全世界率先研制成功某某";这里按国家展开成一串具体任务 —— 某国国都那州的能力到了那一档(世上也已经有人做到,见 DevEvent invent)
 * 的那一年,这国办成这一件:有任务名、飞船名、航天员的名字;世上头一个的写"人类首次……"。另加两样不进科技树的:
 *   - 首次载人登月:载人航天之后、运输能力到 7.48;
 *   - 太空电梯:第四十五轮起由推演决定(development.ts 记史事 tower:动工那年、锚点州、工期),这里只读;动工时的元首没等到完工就去世的,以他的名字命名("遗愿")。
 * 载人的、登月的、火星的头一回有一定机会先失败一次(发射失败 / 返回时失事,航天员遇难),几年后再成。
 * 名字:飞船、卫星用这国自己的城名、州名 + "号";人名用这国民族语感的人名生成器。按史事、国家编号挑,同一个世界每次一样。
 */
import { blockadesOf } from '../orbit';
import type { Civ, Person, Polity, Year } from '../types';
import { capitalAt, polityName } from '../growth';
import { CAP_COUNT, INVENTIONS, developmentAt } from '../development';
import { personNamers } from '../naming';
import { regionLabel } from './display';
import { rulerAt } from './peopleInfo';
import { starSystem } from './systemText';
import { autoMoonSite, farSide, moonAtlas, moonCoordText, moonOffset, moonPlaceName } from './moonAtlas';
import type { ChronicleEntry, Importance } from './chronicle';

export const SPACE_TAG = '天';

/** 一件里程碑:看哪样发明(没有 = 不进科技树的那两样,按能力门槛) */
interface Mile {
  key: 'sat' | 'crew' | 'moon' | 'probe' | 'station' | 'base' | 'tower' | 'mars' | 'lunar';
  inv?: string;
  /** 不进科技树的:要先办成哪几件、能力门槛 [能力, 档] */
  after?: Mile['key'][];
  need?: [number, number][];
}
const MILES: readonly Mile[] = [
  { key: 'sat', inv: '人造卫星' },
  { key: 'crew', inv: '载人航天', after: ['sat'] },
  { key: 'moon', after: ['crew', 'lunar'], need: [[1, 7.48]] },
  { key: 'probe', inv: '深空探测', after: ['crew'] },
  { key: 'station', inv: '空间站', after: ['crew'] },
  { key: 'base', inv: '月球基地', after: ['moon', 'station'] },
  { key: 'tower', after: ['station'], need: [[1, 8.4], [0, 8.1]] },
  { key: 'mars', inv: '火星殖民', after: ['base', 'probe'] },
  // 月球面板:绕月探测器(测绘全月面;航天页的月面图从世上头一个这样做的那年起才看得到)。排在最后:前面几样的序号(飞船名、人名按它挑)不变
  { key: 'lunar', after: ['sat'] },
];
/** 隔几年看一次;太空电梯建几年(15–25);天下至多几座 */
const STEP = 1;
const TOWER_MIN = 15;
/** 前面那几件办成以后至少隔几年才办这一件(照现实的节奏:卫星 → 4 年载人 → 8 年登月……) */
const GAP: Readonly<Record<Mile['key'], number>> = { sat: 0, crew: 4, moon: 8, probe: 3, station: 10, base: 20, tower: 30, mars: 25, lunar: 2 };

/** 航天页用:各国办成各件的年份、世上头一个、登月 / 月球基地的地点、为月背着陆发的中继卫星 */
export interface MoonSite {
  lon: number;
  lat: number;
  /** 作者指定的(干预 moonsite) */
  byAuthor?: boolean;
}
export interface SpaceRace {
  done: Map<number, Map<Mile['key'], Year>>;
  firstOf: Map<Mile['key'], { p: number; y: Year }>;
  landings: Map<number, MoonSite & { year: Year }>;
  bases: Map<number, MoonSite & { year: Year }>;
  relays: Map<number, Year>;
}
export type SpaceMile = Mile['key'];
/** 航天页的列:按这个顺序 */
export const SPACE_MILES: readonly { key: SpaceMile; name: string }[] = [
  { key: 'sat', name: '人造卫星' },
  { key: 'lunar', name: '绕月探测' },
  { key: 'crew', name: '载人航天' },
  { key: 'moon', name: '载人登月' },
  { key: 'probe', name: '深空探测' },
  { key: 'station', name: '空间站' },
  { key: 'base', name: '月球基地' },
  { key: 'tower', name: '太空电梯' },
  { key: 'mars', name: '行星定居' },
];
const raceCache = new WeakMap<Civ, SpaceRace>();
const EMPTY_RACE = (): SpaceRace => ({ done: new Map(), firstOf: new Map(), landings: new Map(), bases: new Map(), relays: new Map() });
export function spaceRace(civ: Civ): SpaceRace {
  const hit = raceCache.get(civ);
  if (hit) return hit;
  spaceEntries(civ, 0);
  return raceCache.get(civ) ?? EMPTY_RACE();
}

export const spaceHash = (a: number, b: number, c = 0) => hash(a, b, c);
const hash = (a: number, b: number, c = 0) => {
  const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

/** 这一国的飞船 / 卫星名:本国的城名、州名轮着用 */
export function craftName(civ: Civ, p: Polity, k: number): string {
  const names: string[] = [];
  // 本民族的城(编年史这里不逐年查归属,按民族近似)
  for (const s of civ.settlements) if (s.name && s.culture === p.culture) names.push(s.name);
  if (!names.length) names.push(p.name);
  return names[Math.floor(hash(p.id, k, 1) * names.length)];
}

/** 这一国民族语感的人名 */
function personName(civ: Civ, p: Polity, k: number, female = false): string {
  const style = civ.cultures[p.culture]?.style || 'kingdom';
  const nm = personNamers(civ.seed)(style);
  const a = p.id * 7919 + k;
  const given = female ? nm.femaleGiven(a, 3) : nm.given(a, 3);
  return nm.surnamed ? `${nm.surname(a, 5)}${given}` : given;
}

/** 第二十七轮:一座太空电梯(地图上的奇观层用):哪国、在哪州、哪年动工、建几年、叫什么(没建成的 = 动工时的名字) */
export interface SpaceTower {
  polity: number;
  region: number;
  start: Year;
  build: number;
  name: string;
}
const towerCache = new WeakMap<Civ, SpaceTower[]>();

/** 第三十六轮:同步轨道环 —— 哪国建、哪年动工 / 合龙、叫什么;segs = 相邻两座电梯(按经度向东)之间那一段哪年接通(towers 里的下标) */
export interface OrbitalRing {
  polity: number;
  start: Year;
  end: Year;
  name: string;
  /** 支点:spaceTowers 里的下标,按经度从西往东 */
  towers: number[];
  segs: { a: number; b: number; done: Year }[];
}
/** 同步轨道周长 km(地球半径 6371 + 高 35786)、环宽 km */
export const RING_KM = 2 * Math.PI * (6371 + 35786);
export const RING_WIDTH_KM = 10;
const ringCache = new WeakMap<Civ, OrbitalRing | null>();
/** 这个世界的同步轨道环(没有 = null;没算过编年史的现算一遍) */
export function orbitalRing(civ: Civ): OrbitalRing | null {
  if (ringCache.has(civ)) return ringCache.get(civ)!;
  spaceEntries(civ, 0);
  return ringCache.get(civ) ?? null;
}
/** 这个世界的太空电梯(没算过编年史的现算一遍,记下) */
export function spaceTowers(civ: Civ): SpaceTower[] {
  const hit = towerCache.get(civ);
  if (hit) return hit;
  spaceEntries(civ, 0);
  return towerCache.get(civ) ?? [];
}

export function spaceEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const dev = civ.development;
  const towerList: SpaceTower[] = [];
  towerCache.set(civ, towerList);
  raceCache.set(civ, EMPTY_RACE());
  ringCache.set(civ, null);
  if (!dev) return [];
  // 世上头一回有这样发明的年份
  const firstInv = new Map<string, Year>();
  for (const e of dev.events) if (e.kind === 'invent' && e.invention !== undefined && INVENTIONS[e.invention]) {
    const n = INVENTIONS[e.invention].name;
    if (!firstInv.has(n) || firstInv.get(n)! > e.year) firstInv.set(n, e.year);
  }
  const t0 = firstInv.get('人造卫星');
  if (t0 === undefined) return [];
  const end = civ.endYear;
  /** 国号档位到了 tier 以上(王国 2、帝国 3) */
  const big = (p: Polity, y: Year, tier = 2) => (p.titles?.filter((x) => x.year <= y).pop()?.tier ?? 0) >= tier || p.federation !== undefined;
  /** 国家 → 里程碑 → 办成的年份 */
  const done = new Map<number, Map<Mile['key'], Year>>();
  const cands = civ.polities.filter((p) => (p.modern?.length ?? 0) >= 2);
  // 第四十五轮:太空电梯由推演决定(development.ts 记史事 tower),这里只读
  const towerAnn = new Map<number, { year: Year; region: number; build: number }>();
  for (const a of civ.annals) if (a.kind === 'tower' && !towerAnn.has(a.a)) towerAnn.set(a.a, { year: a.year, region: a.region, build: a.n ?? TOWER_MIN });
  // 第六十六轮:近地轨道被碎片封锁的那些年不办新任务,顺延到解封以后(orbit.ts)
  const blocks = blockadesOf(civ.annals);
  const blocked = (y: Year) => blocks.some((b) => y >= b.year && y < b.until);
  let buf: Float32Array | undefined;
  // 发展度按 20 年一份快照插值:逐年看太费,按 STEP 年看;能力只在快照之间线性变,隔 5 年取一份就够
  for (let y = Math.floor(t0); y <= end; y += STEP) {
    if ((y - Math.floor(t0)) % 5 === 0 || !buf) buf = developmentAt(dev, y, buf);
    for (const p of cands) {
      if (p.founded > y || (p.ended !== undefined && p.ended <= y)) continue;
      const sid = capitalAt(p, y);
      const r = civ.settlements[sid]?.region ?? -1;
      if (r < 0) continue;
      let m = done.get(p.id);
      for (const mi of MILES) {
        if (m?.has(mi.key)) continue;
        if (mi.key === 'tower') {
          const ta = towerAnn.get(p.id);
          if (!ta || ta.year > y) continue;
          if (!m) done.set(p.id, (m = new Map()));
          m.set('tower', ta.year);
          continue;
        }
        if (mi.after && !mi.after.every((a) => m?.has(a) && m.get(a)! + GAP[mi.key] <= y)) continue;
        if (blocked(y)) continue;
        let ok: boolean;
        if (mi.inv) {
          const i = INVENTIONS.findIndex((x) => x.name === mi.inv);
          const fy = firstInv.get(mi.inv);
          ok = i >= 0 && fy !== undefined && fy <= y && buf[r * CAP_COUNT + INVENTIONS[i].cap] >= INVENTIONS[i].level;
        } else ok = (mi.need ?? []).every(([c, lv]) => buf![r * CAP_COUNT + c] >= lv);
        if (!ok) continue;
        if (!m) done.set(p.id, (m = new Map()));
        m.set(mi.key, y);
      }
    }
  }
  // 世上头一个
  const firstOf = new Map<Mile['key'], { p: number; y: Year }>();
  for (const [p, m] of done) for (const [k, y] of m) {
    const f = firstOf.get(k);
    if (!f || y < f.y || (y === f.y && p < f.p)) firstOf.set(k, { p, y });
  }
  // 登月的地点:作者的干预 moonsite 按先后各管"那年及以后头一次登月"(哪国都算);其余自动挑(正面低纬的月海)。
  // 月背的:那国没发过中继卫星的,登月前一年先发一颗(月背对地球看不见,没有中继就没法测控)
  const atlas = moonAtlas(civ);
  const landings = new Map<number, MoonSite & { year: Year }>();
  const bases = new Map<number, MoonSite & { year: Year }>();
  const relays = new Map<number, Year>();
  const lands = [...done].filter(([, m]) => m.has('moon')).map(([p, m]) => ({ p, y: m.get('moon')! })).sort((a, b) => a.y - b.y || a.p - b.p);
  const ivs = (civ.interventions ?? []).filter((v): v is Extract<typeof v, { kind: 'moonsite' }> => v.kind === 'moonsite').sort((a, b) => a.from - b.from);
  for (const v of ivs) {
    const l = lands.find((x) => x.y >= v.from && !landings.has(x.p));
    if (l) landings.set(l.p, { lon: v.lon, lat: v.lat, year: l.y, byAuthor: true });
  }
  for (const l of lands) {
    if (!landings.has(l.p)) landings.set(l.p, { ...autoMoonSite(atlas, l.p, 0), year: l.y });
    const s = landings.get(l.p)!;
    if (farSide(s.lon)) relays.set(l.p, Math.max(Math.floor(done.get(l.p)!.get('lunar') ?? t0) + 1, Math.floor(l.y) - 1));
    const by = done.get(l.p)!.get('base');
    if (by !== undefined) bases.set(l.p, { ...moonOffset(s.lon, s.lat, hash(l.p, 41) * 360, 8 + hash(l.p, 42) * 25), year: by, ...(s.byAuthor ? { byAuthor: true } : {}) });
  }
  raceCache.set(civ, { done, firstOf, landings, bases, relays });
  const firstFar = [...landings].filter(([, s]) => farSide(s.lon)).sort((a, b) => a[1].year - b[1].year || a[0] - b[0])[0]?.[0];
  const firstRelay = [...relays].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]?.[0];
  const placeOf = (s: MoonSite) => `${moonPlaceName(atlas, s.lon, s.lat)}(${moonCoordText(s.lon, s.lat)})`;

  const out: ChronicleEntry[] = [];
  let id = idBase;
  /** 太空竞赛:不是世上头一个、但只差 RACE 年以内的,补一句"与某国同年 / 仅比某国晚几年" */
  const RACE = 3;
  const race = (k: Mile['key'], pid: number, y: Year): string => {
    const f = firstOf.get(k);
    if (!f || f.p === pid) return '';
    const d = Math.floor(y) - Math.floor(f.y);
    if (d > RACE) return '';
    const F = polityName(civ.polities[f.p], f.y);
    return d <= 0 ? `,与${F}同年` : `,仅比${F}晚 ${d} 年`;
  };
  const push = (p: Polity, y: Year, text: string, importance: Importance, people?: number[], region = -1) => {
    out.push({
      id: id++,
      kind: 'era',
      year: y,
      end: y,
      text,
      tag: SPACE_TAG,
      importance,
      polities: [p.id],
      regions: region >= 0 ? [region] : [],
      settlement: -1,
      ...(people?.length ? { people } : {}),
    });
  };

  for (const [pid, m] of [...done].sort((a, b) => a[0] - b[0])) {
    const p = civ.polities[pid];
    const kOf = (k: Mile['key']) => MILES.findIndex((x) => x.key === k);
    for (const [k, y] of m) {
      const A = polityName(p, y);
      const first = firstOf.get(k)?.p === pid;
      const imp: Importance = first ? 3 : big(p, y) ? 2 : 1;
      const ship = `「${craftName(civ, p, kOf(k) * 13 + 1)}号」`;
      const a1 = personName(civ, p, kOf(k) * 31 + 1);
      const a2 = personName(civ, p, kOf(k) * 31 + 2, true);
      // 头一回失败一次(载人、登月、火星)
      const risky = k === 'crew' || k === 'moon' || k === 'mars';
      const fail = risky && hash(pid, kOf(k), 9) < (first ? 0.25 : 0.15);
      const capR = civ.settlements[capitalAt(p, y)]?.region ?? -1;
      if (fail) {
        const prev = Math.max(t0, ...(MILES.find((x) => x.key === k)?.after ?? []).map((a) => m.get(a) ?? t0));
        const fy = Math.max(Math.ceil(prev) + 1, y - 2 - Math.floor(hash(pid, kOf(k), 10) * 4));
        const lost = `「${craftName(civ, p, kOf(k) * 13 + 7)}号」`;
        const how = hash(pid, kOf(k), 11) < 0.5 ? '火箭升空后不久爆炸' : '返回时在大气层中解体';
        push(p, fy, `${polityName(p, fy)}${lost}${how},航天员${personName(civ, p, kOf(k) * 31 + 7)}、${personName(civ, p, kOf(k) * 31 + 8, true)}遇难`, imp === 3 ? 2 : 1, undefined, capR);
      }
      switch (k) {
        case 'sat':
          push(p, y, `${A}成功发射第一颗人造卫星${ship}${first ? ',这是世界上第一颗人造卫星' : ''}${race('sat', pid, y)}`, imp, undefined, capR);
          break;
        case 'crew':
          push(p, y, `${A}航天员${a1}乘${ship}飞船进入太空${first ? ',人类首次进入太空' : `,成为${A}第一位进入太空的人`}${race('crew', pid, y)}`, imp, undefined, capR);
          break;
        case 'moon': {
          const s = landings.get(pid);
          const ry = relays.get(pid);
          if (ry !== undefined)
            push(p, ry, `${polityName(p, ry)}发射月球中继卫星「${craftName(civ, p, 8 * 13 + 5)}号」,停在地月拉格朗日点,为月球背面着陆提供测控通信${firstRelay === pid ? ',这是世界上第一颗月球中继卫星' : ''}`, firstRelay === pid ? 2 : 1, undefined, capR);
          const at = s ? `在${placeOf(s)}` : '在月面';
          push(p, y, `${A}${ship}登月舱${at}着陆,航天员${a1}、${a2}踏上月球${first ? ',人类首次登上月球' : ''}${firstFar === pid && !first ? ',这是人类首次在月球背面着陆' : ''}${race('moon', pid, y)}`, imp, undefined, capR);
          break;
        }
        case 'lunar':
          push(p, y, `${A}${ship}绕月探测器进入月球轨道,测绘全月面地形${first ? ',人类第一次得到完整的月面图' : ''}${race('lunar', pid, y)}`, first ? 2 : 1, undefined, capR);
          break;
        case 'probe':
          push(p, y, `${A}${ship}探测器飞越外行星,发回第一批近距离照片${first ? ',人类第一次近距离看到别的行星' : ''}`, imp === 3 ? 2 : imp, undefined, capR);
          break;
        case 'station':
          push(p, y, `${A}${ship}空间站入轨,航天员开始长期驻留${first ? ',这是世界上第一座空间站' : ''}${race('station', pid, y)}`, imp === 3 ? 2 : imp, undefined, capR);
          break;
        case 'base':
          push(p, y, `${A}在${bases.has(pid) ? placeOf(bases.get(pid)!).replace(/^(?!月球)/, '月球') : '月球'}建起常驻基地「${craftName(civ, p, 77)}基地」${first ? ',人类第一次在另一个天体上长期居住' : ''}`, imp, undefined, capR);
          break;
        case 'mars':
          // 第三十七轮:殖民的是恒星系里生成的那颗(systemText.ts),不再是"火星"
          {
            const S = starSystem(civ);
            push(p, y, `${A}${ship}载着首批移民在${S.targetName}着陆,建立定居点${first ? (S.moonOf ? ',人类第一次在外行星的卫星上定居' : ',人类第一次在另一颗行星上定居') : ''}${race('mars', pid, y)}`, imp, undefined, capR);
          }
          break;
        case 'tower': {
          // 太空电梯:动工 → TOWER_YEARS 年后建成;赤道附近的州(没有就国都那州)
          const ta = towerAnn.get(pid)!;
          const y0 = y;
          const build = ta.build;
          const y1 = Math.min(end, y + build);
          const site = ta.region;
          const lat0 = site >= 0 ? civ.regions.lat?.[site] : undefined;
          // 第三十六轮:电梯得建在赤道上 —— 锚台在那城同一经度的赤道上(城不在赤道上的写"以南 / 以北约多少公里的赤道上")
          const near = site >= 0 ? regionLabel(civ, site) : '';
          const siteName = !near ? '' : lat0 === undefined || Math.abs(lat0) < 1 ? near : `${near}${lat0 > 0 ? '以南' : '以北'}约 ${Math.round((Math.abs(lat0) * 111) / 10) * 10} 公里的赤道上`;
          const boss: Person | null = rulerAt(civ, p.id, y0);
          const bossName = boss?.name ?? '';
          push(p, y0, `${A}${bossName ? `在${bossName}主持下` : ''}于${siteName || '沿海'}动工兴建太空电梯,碳纳米管缆绳将从地面直伸到同步轨道以外`, first ? 3 : 2, boss ? [boss.id] : undefined, site);
          // 动工时主持的元首没等到完工就去世:约一半以他的名字命名(遗愿),另一半照常起名
          const gone = !!boss && boss.died !== undefined && boss.died < y1 && hash(pid, 5, 4) < 0.5;
          const name = gone ? `「${bossName}号」` : `「${craftName(civ, p, 91)}天梯」`;
          towerList.push({ polity: pid, region: site, start: y0, build, name: name.slice(1, -1) });
          if (y + build <= end) {
            const legacy = gone ? `;动工时主持此事的${bossName}已在第 ${Math.floor(boss!.died!)} 年去世,未能看到它建成,为完成其遗愿、纪念其功绩,命名为${name}` : `,命名为${name}`;
            push(p, y1, `${polityName(p, y1)}${siteName ? siteName : ''}的太空电梯历时 ${build} 年建成${legacy}${first ? '。这是世界上第一座太空电梯,进出太空的代价从此大降' : ''}`, first ? 3 : 2, boss ? [boss.id] : undefined, site);
          }
          break;
        }
      }
    }
  }

  // ---- 第三十六轮:同步轨道环 ----
  // 第二座太空电梯建成后 10–19 年,动工那年的大国(地球联邦;没有就第一座电梯的主人,得是帝国那一档)把已建成的各座电梯连成一圈:
  // 相邻两座之间一段,从两头往中间接,各段在工期的六成到全程之间接通,最后一段接通 = 合龙(工期 40–60 年)
  const built = towerList.map((t, i) => ({ t, i, y: t.start + t.build })).filter((x) => x.y <= end && x.t.region >= 0).sort((a, b) => a.y - b.y || a.i - b.i);
  if (built.length >= 2) {
    const r0 = Math.floor(built[1].y) + 10 + Math.floor(hash(built[1].i, 61) * 10);
    const fed = civ.polities.find((P) => P.federation !== undefined && P.federation <= r0 && (P.ended === undefined || P.ended > r0));
    const owner = fed ?? civ.polities[built[0].t.polity];
    if (r0 <= end && owner && (owner.ended === undefined || owner.ended > r0) && big(owner, r0, 3)) {
      const span = 40 + Math.floor(hash(owner.id, 62) * 21);
      const lonOf = (i: number) => civ.regions.lon?.[towerList[i].region] ?? i * 90;
      const nodes = built.filter((x) => x.y <= r0).map((x) => x.i).sort((a, b) => lonOf(a) - lonOf(b));
      const segs = nodes.map((a, k) => ({ a, b: nodes[(k + 1) % nodes.length], done: r0 + Math.round(span * (0.6 + 0.4 * hash(a, 63))) }));
      // 最晚的那段 = 合龙,定在工期满那年
      const last = segs.reduce((m, s, k) => (s.done > segs[m].done ? k : m), 0);
      segs[last].done = r0 + span;
      const boss: Person | null = rulerAt(civ, owner.id, r0);
      const bossName = boss?.name ?? '';
      const y1 = r0 + span;
      const gone = !!boss && boss.died !== undefined && boss.died < y1 && hash(owner.id, 64) < 0.5;
      const name = gone ? `${bossName}环` : `${craftName(civ, owner, 93)}环`;
      ringCache.set(civ, { polity: owner.id, start: r0, end: y1, name, towers: nodes, segs });
      const A0 = polityName(owner, r0);
      const tn = (i: number) => `「${towerList[i].name}」`;
      push(owner, r0, `${A0}${bossName ? `在${bossName}主持下` : ''}动工兴建同步轨道环:以${nodes.length === 2 ? `${tn(nodes[0])}和${tn(nodes[1])}两` : `${nodes.map(tn).join('、')}这${['', '', '两', '三', '四', '五'][nodes.length] ?? nodes.length}`}座太空电梯为支点,沿赤道上空约 3.6 万公里的同步轨道连成一圈,设计全长约 ${(RING_KM / 1e4).toFixed(1)} 万公里、宽约 ${RING_WIDTH_KM} 公里,环上铺设太阳能阵列和交通线`, 3, boss ? [boss.id] : undefined);
      for (const [k, s] of segs.entries()) {
        if (k === last || s.done > end) continue;
        const dl = ((lonOf(s.b) - lonOf(s.a) + 360) % 360 || 360) / 360;
        push(owner, s.done, `${polityName(owner, s.done)}同步轨道环${tn(s.a)}至${tn(s.b)}段接通,长约 ${((RING_KM * dl) / 1e4).toFixed(1)} 万公里`, 1);
      }
      if (y1 <= end) {
        const legacy = gone ? `;动工时主持此事的${bossName}已在第 ${Math.floor(boss!.died!)} 年去世,为完成其遗愿,命名为「${name}」` : `,命名为「${name}」`;
        push(owner, y1, `${polityName(owner, y1)}的同步轨道环历时 ${span} 年合龙${legacy}。各座太空电梯由此连成一体,环上的太阳能阵列向地面输电`, 3, boss ? [boss.id] : undefined);
      }
    }
  }
  return out;
}

