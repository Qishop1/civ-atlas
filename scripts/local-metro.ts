import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { metroOf } from '../src/gen/civ/story/practiceInfo';
import { polityName } from '../src/gen/civ/growth';
const civ = generateCiv(generateWorld({ seed: 20030519 } as WorldParams), { endYear: 4600 });
for (const y of [3600, 3800, 4000, 4300, 4600]) {
  const rows = civ.polities.filter((p) => p.founded <= y && (p.ended === undefined || p.ended > y)).map((p) => { const [k, c] = metroOf(civ, p.id, y); return { k, c, n: polityName(p, y) }; }).sort((a, b) => b.k - a.k).slice(0, 3);
  console.log(y, rows.map((r) => `${r.n}·${r.c} ${(r.k / 1e5).toFixed(2)}亿`).join(' | '));
}
