/** 本地实验:地球联邦成立以后发生了什么(崩解、分裂、复国、改朝换代、联邦又成立几次)。npx tsx scripts/local-fedlife.ts 381500 6000 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 381500);
const end = Number(process.argv[3] ?? 6000);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
const feds = civ.polities.filter((p) => p.federation !== undefined);
const nm = (p: number, y: number) => (civ.polities[p] ? polityName(civ.polities[p], y) : '?');
for (const F of feds) {
  const k = new Map<string, number>();
  for (const e of civ.annals) {
    if (e.year < F.federation! || (e.a !== F.id && e.b !== F.id)) continue;
    const key = `${e.kind}${e.cause ? `/${e.cause}` : ''}`;
    k.set(key, (k.get(key) ?? 0) + 1);
  }
  console.log(`联邦 #${F.id} ${Math.floor(F.federation!)} 成立(${nm(F.id, F.federation! - 1)} 牵头),${F.ended === undefined ? '到最后还在' : `${Math.floor(F.ended)} 年亡`};此后牵涉它的史事:${[...k].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a, b]) => `${a}×${b}`).join(' ')}`);
}
const alive = civ.polities.filter((p) => p.ended === undefined && p.founded <= end).length;
console.log(`到 ${end} 年现存国家 ${alive};联邦一共成立过 ${feds.length} 次`);
