/** 本地自查:第六十四轮核冬天的后果 —— 轻重、死亡、之后的最高时代。npx tsx scripts/local-nwinter.ts 2 8 10 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentAt, CAP_COUNT, eraOf } from '../src/gen/civ/development';
import { fullChronicle } from '../src/gen/civ/story/religionText';
const seeds = process.argv.slice(2).map(Number);
for (const seed of seeds) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
  const w = civ.annals.find((a) => a.kind === 'nuke' && a.n === 6);
  if (!w) { console.log(seed, '没有核冬天'); continue; }
  const R = civ.regions.count;
  const topEra = (y: number) => {
    const d = developmentAt(civ.development!, y);
    const st = (civ.development as unknown as { era?: Float32Array[] });
    let best = 0;
    // 用发展快照里的时代(没有就按能力平均近似)
    for (let r = 0; r < R; r++) { let s = 0; for (let c = 0; c < 4; c++) s += d[r * CAP_COUNT + c]; best = Math.max(best, s / 4); }
    void st;
    return best.toFixed(1);
  };
  const y0 = w.year;
  const line = [-10, 20, 100, 300, 600].map((dy) => `${dy >= 0 ? '+' : ''}${dy}:${y0 + dy <= civ.endYear ? topEra(y0 + dy) : '-'}`).join(' ');
  const txt = fullChronicle(civ).find((e) => e.kind === 'nuke' && e.text.startsWith('核冬天引发全球饥荒'))?.text ?? '';
  const col = civ.annals.filter((a) => a.kind === 'collapse' && a.year >= y0 && a.year < y0 + 100).length;
  console.log(seed, Math.floor(y0), 'sev', (w.oob?.[1] ?? 0) / 1000, '| 能力均值最高州', line, '| 百年内大崩解', col);
  console.log('   ', txt.slice(0, 90));
  void eraOf;
}
