/** 本地实验:史书提示里的〔时代〕和"时代"那一条。npx tsx scripts/local-historyera.ts 11 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { buildHistoryPrompts } from '../src/ai/prompts/history';
const seed = Number(process.argv[2] ?? 11);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
const P = buildHistoryPrompts(civ, { scope: (process.argv[3] ? { kind: 'polity', polity: Number(process.argv[3]) } : { kind: 'world' }) as any, style: 'plain', length: 'long' });
console.log(P.title, P.range, P.calls.length, '次调用');
for (const [i, c] of P.calls.entries()) {
  const t = JSON.stringify(c);
  const m = t.match(/〔时代〕.这一段[^〔【]*/);
  if (m) console.log(`第 ${i + 1} 次:`, m[0].replace(/\n/g, '\n').slice(0, 600));
}
const s = JSON.stringify(P).match(/- 时代:[^"]*/);
console.log(s ? s[0].slice(0, 300) : '没有"时代"一条');
