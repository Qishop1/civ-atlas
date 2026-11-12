/** 本地实验:太空电梯建在哪、纬度多少、哪年动工、建几年、叫什么。npx tsx scripts/local-towers.ts 381500 5200 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { spaceTowers } from '../src/gen/civ/story/spaceText';
import { regionLabel } from '../src/gen/civ/story/display';
import { polityName } from '../src/gen/civ/growth';
const seed = Number(process.argv[2] ?? 381500);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Number(process.argv[3] ?? 5200) });
for (const t of spaceTowers(civ)) console.log(`${polityName(civ.polities[t.polity], t.start)} 在 ${regionLabel(civ, t.region)}(纬度 ${civ.regions.lat?.[t.region]?.toFixed(1)}°)第 ${Math.floor(t.start)} 年动工,建 ${t.build} 年,「${t.name}」`);
const lats = civ.regions.lat ? [...civ.regions.lat] : [];
console.log(`全世界州的纬度范围 ${Math.min(...lats).toFixed(1)} ~ ${Math.max(...lats).toFixed(1)}`);
