/** 本地实验:地球联邦什么时候成立、谁牵头、并了几国、后来几国加入、有没有全球统一。npx tsx scripts/local-fed.ts 381500 5000 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 381500);
const end = Number(process.argv[3] ?? 5000);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
const nm = (p: number, y: number) => (civ.polities[p] ? polityName(civ.polities[p], y) : '?');
let joins = 0;
for (const e of civ.annals) {
  if (e.kind === 'federation') console.log(`${Math.floor(e.year)} ${e.n === 2 ? '全球统一' : `地球联邦成立,牵头 ${nm(e.a, e.year - 1 / 512)},并入 ${(e.ps ?? []).length - 1} 国`}`);
  if (e.kind === 'merge' && e.cause === 'federation') joins++;
}
const F = civ.polities.find((p) => p.federation !== undefined);
const alive = civ.polities.filter((p) => p.ended === undefined && p.founded <= end).length;
console.log(`种子 ${seed} 到 ${end} 年:联邦 ${F ? `成立于 ${Math.floor(F.federation!)},${F.ended === undefined ? '还在' : `${Math.floor(F.ended)} 年亡`}` : '没有'},并入/加入共 ${joins} 次,现存国家 ${alive}`);
