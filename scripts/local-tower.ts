/**
 * 本地自查:第四十五轮 —— 太空电梯进推演、未来时代城市继续长。
 * 列电梯(哪国、哪年、哪州、工期)、锚点州的城和全世界前三大城的人口变化;再在电梯动工后、进未来时代后切开接着推,和一口气推完的史事 / 日志 / 城的上限一样。
 * npx tsx scripts/local-tower.ts 2 5500
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { resumeCiv } from '../src/gen/civ/modules';
import { populationAt } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 2);
const end = Number(process.argv[3] ?? 5500);
const w = generateWorld({ seed } as WorldParams);
const t0 = Date.now();
const whole = generateCiv(w, { endYear: end });
console.log(`推完 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
const towers = whole.annals.filter((a) => a.kind === 'tower');
const YS = [3500, 4000, 4300, 4500, 5000, end - 10];
for (const t of towers) {
  const ss = whole.settlements.filter((s) => s.region === t.region);
  console.log(`电梯:国 ${t.a},${Math.floor(t.year)} 年动工,工期 ${t.n},州 ${t.region};那州的城(千人)`, ss.map((s) => YS.map((y) => Math.round(populationAt(s, y))).join(' / ')).join(' | '));
}
for (const y of YS) {
  const pops = whole.settlements.map((s) => populationAt(s, y)).filter((x) => x > 0).sort((a, b) => b - a);
  console.log(`${y}:前三 ${pops.slice(0, 3).map((x) => Math.round(x)).join(', ')};城合计 ${Math.round(pops.reduce((a, x) => a + x, 0))}`);
}
let bad = 0;
const cuts = [...towers.slice(0, 1).map((t) => t.year + 7.5), 4100.5];
for (const cut of cuts) {
  if (cut >= end) continue;
  const half = generateCiv(w, { endYear: cut });
  const sim = resumeCiv(w, half);
  sim.run(whole.endYear);
  const res = sim.result();
  const okA = JSON.stringify(res.annals) === JSON.stringify(whole.annals);
  const okC = true;
  const okL = res.log.size === whole.log.size;
  console.log(`从 ${cut} 接着推:史事 ${okA ? '一样' : '不一样'},日志条数 ${okL ? '一样' : '不一样'}`);
  if (!okA || !okC || !okL) bad++;
}
process.exit(bad ? 1 : 0);
