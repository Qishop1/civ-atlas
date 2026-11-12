/**
 * 本地分支 modern-pace 第六十六轮:收太空垃圾 —— 编年史里的轨道清理(只读推演结果,不改推演;标签"天")。
 *
 *   平时:世上有人造卫星以后 CLEAN_FIRST 年,头一个航天大国发出第一艘清理船(捕获报废卫星);再过 AGENCY_AFTER 年成立清理机构
 *         (那时有星球联邦 = "某某联邦轨道清理署",没有 = 各航天国家的"国际轨道清理联盟");
 *         头一座太空电梯建成以后,清理船队常驻轨道,"星空清理者"成了一门行当
 *   轨道封锁(史事 orbit n = 1,orbit.ts):清理进度到三成、七成各记一条;解封那年记"低轨航道重新开放";被打断的电梯在解封后重建
 * 船名用这国自己的城名(spaceText.ts 的 craftName)。
 */
import type { Civ, Year } from '../types';
import { INVENTIONS } from '../inventions';
import { polityName } from '../growth';
import { federationName } from '../homeworld';
import { blockadesOf } from '../orbit';
import { craftName } from './spaceText';
import { cityNameAt } from './cityNames';
import type { ChronicleEntry } from './chronicle';

const CLEAN_FIRST = 55;
const AGENCY_AFTER = 25;
const PRO_AFTER = 6;

export function orbitEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const out: ChronicleEntry[] = [];
  const h = civ.history ?? civ;
  const dev = h.development;
  if (!dev) return out;
  let id = idBase;
  const end = civ.endYear;
  const push = (y: Year, text: string, ps: number[], imp: 1 | 2 | 3, regions: number[] = []) => {
    if (y < end) out.push({ id: id++, kind: 'debris', year: y, end: y, text, tag: '天', importance: imp, polities: ps, regions, settlement: -1 });
  };
  const alive = (pid: number, y: Year) => {
    const P = civ.polities[pid];
    return !!P && P.founded <= y && (P.ended === undefined || P.ended > y);
  };
  // 世上第一颗人造卫星:那州那年的主人(按快照近似:找最早的 invent)
  let sat: { year: Year; region: number } | null = null;
  for (const e of dev.events) if (e.kind === 'invent' && INVENTIONS[(e as { invention: number }).invention]?.name === '人造卫星' && (!sat || e.year < sat.year)) sat = { year: e.year, region: e.region };
  if (!sat) return out;
  // 发清理船的:那年还在、近现代走得最远(modern 段最多)的国家;一样远的取有联邦的、再取编号小的
  const spacer = (y: Year): number => {
    let best = -1,
      bm = -1;
    for (const P of civ.polities) {
      if (!alive(P.id, y)) continue;
      const m = (P.modern?.length ?? 0) + (P.federation !== undefined && P.federation <= y ? 0.5 : 0);
      if (m > bm) (bm = m), (best = P.id);
    }
    return best;
  };
  const blocks = blockadesOf(h.annals);
  const blockedAt = (y: Year) => blocks.some((b) => y >= b.year && y < b.until);
  // ---- 平时的清理 ----
  let y1 = Math.floor(sat.year + CLEAN_FIRST);
  while (blockedAt(y1)) y1++;
  const p1 = spacer(y1);
  if (p1 >= 0) {
    const P = civ.polities[p1];
    push(y1, `${polityName(P, y1)}"${craftName(civ, P, 501)}号"清理船升空,用机械臂捕获三颗报废卫星,拖入大气层烧毁 —— 世上第一次专门清理太空垃圾`, [p1], 2);
  }
  const y2 = y1 + AGENCY_AFTER;
  const fed = civ.polities.find((P) => P.federation !== undefined && P.federation <= y2 && alive(P.id, y2));
  push(y2, fed ? `${federationName(fed)}设立轨道清理署,统一调度清理船、地基激光站,按碎片的轨道编号逐一清除` : `各航天国家成立国际轨道清理联盟,分摊清理费用,并约定报废卫星须在寿命末期自行离轨`, fed ? [fed.id] : [], 2);
  // 头一座建成的太空电梯
  let tw: { year: Year; a: number; settlement: number } | null = null;
  for (const a of h.annals) if (a.kind === 'tower') {
    const done = a.year + (a.n ?? 20);
    if (!tw || done < tw.year) tw = { year: done, a: a.a, settlement: a.settlement };
  }
  if (tw) {
    const y3 = Math.floor(tw.year + PRO_AFTER);
    const city = tw.settlement >= 0 ? cityNameAt(civ, tw.settlement, y3) : '';
    push(y3, `${city ? `${city}的` : ''}太空电梯通车以后,上一次轨道只要从前的零头;清理船队常驻轨道,"星空清理者"成了一门热门行当 —— 收太空垃圾按重量计酬`, tw.a >= 0 ? [tw.a] : [], 2);
  }
  // ---- 轨道封锁:清理进度、解封、电梯重建 ----
  for (const b of blocks) {
    const span = b.until - b.year;
    push(Math.floor(b.year + span * 0.3), `轨道清理进展:清理船队与地基激光站累计清除碎片约三成,低轨仍不能安全发射`, [], 1);
    push(Math.floor(b.year + span * 0.7), `轨道清理进展:累计清除碎片约七成,部分高倾角轨道开始试行发射`, [], 1);
    push(Math.floor(b.until), `近地轨道碎片基本清除,低轨航道重新开放;各国恢复发射,重建卫星网`, [], 3);
  }
  for (const a of h.annals) {
    if (a.kind !== 'orbit' || a.n !== 2) continue;
    const y = Math.floor(a.oob?.[0] ?? a.year + 40) + 3;
    const city = a.settlement >= 0 ? cityNameAt(civ, a.settlement, y) : '';
    push(y, `${city ? `${city}的` : ''}太空电梯在轨道解封后重建完成,恢复通车`, a.a >= 0 ? [a.a] : [], 2, a.region >= 0 ? [a.region] : []);
  }
  return out.sort((a, b) => a.year - b.year);
}
