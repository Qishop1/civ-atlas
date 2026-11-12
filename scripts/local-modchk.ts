import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentAt, eraLevel } from '../src/gen/civ/development';
import { capitalAt } from '../src/gen/civ/growth';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4300 });
const Y = Number(process.argv[2] ?? 3900);
const lv = developmentAt(civ.development!, Y);
for (const p of civ.polities) {
  if (p.founded > Y || (p.ended !== undefined && p.ended <= Y)) continue;
  const sid = capitalAt(p, Y);
  const r = civ.settlements[sid]?.region ?? -1;
  console.log(p.id, p.name ?? '', 'era', r >= 0 ? eraLevel(lv, r).toFixed(2) : '-', 'modern', JSON.stringify(p.modern?.map(Math.round) ?? []));
}
