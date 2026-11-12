/** 本地实验:每次核交换第一波打到哪:目标州开战前是谁的、离发射国国都几跳。npx tsx scripts/local-nuketargets.ts 20030519 4600 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { capitalAt, polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 20030519);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 4600) });
const A = civ.annals;
const groups = new Map<number, number[]>();
A.forEach((e, i) => { if (e.kind === 'nuke' && (e.n === 1 || e.n === 2)) { const k = Math.round(e.year * 256); (groups.get(k) ?? groups.set(k, []).get(k)!).push(i); } });
const R = civ.regions;
const hops = (from: number) => { const d = new Int32Array(R.count).fill(-1); const q = [from]; d[from] = 0; for (let h = 0; h < q.length; h++) { const r = q[h]; for (let e = R.adjStart[r]; e < R.adjStart[r + 1]; e++) { const j = R.adj[e]; if (j < R.count && d[j] < 0) { d[j] = d[r] + 1; q.push(j); } } } return d; };
for (const ids of groups.values()) {
  const e0 = A[ids[0]];
  const war = A.find((a) => a.kind === 'war' && a.war === e0.war);
  const before = war ? ownersAt(civ, war.year - 1 / 512).polity : null;
  const capR = civ.settlements[capitalAt(civ.polities[e0.a], e0.year)].region;
  const d = hops(capR);
  const first = ids.filter((i) => A[i].a === e0.a);
  let own = 0, near = 0;
  for (const i of first) { const r = A[i].region; if (before && before[r] === e0.a) own++; if (d[r] >= 0 && d[r] <= 2) near++; }
  console.log(`${Math.floor(e0.year)} ${polityName(civ.polities[e0.a], e0.year)} 先打 ${first.length} 发(${A[first[0]].n === 1 ? '战术' : '战略'}):目标开战前是自己的 ${own},离自己国都两跳以内 ${near};目标 0 号:${civ.settlements[A[first[0]].settlement]?.name ?? ''} 开战前归 ${before ? polityName(civ.polities[before[A[first[0]].region]] ?? civ.polities[0], e0.year) : '?'}`);
}
