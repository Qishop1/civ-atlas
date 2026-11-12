/** 本地实验:登月 / 绕月 / 中继 / 月球基地的编年史原文;第二遍加一条月背着陆点干预。npx tsx scripts/local-moonsite.ts 381500 4400 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentEntries } from '../src/gen/civ/story/developmentText';
import { spaceRace } from '../src/gen/civ/story/spaceText';
import type { Intervention } from '../src/gen/edits';
const seed = Number(process.argv[2] ?? 381500);
const end = Number(process.argv[3] ?? 4400);
const w = generateWorld({ seed } as WorldParams);
const show = (ivs: Intervention[]) => {
  const civ = generateCiv(w, { endYear: end, interventions: ivs });
  const es = developmentEntries(civ).filter((e) => e.tag === '天' && /月|中继/.test(e.text)).sort((a, b) => a.year - b.year);
  for (const e of es.slice(0, 12)) console.log(`[${Math.floor(e.year)}] ${e.text}`);
  return spaceRace(civ);
};
const r = show([]);
const first = [...r.landings.values()].sort((a, b) => a.year - b.year)[0];
console.log('---- 加干预:第一次登月落在月背 (150, -20) ----');
if (first) show([{ kind: 'moonsite', from: Math.floor(first.year) - 5, lon: 150, lat: -20 }]);
