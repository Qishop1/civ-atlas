/** 本地实验:核打击拦下几成(按轨道封没封锁分开算)。npx tsx scripts/local-intercept.ts 1 12 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
const s0 = Number(process.argv[2] ?? 1),
  n = Number(process.argv[3] ?? 12);
let a = [0, 0],
  b = [0, 0];
for (let seed = s0; seed < s0 + n; seed++) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
  const blocks = civ.annals.filter((e) => e.kind === 'orbit' && e.n === 1).map((e) => [e.year, e.oob?.[2] ?? e.year + (e.oob?.[0] ?? 0)]);
  const blocked = (y: number) => blocks.some(([f, u]) => y >= f && y < u);
  for (const e of civ.annals) {
    if (e.kind !== 'nuke' || e.n !== 2) continue;
    const t = blocked(e.year) ? b : a;
    t[0]++;
    if (e.oob?.[2]) t[1]++;
  }
}
console.log(`没封锁:${a[0]} 发,拦下 ${a[1]}(${a[0] ? ((a[1] / a[0]) * 100).toFixed(1) : '-'}%);封锁中:${b[0]} 发,拦下 ${b[1]}(${b[0] ? ((b[1] / b[0]) * 100).toFixed(1) : '-'}%)`);
