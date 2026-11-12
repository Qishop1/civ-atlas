import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
for (const seed of (process.argv[2] ?? '20030519,7,42').split(',').map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 4600 });
  const n = civ.annals.filter((a) => a.kind === 'nuke');
  const s = n.filter((a) => a.n === 2);
  const bursts = new Map<string, number>();
  for (const a of s) { const key = `${a.war}:${a.year}`; bursts.set(key, (bursts.get(key) ?? 0) + 1); }
  const hit = s.filter((a) => !a.oob?.[2]);
  const cityDead = hit.reduce((x, a) => x + (a.oob?.[1] ?? 0), 0);
  const waves = [0, 1, 2].map((w) => hit.filter((a) => (a.oob?.[3] ?? 2) === w).length);
  console.log(`种子 ${seed}:核试验 ${n.filter((a) => a.n === 0).length},战术核 ${n.filter((a) => a.n === 1).length},战略核 ${s.length} 发(命中 ${hit.length}:纵深 ${waves[0]} / 前线国都 ${waves[1]} / 城 ${waves[2]};拦下 ${s.length - hit.length}),${bursts.size} 轮,最大一轮 ${Math.max(0, ...bursts.values())} 发,城市伤亡合计约 ${Math.round(cityDead / 10)} 万`);
}
