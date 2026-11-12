/** 本地实验:生成月球,写原始 RGBA 给 python 转 PNG。npx tsx scripts/local-moon.ts <seed> <out.rgba> */
import { writeFileSync } from 'node:fs';
import { generateMoon, moonRgba } from '../src/gen/moon';
const seed = Number(process.argv[2] ?? 7);
const t = performance.now();
const m = generateMoon(seed, 1024);
const ms = performance.now() - t;
writeFileSync(process.argv[3] ?? 'moon.rgba', moonRgba(m));
console.log(`${m.w}x${m.h} ${Math.round(ms)} ms;坑(≥25 km 半径)${m.craters.length};月海 ${m.maria.length}:`, m.maria.slice(0, 8).map((x) => `${x.lowland ? '洋' : '海'}(${x.lon.toFixed(0)},${x.lat.toFixed(0)}) r${Math.round(x.r)}`).join(' '));
