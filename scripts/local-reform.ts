/**
 * 本地实验:改制议事(立宪 11、扩大参与 12、废君 13、还政 14)按千年的结果分布,和推完时存续国家的政体。
 * npx tsx scripts/local-reform.ts seed=42 years=5000
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 42);
const years = Number(opt('years') ?? 5000);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: years });
const TOPIC = { 11: '立宪', 12: '扩大参与', 13: '废君', 14: '还政' } as Record<number, string>;
const RES = ['办成', '妥协', '搁置', '谈崩'];
const tab = new Map<string, number>();
for (const a of civ.annals) {
  if (a.kind === 'council' && a.war >= 11 && a.war <= 14) {
    const key = `${Math.floor(a.year / 1000)}千年 ${TOPIC[a.war]} ${RES[a.n ?? 0]}`;
    tab.set(key, (tab.get(key) ?? 0) + 1);
  }
  if (a.kind === 'reform') {
    const key = `${Math.floor(a.year / 1000)}千年 改制 ${['革命', '政变', '复辟'][a.n ?? 0]}`;
    tab.set(key, (tab.get(key) ?? 0) + 1);
  }
}
for (const [k, v] of [...tab].sort()) console.log(k, v);
// 推完时存续的国家:最后一段政体
const alive = civ.polities.filter((p) => p.ended === undefined || p.ended >= years);
for (const p of alive) {
  const seg = p.dynasties?.[p.dynasties.length - 1];
  console.log(`存续 #${p.id ?? '?'} 立国 ${Math.round(p.founded ?? 0)} 末段 ${seg ? `${Math.round(seg.year)} ${seg.regime ?? '王室'}` : '无'}`);
}
