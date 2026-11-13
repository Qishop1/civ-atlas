/** 本地实验(第八十五轮 疫情):现代传染病的场次、间隔、年数、死亡、写法。npx tsx scripts/local-pandemic.ts 2 5 11 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
for (const seed of process.argv.slice(2).map(Number)) {
  const civ: any = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5000 });
  const es = buildChronicle(civ).filter((e) => e.kind === 'plague' && /新型传染病|传染病|疫情/.test(e.text));
  const ys = es.map((e) => Math.floor(e.year));
  const gaps = ys.slice(1).map((y, i) => y - ys[i]);
  const dead = es.map((e) => { const m = e.text.match(/死亡约?\s*([\d.]+)\s*(万|亿)?人/); return m ? Number(m[1]) * (m[2] === '亿' ? 1e4 : m[2] === '万' ? 1 : 1e-4) : 0; });
  const kinds = new Map<string, number>();
  for (const e of es) { const k = (e.text.match(/(\d+ 年后|当年)[^,;]*/)?.[0] ?? '?').replace(/\d+/, 'N'); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
  console.log(`seed ${seed}: ${es.length} 场;间隔 ${gaps.length ? Math.min(...gaps) + '–' + Math.max(...gaps) + ' 中位 ' + gaps.sort((a, b) => a - b)[gaps.length >> 1] : '-'} 年;死亡(万)${dead.map((d) => Math.round(d)).join(',')};结局 ${[...kinds].map(([k, n]) => `${k}×${n}`).join(' ')}`);
}
// 第八十五轮:各挑几条看写法
{
  const civ: any = generateCiv(generateWorld({ seed: Number(process.argv[2] ?? 2) } as WorldParams), { endYear: 5000 });
  const es = buildChronicle(civ).filter((e) => e.kind === 'plague' && /传染病|出血热|新型病毒|新型流感/.test(e.text));
  for (const e of es.slice(0, 10)) console.log('  ', Math.floor(e.year), e.text.slice(0, 150));
}
