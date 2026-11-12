/**
 * 本地实验:把某段年份的编年史(重要度 ≥ min)写到文件里读,看近现代读起来像不像。
 * npx tsx scripts/local-chronicle.ts seed=20030519 years=4300 from=3300 to=4300 min=2 out=file.txt
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { developmentEntries } from '../src/gen/civ/story/developmentText';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 20030519);
const years = Number(opt('years') ?? 4300);
const from = Number(opt('from') ?? 3300);
const to = Number(opt('to') ?? years);
const min = Number(opt('min') ?? 2);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: years });
const all = [...buildChronicle(civ), ...developmentEntries(civ)].filter((e) => e.year >= from && e.year <= to && e.importance >= min).sort((a, b) => a.year - b.year);
const tags = new Map<string, number>();
for (const e of all) tags.set(e.tag, (tags.get(e.tag) ?? 0) + 1);
const lines = [`种子 ${seed},第 ${from}–${to} 年,重要度 ≥ ${min}:${all.length} 条`, '标签:' + [...tags].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join(' '), ''];
for (const e of all) {
  lines.push(`[${Math.floor(e.year)}] (${e.tag}) ${e.text}`);
  for (const c of e.children ?? []) lines.push(`    └ [${Math.floor(c.year)}] ${c.text}`);
}
writeFileSync(opt('out') ?? 'chronicle.txt', lines.join('\n'), 'utf8');
console.log(lines.slice(0, 2).join('\n'));
