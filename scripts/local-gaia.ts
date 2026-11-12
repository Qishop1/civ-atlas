/** 本地实验:哪组参数最像"盖亚行星"(冰、荒漠少,森林草原多)。npx tsx scripts/local-gaia.ts */
import { generateWorld } from '../src/gen/world';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { Biome } from '../src/gen/biomes';
const sets: [string, Partial<typeof DEFAULT_PARAMS>][] = [
  ['地球默认', {}],
  ['暖 +4 湿 1.5', { temperature: 4, rainfall: 1.5 }],
  ['暖 +6 湿 1.6', { temperature: 6, rainfall: 1.6 }],
  ['暖 +8 湿 1.8', { temperature: 8, rainfall: 1.8 }],
];
const groups: [string, Biome[]][] = [
  ['冰雪', [Biome.Ice, Biome.Tundra]],
  ['荒漠', [Biome.ColdDesert, Biome.TemperateDesert, Biome.HotDesert]],
  ['草原', [Biome.Steppe, Biome.Savanna]],
  ['森林', [Biome.Taiga, Biome.TemperateForest, Biome.TemperateRainforest, Biome.TropicalDryForest, Biome.Rainforest]],
  ['湿地', [Biome.Wetland]],
];
for (const [name, p] of sets) {
  const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7, ...p });
  let land = 0;
  const c = new Map<number, number>();
  for (const b of w.biome) if (b > Biome.SeaIce) { land++; c.set(b, (c.get(b) ?? 0) + 1); }
  console.log(name, groups.map(([g, bs]) => `${g} ${Math.round((bs.reduce((a, b) => a + (c.get(b) ?? 0), 0) / land) * 100)}%`).join('  '));
}
