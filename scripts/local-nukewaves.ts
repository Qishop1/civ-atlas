/** 本地实验:每次核交换按波列出谁打谁、几发、命中 / 拦下、打城几发、城市伤亡;核武库多大。npx tsx scripts/local-nukewaves.ts 381500 4600 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 381500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 4600) });
const nm = (p: number, y: number) => (civ.polities[p] ? polityName(civ.polities[p], y) : '?');
const A = civ.annals;
let total = 0;
const groups = new Map<number, number[]>();
A.forEach((e, i) => { if (e.kind === 'nuke' && e.n && e.n >= 1) { const k = Math.round(e.year * 256); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); } });
for (const ids of groups.values()) {
  const y = A[ids[0]].year;
  console.log(`第 ${Math.floor(y)} 年:`);
  let cur = -2; let w: { a: number; b: number; n: number; hit: number; stop: number; city: number; dead: number; kt: number; tac: number } | null = null;
  const flush = () => { if (w) console.log(`  ${nm(w.a, y)} → ${nm(w.b, y)}:${w.n} 发${w.tac ? `(含战术 ${w.tac})` : ''},命中 ${w.hit},拦下 ${w.stop},打城 ${w.city} 发,城市伤亡约 ${Math.round(w.dead / 10)} 万,总当量约 ${Math.round(w.kt / 1000)} Mt`); };
  for (const i of ids) {
    const e = A[i];
    if (e.n === 3) { console.log(`  军控:在 ${civ.settlements[e.settlement]?.name ?? '?'} 签约`); continue; }
    if (e.n === 4) { console.log(`  核冬天 ${e.oob?.[0]} 年(命中 ${e.oob?.[1]} 发)`); continue; }
    if (e.n === 5) { console.log(`  总述:先用 ${nm(e.a, y)},打到第 ${e.oob?.[7]} 级,盟国 ${(e.ps ?? []).slice(2).map((p) => nm(p, y)).join('、') || '无'}`); continue; }
    if (e.a !== cur) { flush(); cur = e.a; w = { a: e.a, b: e.b, n: 0, hit: 0, stop: 0, city: 0, dead: 0, kt: 0, tac: 0 }; }
    const [kt = 0, dead = 0, stopped = 0, wave = 0] = e.oob ?? [];
    w!.n++; total++;
    if (e.n === 1) { w!.tac++; w!.hit++; w!.kt += kt; continue; }
    if (stopped) w!.stop++; else { w!.hit++; w!.kt += kt; if (wave === 2) { w!.city++; w!.dead += dead; } }
  }
  flush();
}
for (const e of A) if (e.kind === 'unally' && e.cause === 'pariah') console.log(`  断盟:${nm(e.a, e.year)} 与 ${nm(e.b, e.year)}(第 ${Math.floor(e.year)} 年)`);
console.log(`一共 ${total} 发`);
