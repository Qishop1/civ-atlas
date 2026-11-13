/** 本地实验:各国首都进工业时代的年份。npx tsx scripts/local-modyr.ts 2 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
const civ = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 2) } as WorldParams), { endYear: 5500 });
const ys = civ.polities.map((p) => p.modern?.[0]).filter((y): y is number => y !== undefined).sort((a, b) => a - b);
console.log('首都进工业:', ys.slice(0, 10).map(Math.floor).join(','), '共', ys.length);
