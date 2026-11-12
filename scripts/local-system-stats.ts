/** 本地实验:恒星系 v3 的分布。npx tsx scripts/local-system-stats.ts 300 */
import { ARCH_NAME, KIND_NAME, generateSystem } from '../src/gen/system';
const N = Number(process.argv[2] ?? 300);
const arch = new Map<string, number>(), cls = new Map<string, number>(), kinds = new Map<string, number>(), counts = new Map<number, number>();
let bin = 0, P = 0, belts = 0, belts2 = 0, noSolid = 0, yd: number[] = [];
for (let s = 1; s <= N; s++) {
  const sys = generateSystem(s * 7919);
  arch.set(ARCH_NAME[sys.arch], (arch.get(ARCH_NAME[sys.arch]) ?? 0) + 1);
  cls.set(sys.star.cls, (cls.get(sys.star.cls) ?? 0) + 1);
  if (sys.companion) { bin++; if (sys.companion.mode === 'P') P++; }
  const others = sys.planets.filter((p) => p.kind !== 'home');
  counts.set(others.length, (counts.get(others.length) ?? 0) + 1);
  for (const p of others) kinds.set(KIND_NAME[p.kind], (kinds.get(KIND_NAME[p.kind]) ?? 0) + 1);
  if (sys.belts.length) belts++;
  if (sys.belts.length > 1) belts2++;
  if (!others.some((p) => p.kind === 'rocky' || p.kind === 'super')) noSolid++;
  yd.push(sys.yearDays);
}
const f = (m: Map<unknown, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、');
yd.sort((a, b) => a - b);
console.log(`系统类型:${f(arch)}`);
console.log(`光谱型:${f(cls)};双星 ${bin}(P 型 ${P})`);
console.log(`其他行星颗数:${[...counts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}颗×${v}`).join(' ')}`);
console.log(`种类:${f(kinds)}`);
console.log(`有小行星带 ${belts}(两条 ${belts2});没有可落脚的岩质 / 超级地球 ${noSolid}`);
console.log(`母星一圈天数:最少 ${Math.round(yd[0])}、中位 ${Math.round(yd[N >> 1])}、最多 ${Math.round(yd[N - 1])}`);
