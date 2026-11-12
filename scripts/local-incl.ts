/** 本地实验:轨道倾角分布。npx tsx scripts/local-incl.ts */
import { generateSystem } from '../src/gen/system';
let tilted = 0, first = -1;
for (let s = 1; s <= 300; s++) {
  const y = generateSystem(s);
  const m = Math.max(0, ...y.planets.map((p) => p.incl));
  if (m > 10) { tilted++; if (first < 0 && y.planets.length >= 4) first = s; }
}
console.log(`300 个系统里有倾角 >10° 的行星:${tilted} 个;第一个(4 颗以上):种子 ${first}`);
