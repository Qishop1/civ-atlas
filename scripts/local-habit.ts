/** 本地实验:宜居候选多不多。npx tsx scripts/local-habit.ts */
import { generateSystem } from '../src/gen/system';
let one = 0, two = 0, first = -1;
for (let s = 1; s <= 300; s++) {
  const y = generateSystem(s);
  const n = y.planets.filter((p) => p.kind !== 'home' && p.habitable).length;
  if (n >= 1) one++;
  if (n >= 2) two++;
  if (n >= 1 && first < 0) first = s;
}
console.log(`300 个恒星系:除母星外至少一颗宜居候选 ${one} 个,两颗以上 ${two} 个;第一个是种子 ${first}`);
