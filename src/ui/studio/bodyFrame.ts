/**
 * 本地分支 modern-pace 第四十八轮:新建世界的行星系统(SystemStep.tsx)和推演里的恒星系视图(SystemView.tsx)共用的小东西:
 * 行星的自转轴倾角、赤道面的方向,画哪几颗大卫星,大气边光的颜色,卫星绕一圈几天。
 */
import type { Planet } from '../../gen/system';
import type { Atmo, V3 } from './persp';

/** 行星系统那一层画的大卫星;种子那颗按月球(1737 km、60 倍行星半径) */
export function majorOf(p: Planet): { key: number; radius: number; dist: number }[] {
  return p.kind === 'home' ? [{ key: 0, radius: 1737, dist: 60.3 }] : p.major;
}

/** 行星的自转轴倾角、倾向(弧度;按种子):5°–35° */
export function obliquityOf(seed: number, key: number): [number, number] {
  let a = (Math.imul(seed, 2654435761) ^ Math.imul(key + 1, 40503)) >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return [((5 + 30 * r()) * Math.PI) / 180, r() * Math.PI * 2];
}

/** 倾角、倾向 → 自转轴 ax 和赤道面里的两个方向 eq1、eq2(黄道坐标) */
export function eqBasis(ob: number, az: number): { ax: V3; eq1: V3; eq2: V3 } {
  const ax: V3 = [Math.sin(ob) * Math.cos(az), Math.sin(ob) * Math.sin(az), Math.cos(ob)];
  const eq1: V3 = [-Math.sin(az), Math.cos(az), 0];
  const eq2: V3 = [ax[1] * eq1[2] - ax[2] * eq1[1], ax[2] * eq1[0] - ax[0] * eq1[2], ax[0] * eq1[1] - ax[1] * eq1[0]];
  return { ax, eq1, eq2 };
}

/** 星体坐标的矩阵(三行):先换到赤道坐标,再绕轴转 ang(自转 / 潮汐锁定跟着公转) */
export function spinRows(b: { ax: V3; eq1: V3; eq2: V3 }, ang: number): [V3, V3, V3] {
  const c = Math.cos(ang), s = Math.sin(ang);
  const { ax, eq1, eq2 } = b;
  return [
    [c * eq1[0] + s * eq2[0], c * eq1[1] + s * eq2[1], c * eq1[2] + s * eq2[2]],
    [-s * eq1[0] + c * eq2[0], -s * eq1[1] + c * eq2[1], -s * eq1[2] + c * eq2[2]],
    ax,
  ];
}

/** 大气边光:气态 / 冰巨星 / 迷你海王星按自己的颜色,宜居的偏蓝,别的有大气的岩质很淡;没大气 = 不给 */
export function atmoOf(p: Planet): Atmo | undefined {
  if (p.kind === 'gas' || p.kind === 'ice' || p.kind === 'mini') return { color: [Math.min(255, p.color[0] + 50), Math.min(255, p.color[1] + 50), Math.min(255, p.color[2] + 60)], strength: 0.35 };
  if (p.habitable || p.kind === 'home') return { color: [130, 180, 255], strength: 0.55 };
  if ((p.kind === 'rocky' || p.kind === 'super') && p.radius >= 0.35 * 6371 && p.teq <= 200) return { color: [215, 200, 180], strength: 0.2 };
  return undefined;
}

/** 行星的密度(g/cm³,按种类估):算卫星公转周期用 */
const DENSITY: Record<string, number> = { home: 5.5, rocky: 5.5, super: 5.0, dwarf: 2.0, mini: 1.6, ice: 1.6, gas: 1.3 };
/** 大卫星绕一圈几天(开普勒,行星质量按半径和种类估) */
export function moonPeriodDays(p: Planet, m: { dist: number }): number {
  const aKm = p.radius * m.dist;
  const M = (4 / 3) * Math.PI * Math.pow(p.radius * 1e3, 3) * (DENSITY[p.kind] ?? 3) * 1e3;
  return (2 * Math.PI * Math.sqrt(Math.pow(aKm * 1e3, 3) / (6.674e-11 * M))) / 86400;
}
