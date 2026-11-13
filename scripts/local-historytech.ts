/** 本地实验(第八十一轮):史书材料里的〔技术与社会〕〔同类事〕、思潮 / 宗教条目。npx tsx scripts/local-historytech.ts <seed> [polity] */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildHistoryPrompts } from '../src/ai/prompts/history';
const seed = Number(process.argv[2] ?? 2);
const civ: any = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5000 });
const scope: any = process.argv[3] ? { kind: 'polity', polity: Number(process.argv[3]) } : { kind: 'world' };
const P = buildHistoryPrompts(civ, { scope, style: 'plain', length: 'long' });
console.log(P.title, P.calls.length, '次调用');
for (const [i, c] of P.calls.entries()) {
  const b: string = (c as any).body;
  const sec = (name: string) => { const k = b.lastIndexOf(`
〔${name}〕`); if (k < 0) return ''; const e = b.indexOf('\n\n〔', k + 2); return b.slice(k, e < 0 ? undefined : e); };
  console.log(`\n==== 第 ${i + 1} 次  材料 ${b.length} 字`);
  console.log(sec('技术与社会').slice(0, 1400));
  console.log(sec('同类事').split('\n').slice(0, 4).join('\n'));
  const chron = sec('编年史');
  console.log('编年史里 思潮/宗教 条数:', (chron.match(/之说|创立|皈依|立为国教/g) ?? []).length);
}
