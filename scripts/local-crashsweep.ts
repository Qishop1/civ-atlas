/** 本地实验:一批种子推到 5000 年,只报出错的。npx tsx scripts/local-crashsweep.ts 1 60 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
const a = Number(process.argv[2] ?? 1), b = Number(process.argv[3] ?? 60);
let bad = 0;
for (let seed = a; seed <= b; seed++) {
  try { generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5000 }); } catch (e: any) { bad++; console.log('ERR', seed, e.message, (e.stack ?? '').split('\n')[1]?.trim()); }
}
console.log(`done ${a}-${b}, ${bad} 个出错`);
