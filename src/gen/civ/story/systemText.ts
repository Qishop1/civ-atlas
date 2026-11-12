/**
 * 本地分支 modern-pace:这个世界的恒星系 —— 生成(gen/system.ts)+ 名字 + 殖民的是哪颗行星。
 *   名字:行星按最早那个民族的语感起(肉眼看得见的行星上古就有名字):带姓的(东方)语感 = 一个字 + "星"(像"荧星"),
 *         不带姓的(西方)语感 = 一个名字(像"马尔泰");恒星就叫太阳、母星的月亮叫月球(本地人的叫法)。
 *   殖民目标(编年史的"行星定居"、殖民地):母星外侧最近的岩质行星;没有就内侧最远的岩质行星;都没有 = 第一颗巨行星的最大卫星。
 *   小行星带有名字("某某带")。
 */
import type { Civ } from '../types';
import { generateSystem, type StarSystem, type SystemSpec } from '../../system';
import { personNamers } from '../naming';

export interface NamedSystem {
  sys: StarSystem;
  /** 和 sys.planets 一一对应(母星 = 这个世界本身,写"母星") */
  names: string[];
  /** 殖民的那颗:下标;巨行星的卫星 = 那颗巨行星的下标,moonOf = true */
  target: number;
  targetName: string;
  moonOf: boolean;
  beltName?: string;
}

const cache = new WeakMap<Civ, { key: string; v: NamedSystem }>();

/**
 * 这个世界(星球)的种子和气温参数:恒星系跟着星球走,不跟着文明种子走。界面载入世界时登记(App.tsx);
 * 没登记的(测试、脚本)按文明种子、气温 0 算
 */
let planet: { seed: number; temperature: number; spec?: SystemSpec } | null = null;
const specIds = new WeakMap<SystemSpec, number>();
let specN = 0;
const specId = (s?: SystemSpec) => (s ? (specIds.get(s) ?? (specIds.set(s, ++specN), specN)) : 0);
/** 现在登记的星球种子(新建世界重生成地图时,同一颗种子才留着编辑过的恒星系) */
export function planetSeed(): number | undefined {
  return planet?.seed;
}

export function setPlanetParams(p: { seed: number; temperature: number; spec?: SystemSpec } | null) {
  planet = p;
}

export function starSystem(civ: Civ): NamedSystem {
  const seed = planet?.seed ?? civ.seed;
  const temp = planet?.temperature ?? 0;
  const key = `${seed}:${temp}:${specId(planet?.spec)}`;
  const hit = cache.get(civ);
  if (hit && hit.key === key) return hit.v;
  const sys = generateSystem(seed, temp, planet?.spec);
  const style = [...civ.cultures].sort((a, b) => a.born - b.born)[0]?.style || 'kingdom';
  const nm = personNamers(civ.seed)(style);
  const used = new Set<string>();
  const pick = (key: number) => {
    for (let t = 0; t < 8; t++) {
      const k = 70001 + key * 13 + t;
      const n = nm.surnamed ? `${nm.given(k, 1).slice(0, 1)}星` : nm.given(k, 3);
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
    return `第${key}星`;
  };
  const names = sys.planets.map((p) => (p.kind === 'home' ? '母星' : pick(p.key)));
  const home = sys.home;
  // 能落脚的:岩质、超级地球(矮行星太小、迷你海王星没有地面)
  const solid = (k: string) => k === 'rocky' || k === 'super';
  const outer = sys.planets.findIndex((p, i) => i > home && solid(p.kind));
  let inner = -1;
  for (let i = home - 1; i >= 0; i--) if (solid(sys.planets[i].kind)) { inner = i; break; }
  let target = outer >= 0 ? outer : inner;
  let moonOf = false;
  let targetName = target >= 0 ? names[target] : '';
  if (target < 0) {
    target = sys.planets.findIndex((p) => (p.kind === 'gas' || p.kind === 'ice' || p.kind === 'mini') && p.major.length > 0);
    moonOf = true;
    targetName = target >= 0 ? `${names[target]}的卫星` : '外行星的卫星';
  }
  const out: NamedSystem = { sys, names, target, targetName, moonOf, ...(sys.belt ? { beltName: `${pick(999).replace(/星$/, '')}带` } : {}) };
  cache.set(civ, { key, v: out });
  return out;
}
