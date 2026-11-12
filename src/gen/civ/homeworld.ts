/**
 * 本地分支 modern-pace 第六十三轮:母星的名字(用户"不一定非得叫地联吧")。
 * 星球联邦成立时按盟主民族的语感起一个(Polity.homeworld):西方语感用国名那一类(科罗里亚、杜博维亚),
 * 东方语感用地名那一类去掉通名(宁德、墨松);和国名撞了就取下一个。随机数另起一个根(subSeed(seed, 'civ-homeworld')),不动推演的随机数。
 * 联邦叫"某某联邦";界面上提到母星的地方也用它(homeworldOf)。旧存档里成立的联邦没有这一项 = "世界联邦"
 */
import { createNamer, NAME_STYLES } from '../names';
import { subSeed } from '../util';
import type { Civ } from './types';

const GENERIC = /[郡道洲原府野丘州国城山]$/;

/** 按语感起一个母星名 */
export function homeworldName(seed: number, style: string, avoid?: (name: string) => boolean): string {
  const east = NAME_STYLES.find((s) => s.id === style)?.family === 'eastern';
  const next = createNamer(subSeed(seed, 'civ-homeworld'), style || 'kingdom').keyed(east ? 'region' : 'state', 1);
  for (let t = 0; t < 80; t++) {
    const g = next();
    let z = g.zh;
    if (east) {
      if (g.generic && z.endsWith(g.generic)) z = z.slice(0, -g.generic.length);
      else if (GENERIC.test(z)) z = z.slice(0, -1);
      // "之"字结尾的(翼果之野 → 翼果之)去掉
      z = z.replace(/之$/, '');
    }
    if (z.length < 2 || z.length > 5 || avoid?.(z)) continue;
    return z;
  }
  return '世界';
}

/** 联邦的名字 */
export function federationName(p: { homeworld?: string }): string {
  return `${p.homeworld ?? '世界'}联邦`;
}

/** 这个世界的母星叫什么:有联邦就是联邦起的名字;没有 = 按最早进工业那国的民族语感起(只给界面用,不记进推演) */
export function homeworldOf(civ: Civ): string {
  const h = civ.history ?? civ;
  for (const p of h.polities) if (p.homeworld) return p.homeworld;
  let first = -1,
    fy = Infinity;
  for (const p of h.polities) if (p.modern?.length && p.modern[0] < fy) (fy = p.modern[0]), (first = p.id);
  const cu = first >= 0 ? h.polities[first].culture : 0;
  return homeworldName(h.seed, h.cultures[cu]?.style ?? '', (n) => h.polities.some((p) => p.name === n));
}
