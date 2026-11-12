/**
 * 本地分支 modern-pace 第六十四轮:核冬天的后果(用户"现在的核战争给我感觉就是没感觉 看一大堆核交换 然后就没了")。
 *
 * 原来:命中 WINTER_HITS 发以上记一条核冬天(nuke n = 4),只让饥荒的机会多几倍、夜景熄几年;能力"扣一点、按到过的最高值很快恢复"(技术永远不丢)。
 * 文献(Toon 2019、Xia 2022、Robock 2007):直接炸死的只占小头,文明倒退的主因是之后几年全球减产引发的饥荒、供应链和电网断裂 ——
 * 美俄全面交换(150 Tg 烟尘)饥荒死亡可达世界人口六成。
 *
 * 现在,核冬天那一刻(wars.ts 的 afterNukes,nuclearFamine)按一个**轻重 sev**(0–1)结算:
 *   sev = 命中发数定的底子((命中 − 40) ÷ 360,0.1–1)× 对数正态的随机(气候敏感度、社会韧性;σ = 0.7),封顶 1 —— 同样的核战,结局可轻可重
 *   - 饥荒:每座城折损 (0.05 + 0.6 sev) × (0.7–1.3 随机),乡下同样掉(growth.ts 的 RURAL_WINTER);核冬天加 FAMINE_TAIL 年里不长回来(sack.until);
 *     各国记一条饥荒(动荡照饥荒算 → 国家崩解、散回部落的机会大增)
 *   - 能力(development.ts 读这里):那一刻各州四样能力扣 sev^1.3 × NW_HIT 个时代(电网、运输、行政最重),
 *     **到过的最高值也削掉 sev^1.5 × NW_PEAK**(技术失传:会造的人死了、厂毁了,书本还在 —— 能比第一次爬得快,但不一定爬得回去);
 *     核冬天余波里每年再往下掉一点(NW_SLUMP),向邻居学几乎停下
 *   - 再起来要过原来的门槛:进工业要煤铁、进电气要石油、进信息要稀有矿 —— 第一次工业化采空了的(development.ts 的 deplete)就卡住
 * 史事:nuke n = 6(oob = [核冬天年数, sev × 1000, 余波到哪一年]);编年史按前后的天下人口写死了多少人。
 */
import type { CivSim } from './engine/sim';

/** 核冬天余波里大崩解的动荡加多少(× sev;unrest.ts 的 crisis) */
export const WINTER_U = 1.6;
/** 核冬天那一刻大国散架的机会(× sev^1.5);国土至少几州才掷 */
export const WINTER_SHATTER = 0.85;
export const WINTER_SHATTER_MIN = 8;
/** 动荡模型里核冬天的饥荒记几州(足够大 = 占满国土) */
export const WINTER_FAMINE_N = 100000;
/** 核冬天结束后还有这么多年饥荒、无人收拾(人口不长回来、能力继续掉) */
export const FAMINE_TAIL = 8;
/** 能力一次扣多少个时代(生产、运输、信息、行政;× sev^1.3) */
export const NW_HIT: readonly number[] = [3.6, 4.6, 4.0, 4.6];
/** 动员一次扣多少 */
export const NW_HIT_MOB = 4;
/** 到过的最高值削多少个时代(× sev^1.5) */
export const NW_PEAK: readonly number[] = [3.4, 3.4, 3.4, 3.4];
/** 余波里每年再掉多少(× sev) */
export const NW_SLUMP: readonly number[] = [0.04, 0.06, 0.05, 0.06];

export interface Aftermath {
  /** 核冬天开始那年 */
  year: number;
  /** 余波到哪一年(核冬天 + FAMINE_TAIL) */
  until: number;
  sev: number;
}

const cache = new WeakMap<object, { n: number; list: Aftermath[] }>();

/** 到目前为止的核冬天(按史事 nuke n = 6 重建;接着推演时一样) */
export function aftermaths(sim: CivSim): Aftermath[] {
  let c = cache.get(sim);
  if (!c) cache.set(sim, (c = { n: 0, list: [] }));
  for (; c.n < sim.annalCount; c.n++) {
    const a = sim.annal(c.n);
    if (a.kind !== 'nuke' || a.n !== 6) continue;
    const o = a.oob ?? [];
    c.list.push({ year: a.year, until: o[2] ?? a.year + (o[0] ?? 3) + FAMINE_TAIL, sev: (o[1] ?? 0) / 1000 });
  }
  return c.list;
}

/** (a, b] 里和核冬天余波重叠的年数、最重的轻重;没有 = null */
export function winterIn(sim: CivSim, a: number, b: number): { years: number; sev: number } | null {
  let years = 0,
    sev = 0;
  for (const q of aftermaths(sim)) {
    const y = Math.min(b, q.until) - Math.max(a, q.year);
    if (y > 0) {
      years = Math.max(years, y);
      sev = Math.max(sev, q.sev);
    }
  }
  return years > 0 ? { years, sev } : null;
}

/** 轻重:命中发数定底子,乘对数正态的随机(u1、u2 是两个 [0, 1) 的随机数) */
export function winterSeverity(hits: number, u1: number, u2: number): number {
  const s0 = Math.min(1, Math.max(0.1, (hits - 40) / 360));
  const g = Math.sqrt(-2 * Math.log(Math.max(1e-9, u1))) * Math.cos(2 * Math.PI * u2);
  return Math.min(1, s0 * Math.exp(0.7 * g));
}

/** 一座城的饥荒折损 */
export function famineLoss(sev: number, u: number): number {
  return Math.min(0.9, (0.05 + 0.6 * sev) * (0.7 + 0.6 * u));
}
