/** 本地实验:绕过滑条范围,陆地拉满、降水几乎为零、极冷,看生成器出什么。npx tsx scripts/local-mars.ts */
import { generateWorld } from '../src/gen/world';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { Biome } from '../src/gen/biomes';
const names = Object.fromEntries(Object.entries(Biome).filter(([, v]) => typeof v === 'number').map(([k, v]) => [v, k]));
for (const [tag, p] of [
  ['滑条极限(陆 60% 降水 0.4 −12°C)', { landFraction: 0.6, rainfall: 0.4, temperature: -12 }],
  ['绕过(陆 95% 降水 0.02 −12°C)', { landFraction: 0.95, rainfall: 0.02, temperature: -12 }],
  ['绕过(陆 95% 降水 0.02 −60°C)', { landFraction: 0.95, rainfall: 0.02, temperature: -60 }],
] as const) {
  try {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7, ...p });
    const c = new Map<number, number>();
    for (const b of w.biome) c.set(b, (c.get(b) ?? 0) + 1);
    const n = w.biome.length;
    console.log(tag, [...c].sort((a, b) => b[1] - a[1]).map(([b, k]) => `${names[b]} ${Math.round((k / n) * 100)}%`).join(' '));
  } catch (e) { console.log(tag, '出错:', (e as Error).message); }
}
