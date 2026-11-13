/** 本地实验:瓜分无主地的编年史条目。npx tsx scripts/local-claimtext.ts 5 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rememberWorld } from '../src/gen/civ/story/claims';
import { claimEntries } from '../src/gen/civ/story/claimsText';
const seed = Number(process.argv[2] ?? 5);
const world = generateWorld({ seed } as WorldParams);
const civ = generateCiv(world, { endYear: 5500 });
rememberWorld(civ, world);
const es = claimEntries(civ, 0);
console.log(`种子 ${seed}:${es.length} 条`);
for (const e of es.slice(0, 14)) console.log(Math.floor(e.year), e.text);
