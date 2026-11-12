import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentAt, eraLevel, ERAS } from '../src/gen/civ/development';
import { capitalAt, polityName } from '../src/gen/civ/growth';
import { oobName } from '../src/gen/civ/oob';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4600 });
const dev = civ.development!;
const eraOf = (p: number, y: number) => { const s = civ.settlements[capitalAt(civ.polities[p], y)]; return s ? eraLevel(developmentAt(dev, y), s.region) : -1; };
const rows: [number, string][] = [];
for (const a of civ.annals) {
  if (a.kind !== 'conquer' || !a.oob || a.year < 3300) continue;
  const g = eraOf(a.a, a.year) - eraOf(a.b, a.year);
  rows.push([g, `${Math.floor(a.year)} ${polityName(civ.polities[a.a], a.year)}(${ERAS[Math.min(8, Math.floor(eraOf(a.a, a.year)))]}) 的${oobName(a.oob[0])} 打下 ${polityName(civ.polities[a.b], a.year)}(${ERAS[Math.max(0, Math.floor(eraOf(a.b, a.year)))]}) 的${oobName(a.oob[1])} 守的州,代差 ${g.toFixed(1)} 档`]);
}
rows.sort((x, y) => y[0] - x[0]);
console.log(rows.slice(0, 5).map((r) => r[1]).join('\n'));
