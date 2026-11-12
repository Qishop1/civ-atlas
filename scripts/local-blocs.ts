import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
for (const seed of (process.argv[2] ?? '20030519,42,7').split(',').map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 4600 });
  const leaders = new Set<number>();
  let joins = 0, wars = 0, unally = 0;
  for (const a of civ.annals) {
    if (a.kind === 'alliance' && a.cause === 'bloc') { leaders.add(a.b); joins++; }
    if (a.kind === 'war' && a.cause === 'bloc') wars++;
  }
  console.log(`种子 ${seed}:集团 ${leaders.size} 个,入盟 ${joins} 次,集体防御参战 ${wars} 次`);
}
// 打集团成员的战争有几场
{
  const civ = generateCiv(generateWorld({ seed: 7 } as WorldParams), { endYear: 4600 });
  const mem = new Map<number, number>();
  let hit = 0, total = 0;
  for (const a of civ.annals) {
    if (a.kind === 'alliance' && a.cause === 'bloc') { mem.set(a.a, a.b); mem.set(a.b, a.b); }
    if (a.kind === 'unally') { if (mem.get(a.a) === a.b) mem.delete(a.a); if (mem.get(a.b) === a.a) mem.delete(a.b); }
    if (a.kind === 'war' && a.year > 3000) { total++; if (mem.has(a.b) && mem.get(a.b) !== mem.get(a.a)) hit++; }
  }
  console.log(`种子 7:3000 年以后战争 ${total} 场,守方在集团里 ${hit} 场`);
}
