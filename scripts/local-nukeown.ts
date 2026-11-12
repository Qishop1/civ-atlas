/** 本地实验:每次核交换按发射国分,目标落在哪:此刻归谁、开战前归谁、200 年内归过发射国没有、州里是不是发射国的民族、离发射国国都几跳。npx tsx scripts/local-nukeown.ts 381500 4600 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { capitalAt, polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 381500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 4600) });
const A = civ.annals;
const R = civ.regions;
const nm = (p: number, y: number) => (p >= 0 && civ.polities[p] ? polityName(civ.polities[p], y) : '无主');
const hops = (from: number) => { const d = new Int32Array(R.count).fill(-1); const q = [from]; d[from] = 0; for (let h = 0; h < q.length; h++) { const r = q[h]; for (let e = R.adjStart[r]; e < R.adjStart[r + 1]; e++) { const j = R.adj[e]; if (j < R.count && d[j] < 0) { d[j] = d[r] + 1; q.push(j); } } } return d; };
const groups = new Map<number, number[]>();
A.forEach((e, i) => { if (e.kind === 'nuke' && (e.n === 1 || e.n === 2)) { const k = Math.round(e.year * 256); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); } });
for (const ids of groups.values()) {
  const y = A[ids[0]].year;
  const now = ownersAt(civ, y).polity;
  const war = A.find((a) => a.kind === 'war' && a.war === A[ids[0]].war);
  const pre = war ? ownersAt(civ, war.year - 1 / 512).polity : now;
  const old = ownersAt(civ, y - 200).polity;
  const cult = ownersAt(civ, y).culture;
  const by = new Map<number, number[]>();
  for (const i of ids) (by.get(A[i].a) ?? by.set(A[i].a, []).get(A[i].a)!).push(i);
  console.log(`第 ${Math.floor(y)} 年`);
  for (const [a, list] of by) {
    const capR = civ.settlements[capitalAt(civ.polities[a], y)].region;
    const d = hops(capR);
    let nowMine = 0, preMine = 0, oldMine = 0, sameFolk = 0, near = 0;
    for (const i of list) { const r = A[i].region; if (now[r] === a) nowMine++; if (pre[r] === a) preMine++; if (old[r] === a) oldMine++; if (cult[r] === civ.polities[a].culture) sameFolk++; if (d[r] >= 0 && d[r] <= 2) near++; }
    console.log(`  ${nm(a, y)} 打 ${list.length} 发:此刻归自己 ${nowMine},开战前归自己 ${preMine},200 年前归自己 ${oldMine},是自己民族的州 ${sameFolk},国都两跳内 ${near}`);
  }
}
