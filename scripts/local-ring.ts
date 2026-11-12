/** 本地实验:同步轨道环。npx tsx scripts/local-ring.ts 5500 381500 42 20030519 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { orbitalRing, spaceEntries, spaceTowers } from '../src/gen/civ/story/spaceText';
const end = Number(process.argv[2] ?? 5500);
for (const seed of process.argv.slice(3).map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
  const T = spaceTowers(civ);
  const r = orbitalRing(civ);
  console.log(`种子 ${seed}:电梯 ${T.map((t) => `${t.name}(${Math.floor(t.start + t.build)}建成,经度 ${civ.regions.lon?.[t.region]?.toFixed(0)})`).join(' ')};轨道环 ${r ? `${r.name} ${Math.floor(r.start)}–${Math.floor(r.end)},${r.segs.length} 段` : '没有'}`);
  for (const e of spaceEntries(civ, 0).filter((e) => e.text.includes('轨道环')).sort((a, b) => a.year - b.year)) console.log(`  [${Math.floor(e.year)}] ${e.text}`);
}
