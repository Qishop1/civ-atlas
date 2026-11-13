/** 本地实验(第八十四轮 军事时代):近现代仗的编制代差、游牧新立国的编制、终局格局。npx tsx scripts/local-milera.ts 1 2 3 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { oobEra, oobName } from '../src/gen/civ/oob';
for (const seed of process.argv.slice(2).map(Number)) {
  const t0 = Date.now();
  const civ: any = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5000 });
  const h = civ.history ?? civ;
  let n = 0, gap3 = 0, pike = 0, nomadModern = 0, nomadN = 0;
  const ex: string[] = [];
  for (const a of h.annals) {
    if (!a.oob || a.oob.length < 2 || a.year < 3500 || (a.kind !== 'conquer' && a.kind !== 'war')) continue;
    if (a.kind !== 'conquer') continue;
    const ea = oobEra(a.oob[0]), eb = oobEra(a.oob[1]);
    n++;
    if (Math.abs(ea - eb) >= 3) gap3++;
    if (Math.min(ea, eb) <= 3) { pike++; if (ex.length < 3) ex.push(`${Math.floor(a.year)} ${oobName(a.oob[0])} vs ${oobName(a.oob[1])}`); }
    const P = civ.polities[a.a];
    if (P && P.kind === 'nomad' && a.year - P.founded < 40) { nomadN++; if (ea >= 6) nomadModern++; }
  }
  const alive = civ.polities.filter((p: any) => p.ended === undefined && p.founded <= civ.endYear);
  const own = civ.polity as Int16Array;
  const cnt = new Map<number, number>();
  let tot = 0;
  for (let r = 0; r < own.length; r++) if (own[r] >= 0) { cnt.set(own[r], (cnt.get(own[r]) ?? 0) + 1); tot++; }
  const top = Math.max(...cnt.values());
  const fed = civ.polities.some((p: any) => p.federation !== undefined);
  console.log(`seed ${seed}: 3500 后攻占 ${n},代差≥3 ${gap3},一方≤长枪 ${pike}${ex.length ? ' (' + ex.join(' | ') + ')' : ''};游牧新立国 ${nomadN} 仗,其中现代编制 ${nomadModern};终局 ${alive.length} 国,最大 ${(top / tot * 100).toFixed(0)}%,联邦 ${fed ? '有' : '无'};${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
