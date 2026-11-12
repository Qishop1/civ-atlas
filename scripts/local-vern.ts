/**
 * 本地实验:列出"电气时代以后的国家"(Polity.modern 第二刻以后)的编年史条目,按 kind/标签分组,每组几个例子,看哪些还是文言。
 * npx tsx scripts/local-vern.ts seed=20030519 years=4700 per=4 out=file.txt
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { developmentEntries } from '../src/gen/civ/story/developmentText';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 20030519);
const years = Number(opt('years') ?? 4700);
const per = Number(opt('per') ?? 4);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: years });
const lvl = (p: number, y: number) => (civ.polities[p]?.modern ?? []).filter((t) => t <= y).length;
const all = [...buildChronicle(civ), ...developmentEntries(civ)].filter((e) => e.polities.length && lvl(e.polities[0], e.year) >= 2);
const groups = new Map<string, typeof all>();
for (const e of all) {
  const k = `${e.kind}/${e.tag}`;
  (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
}
const lines = [`种子 ${seed},电气时代以后的国家的条目 ${all.length} 条`, ''];
for (const [k, es] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`## ${k}  ${es.length}`);
  const step = Math.max(1, Math.floor(es.length / per));
  for (let i = 0; i < es.length && i < step * per; i += step) {
    const e = es[i];
    lines.push(`[${Math.floor(e.year)}] ${e.text}`);
    for (const c of (e.children ?? []).slice(0, 2)) lines.push(`    └ ${c.text}`);
  }
  lines.push('');
}
writeFileSync(opt('out') ?? 'vern.txt', lines.join('\n'), 'utf8');
console.log(lines[0], groups.size, '组');
