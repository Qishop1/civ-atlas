/** 本地自查:第三十二轮现代传染病 —— 在起疫那刻、第 1 年、第 2 年切开接着推,和一口气推完的史事 / 日志一样。npx tsx scripts/local-plague-resume.ts 20030519 3900 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { resumeCiv } from '../src/gen/civ/modules';
const seed = Number(process.argv[2] ?? 20030519);
const end = Number(process.argv[3] ?? 3900);
const w = generateWorld({ seed } as WorldParams);
const whole = generateCiv(w, { endYear: end });
const first = whole.annals.find((e) => e.kind === 'plague' && e.cause === 'modern' && whole.annals.some((q) => q.kind === 'quarantine' && q.war === e.war));
if (!first) throw new Error('没有带关口岸的现代传染病');
const t0 = Math.floor(first.year);
console.log(`第 ${first.war} 场,${t0} 年起`);
let bad = 0;
for (const cut of [first.year, t0 + 1.5, t0 + 2.5]) {
  const half = generateCiv(w, { endYear: cut });
  const sim = resumeCiv(w, half);
  sim.run(whole.endYear);
  const res = sim.result();
  const okA = JSON.stringify(res.annals) === JSON.stringify(whole.annals);
  const okL = res.log.size === whole.log.size && (['year', 'region', 'layer', 'value', 'cause'] as const).every((k) => Buffer.from(res.log[k].buffer, res.log[k].byteOffset, res.log.size * res.log[k].BYTES_PER_ELEMENT).equals(Buffer.from(whole.log[k].buffer, whole.log[k].byteOffset, whole.log.size * whole.log[k].BYTES_PER_ELEMENT)));
  console.log(`从 ${cut} 接着推:史事 ${okA ? '一样' : '不一样'},日志 ${okL ? '一样' : '不一样'}`);
  if (!okA || !okL) bad++;
}
process.exit(bad ? 1 : 0);
