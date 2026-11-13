/**
 * 本地分支 modern-pace:随时代解锁的东西(底图、航天面板、月球视图)和这两样的开关。
 *
 * 解锁按"世上头一回"(哪国都算),看时间轴当前年份:
 *   地理图   头一个国家进入工业时代(Polity.modern[0])—— 没手动选过底图的,这时起手绘自动换成地理图(手绘仍可选)
 *   卫星     第一颗人造卫星(发明"人造卫星")—— 没手动选过底图的,这时起自动换成卫星
 *   白模     第一个卫星导航系统(发明"卫星导航")
 *   航天面板 = 卫星那年;月球视图 = 第一次绕月探测(spaceText.ts 的 lunar)
 * 没有历史(新建世界、改地形)或历史推不出来的,全部不锁。数据底图(生态、高程……)不锁。
 */
import { useMemo, useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import { INVENTIONS } from '../gen/civ/inventions';
import { spaceRace } from '../gen/civ/story/spaceText';
import { getCivTime, subscribeCivTime } from './civView';

export interface UnlockYears {
  industry?: number;
  sat?: number;
  gnss?: number;
  lunar?: number;
  /** 第五十一轮:世上头一回有了电力(夜景解锁) */
  power?: number;
}

const years = new WeakMap<Civ, UnlockYears>();
export function unlockYears(civ: Civ): UnlockYears {
  const hit = years.get(civ);
  if (hit) return hit;
  const out: UnlockYears = {};
  for (const p of civ.polities) {
    const t = p.modern?.[0];
    if (t !== undefined && (out.industry === undefined || t < out.industry)) out.industry = t;
  }
  const iSat = INVENTIONS.findIndex((x) => x.name === '人造卫星');
  const iNav = INVENTIONS.findIndex((x) => x.name === '卫星导航');
  const iPow = INVENTIONS.findIndex((x) => x.name === '电力');
  for (const e of civ.development?.events ?? []) {
    if (e.kind !== 'invent' || e.invention === undefined) continue;
    if (e.invention === iSat && (out.sat === undefined || e.year < out.sat)) out.sat = e.year;
    if (e.invention === iNav && (out.gnss === undefined || e.year < out.gnss)) out.gnss = e.year;
    if (e.invention === iPow && (out.power === undefined || e.year < out.power)) out.power = e.year;
  }
  const l = spaceRace(civ).firstOf.get('lunar');
  if (l) out.lunar = l.y;
  years.set(civ, out);
  return out;
}

export interface Unlocks {
  /** 没有历史:全部不锁 */
  all: boolean;
  geo: boolean;
  satellite: boolean;
  blank: boolean;
  /** 航天面板 */
  space: boolean;
  /** 月球视图 */
  moon: boolean;
  /** 夜景(第五十一轮:有了电力以后) */
  night: boolean;
}

const ALL: Unlocks = { all: true, geo: true, satellite: true, blank: true, space: true, moon: true, night: true };

export function unlocksAt(civ: Civ | null, year: number): Unlocks {
  if (!civ || !civ.viable) return ALL;
  const y = unlockYears(civ);
  const at = (t?: number) => t !== undefined && t <= year;
  return { all: false, geo: at(y.industry), satellite: at(y.sat), blank: at(y.gnss), space: at(y.sat), moon: at(y.lunar), night: at(y.power) };
}

/** 锁着的底图在图层面板里写的说明 */
export const LOCK_HINT = {
  geo: '世上头一个国家进入工业时代以后解锁',
  satellite: '第一颗人造卫星上天以后解锁',
  blank: '第一个卫星导航系统建成以后解锁',
} as const;

const keyOf = (u: Unlocks) => (u.all ? 'all' : `${+u.geo}${+u.satellite}${+u.blank}${+u.space}${+u.moon}${+u.night}`);

/** 跟着时间轴的解锁状态(只在跨过门槛时才变) */
export function useUnlocks(civ: Civ | null): Unlocks {
  const key = useSyncExternalStore(
    (f) => subscribeCivTime(() => f()),
    () => {
      if (!civ || !civ.viable) return 'all';
      const t = getCivTime().year ?? civ.endYear;
      return keyOf(unlocksAt(civ, Math.min(civ.endYear, Math.max(0, t))));
    },
  );
  return useMemo(() => {
    if (key === 'all') return ALL;
    const b = (i: number) => key[i] === '1';
    return { all: false, geo: b(0), satellite: b(1), blank: b(2), space: b(3), moon: b(4), night: b(5) };
  }, [key]);
}

// ---- 航天面板、月球视图开没开 ----
/** 从地球仪缩出去那一刻:地球仪正对的经纬度(弧度)、球心(相对视口)、半径(像素) */
export interface SystemEntry {
  lon: number;
  lat: number;
  cx: number;
  cy: number;
  R: number;
  /** 进来时镜头盯着什么(第四十九轮:点"月球"按钮 = 盯着月球;不给 = 母星) */
  focus?: 'moon';
}
interface SpaceUi {
  panel: boolean;
  moon: boolean;
  /** 恒星系视图(地球仪缩到最小再往外缩):开着 = 进去那一刻的地球仪 */
  system: SystemEntry | null;
  /** 恒星系视图里按播放走多快(每秒几年;null = 历史档,照时间轴的 1× / 4×) */
  astro: number | null;
  /** 月球视图画成球(true)还是平面 */
  moonGlobe: boolean;
  /** 夜景开着(第五十一轮) */
  night: boolean;
  /** 第八十八轮:地球仪真实晨昏线开着(默认开) */
  term: boolean;
}
let ui: SpaceUi = { panel: false, moon: false, moonGlobe: false, system: null, astro: 1 / 365.25, night: false, term: true };
const subs = new Set<() => void>();
const emit = (next: SpaceUi) => {
  ui = next;
  for (const f of subs) f();
};
export const toggleSpacePanel = () => emit({ ...ui, panel: !ui.panel });
export const closeSpacePanel = () => ui.panel && emit({ ...ui, panel: false });
export const setMoonView = (on: boolean) => ui.moon !== on && emit({ ...ui, moon: on });
export const setMoonGlobe = (on: boolean) => ui.moonGlobe !== on && emit({ ...ui, moonGlobe: on });
export const setNight = (on: boolean) => ui.night !== on && emit({ ...ui, night: on });
export const setTerm = (on: boolean) => ui.term !== on && emit({ ...ui, term: on });
export const enterSystemView = (e: SystemEntry) => !ui.system && emit({ ...ui, system: e });
export const exitSystemView = () => ui.system && emit({ ...ui, system: null });
/** 天文档的几挡(每秒走多少;按这个世界一年几天换算成年) */
export const ASTRO_STEPS: { name: string; days: number | null }[] = [
  { name: '1 小时/秒', days: 1 / 24 },
  { name: '1 天/秒', days: 1 },
  { name: '10 天/秒', days: 10 },
  { name: '100 天/秒', days: 100 },
  { name: '历史档', days: null },
];
export const setAstro = (yearsPerSec: number | null) => ui.astro !== yearsPerSec && emit({ ...ui, astro: yearsPerSec });
export const getSpaceUi = () => ui;
export function useSpaceUi(): SpaceUi {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ui,
  );
}
