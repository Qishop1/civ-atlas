/**
 * 本地实验:各国改制推力(共治 + 民权 + 0.5 均产 − 0.6 天命)随年份的分布。
 * npx tsx scripts/local-push.ts seed=42 years=5000
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { IDEO_SCALE, THOUGHTS } from '../src/gen/civ/ideology';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 42);
const years = Number(opt('years') ?? 5000);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: years });
const T = THOUGHTS.length;
const idx = (n: string) => THOUGHTS.findIndex((t) => t.name === n);
const [SKY, CO, RIGHT, EQ, NAT] = ['天命之说', '共治之说', '民权之说', '均产之说', '国族之说'].map(idx);
const ideo = civ.ideology!;
for (let y = 2000; y <= years; y += 500) {
  const push: number[] = [];
  const parts: number[][] = [];
  ideo.polities.forEach((s, p) => {
    if (!s) return;
    const k = Math.floor((y - s.from) / 20);
    if (k < 0 || (k + 1) * T > s.v.length) return;
    const g = (i: number) => s.v[k * T + i] / IDEO_SCALE;
    if (s.v.slice(k * T, k * T + T).every((x) => x === 0)) return;
    push.push(g(CO) + g(RIGHT) + 0.5 * g(EQ) - 0.6 * g(SKY));
    parts.push([g(SKY), g(CO), g(RIGHT), g(EQ), g(NAT)]);
  });
  push.sort((a, b) => a - b);
  const q = (f: number) => (push.length ? push[Math.min(push.length - 1, Math.floor(f * push.length))].toFixed(2) : '-');
  const avg = parts.length ? [0, 1, 2, 3, 4].map((i) => (parts.reduce((s, x) => s + x[i], 0) / parts.length).toFixed(2)) : [];
  console.log(`${y}: 国 ${push.length} 推力 中位 ${q(0.5)} 九成 ${q(0.9)} 最高 ${q(0.999)} ≥0.2 的 ${push.filter((x) => x >= 0.2).length} | 平均 天命/共治/民权/均产/国族 ${avg.join('/')}`);
}
