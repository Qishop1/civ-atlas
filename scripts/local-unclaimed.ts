/** 本地实验:到 end 年还有多少州(按面积)没有国家,按宜居度分档看是不是沙漠高山。npx tsx scripts/local-unclaimed.ts 1 3 5500 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { claimsAt } from '../src/gen/civ/story/claims';
const s0 = Number(process.argv[2] ?? 1);
const n = Number(process.argv[3] ?? 3);
const end = Number(process.argv[4] ?? 5500);
for (let seed = s0; seed < s0 + n; seed++) {
  const world = generateWorld({ seed } as WorldParams);
  const civ = generateCiv(world, { endYear: end });
  const cl = claimsAt(civ, world, end);
  let free2 = 0;
  const R = civ.regions;
  let all = 0,
    free = 0;
  const bins = [0, 0, 0, 0, 0],
    binsFree = [0, 0, 0, 0, 0];
  for (let r = 0; r < R.count; r++) {
    const a = R.area[r];
    // 州的宜居度 = 地块平均
    let s = 0,
      k = 0;
    for (let q = R.cellStart[r]; q < R.cellStart[r + 1]; q++) {
      s += civ.habitat.suitability[R.cells[q]] ?? 0;
      k++;
    }
    const su = k ? s / k : 0;
    const b = Math.min(4, Math.floor(su * 5));
    all += a;
    bins[b] += a;
    if (civ.polity[r] < 0 && cl.owner[r] < 0) free2 += a;
    if (civ.polity[r] < 0) {
      free += a;
      binsFree[b] += a;
    }
  }
  console.log(
    `种子 ${seed}:无主 ${((free / all) * 100).toFixed(1)}% → 认领后 ${((free2 / all) * 100).toFixed(1)}%,${cl.zones.length} 片(按面积);按宜居度 0–0.2 / –0.4 / –0.6 / –0.8 / –1 各档无主占比:${bins.map((v, i) => (v ? ((binsFree[i] / v) * 100).toFixed(0) + '%' : '-')).join(' / ')}`,
  );
}
