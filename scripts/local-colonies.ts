/** 本地实验:太空殖民地。npx tsx scripts/local-colonies.ts 5500 42 20030519 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { bodyName, colonies, colonyEntries, colonyName, colonyPop, colonyState, headText } from '../src/gen/civ/story/colonies';
const end = Number(process.argv[2] ?? 5500);
for (const seed of process.argv.slice(3).map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
  const C = colonies(civ);
  console.log(`== 种子 ${seed}:殖民地 ${C.length}`);
  for (const c of C) console.log(`  ${bodyName(civ, c.body)} ${c.name} ${Math.floor(c.founded)}起 → ${end} 年 ${colonyName(c, end)} ${headText(colonyPop(c, end))} ${colonyState(c, end)}`);
  for (const e of colonyEntries(civ, 0).sort((a, b) => a.year - b.year).slice(0, 30)) console.log(`  [${Math.floor(e.year)}] ${e.text}`);
}
