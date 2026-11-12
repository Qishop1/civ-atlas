/** 本地自查:第六十五轮科学史 —— 列出整条。npx tsx scripts/local-science.ts 2 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { fullChronicle } from '../src/gen/civ/story/religionText';
const seed = Number(process.argv[2] ?? 2);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
for (const e of fullChronicle(civ).filter((x) => x.tag === '学')) console.log(Math.floor(e.year), e.text);
