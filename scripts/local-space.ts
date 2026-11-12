/** 本地实验:列出太空任务那几条。npx tsx scripts/local-space.ts 381500 5200 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentEntries } from '../src/gen/civ/story/developmentText';
const seed = Number(process.argv[2] ?? 381500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 5200) });
const es = developmentEntries(civ).filter((e) => e.tag === '天');
console.log(`种子 ${seed}:太空任务 ${es.length} 条,大事 ${es.filter((e) => e.importance >= 3).length} 条`);
for (const e of es.filter((x) => x.importance >= 2)) console.log(`[${Math.floor(e.year)}] ${'★'.repeat(e.importance - 1)} ${e.text}`);
