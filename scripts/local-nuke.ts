import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { polityName } from '../src/gen/civ/growth';
const civ = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 20030519) } as WorldParams), { endYear: 4600 });
const n = civ.annals.filter((a) => a.kind === 'nuke');
console.log('nuke annals', n.length, 'tests', n.filter((a) => a.n === 0).length, 'strikes', n.filter((a) => a.n === 1).length);
for (const a of n.slice(0, 8)) console.log(Math.floor(a.year), a.n, polityName(civ.polities[a.a], a.year), a.b >= 0 ? polityName(civ.polities[a.b], a.year) : '');
