/**
 * 本地分支 modern-pace 第二十一轮:核大战时段 —— 史事 nuke(战术核 n = 1、战略核 n = 2)按年份排,相邻两发隔不到 GAP 年的算一段;
 * 一段里发射超过 MIN_SHOTS 发的算核大战。编年史面板(ui/Chronicle.tsx)用它自动切到"核战"视图。纯计算。
 */
import type { Civ } from '../types';

export interface NuclearWar {
  /** 第一发、最后一发的年份 */
  from: number;
  to: number;
  /** 发射几发(含被拦下的) */
  shots: number;
  /** 命中几发 */
  hits: number;
}

const GAP = 1;
const MIN_SHOTS = 10;
const cache = new WeakMap<Civ, NuclearWar[]>();

export function nuclearWarsOf(civ: Civ): NuclearWar[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const shots = civ.annals.filter((a) => a.kind === 'nuke' && (a.n === 1 || a.n === 2)).sort((a, b) => a.year - b.year);
  const out: NuclearWar[] = [];
  let cur: NuclearWar | null = null;
  for (const a of shots) {
    const ok = !(a.n === 2 && a.oob?.[2]);
    if (cur && a.year - cur.to <= GAP) {
      cur.to = a.year;
      cur.shots++;
      if (ok) cur.hits++;
    } else {
      if (cur && cur.shots > MIN_SHOTS) out.push(cur);
      cur = { from: a.year, to: a.year, shots: 1, hits: ok ? 1 : 0 };
    }
  }
  if (cur && cur.shots > MIN_SHOTS) out.push(cur);
  cache.set(civ, out);
  return out;
}

/** 那一年落在哪一段核大战里(到最后一发以后 GAP 年为止);不在 = null */
export function nuclearWarAt(wars: readonly NuclearWar[], year: number): NuclearWar | null {
  for (const w of wars) if (year >= w.from && year <= w.to + GAP) return w;
  return null;
}
