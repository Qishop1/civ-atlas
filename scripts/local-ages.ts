import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
const civ = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 20030519) } as WorldParams), { endYear: 5000 });
const rul = (civ.people ?? []).filter((p) => p.role === 'ruler' && p.died !== undefined);
for (const [a, b] of [[2000, 3000], [3000, 3800], [3800, 4400], [4400, 5000]]) {
  const ages = rul.filter((p) => p.died! >= a && p.died! < b).map((p) => p.died! - p.born).sort((x, y) => x - y);
  const q = (f: number) => (ages.length ? ages[Math.floor(f * (ages.length - 1))].toFixed(0) : '-');
  console.log(`${a}-${b}: 君主 ${ages.length} 位,卒年岁数 中位 ${q(0.5)} 九成 ${q(0.9)} 最高 ${q(1)}`);
}
