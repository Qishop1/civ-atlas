/**
 * 本地实验:推完时还没国家的有人住的州 —— 为什么没人占。
 * npx tsx scripts/local-wild.ts seed=42 years=5000
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersFromScratch } from '../src/gen/civ/engine/timeline';
import { cultureTerrain } from '../src/gen/civ/cultures';
import { AdjKind } from '../src/gen/civ/types';
import { BIOMES } from '../src/gen/biomes';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 42);
const years = Number(opt('years') ?? 5000);
const w = generateWorld({ seed } as WorldParams);
const civ = generateCiv(w, { endYear: years });
const own = ownersFromScratch(civ, years);
const reg = civ.regions;
const T = cultureTerrain(w, civ.habitat, reg);
let wild = 0, landNb = 0, seaNb = 0, iso = 0;
const suit: number[] = [], suitOwned: number[] = [];
const biome = new Map<string, number>();
for (let r = 0; r < reg.count; r++) {
  if (own.culture[r] < 0) continue;
  if (own.polity[r] >= 0) { suitOwned.push(T.meanSuit[r]); continue; }
  wild++;
  suit.push(T.meanSuit[r]);
  const bn = BIOMES[reg.biome[r]]?.name ?? String(reg.biome[r]);
  biome.set(bn, (biome.get(bn) ?? 0) + 1);
  let land = false, sea = false;
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    if (own.polity[reg.adj[k]] < 0) continue;
    const kind = reg.adjKind[k];
    if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) sea = true; else land = true;
  }
  if (land) landNb++; else if (sea) seaNb++; else iso++;
}
const q = (a: number[], f: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(f * (s.length - 1))].toFixed(2) : '-'; };
console.log(`种子 ${seed} 第 ${years} 年:无国的州 ${wild}(陆上挨着国家 ${landNb}、只隔海挨着 ${seaNb}、四周也都无国 ${iso})`);
console.log(`宜居分 无国的 中位 ${q(suit, 0.5)} 九成 ${q(suit, 0.9)} | 有国的 一成 ${q(suitOwned, 0.1)} 中位 ${q(suitOwned, 0.5)}`);
console.log('群落', [...biome].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · '));
// 陆上挨着国家的无国州:邻国进了几档近现代、邻国是什么类型、亡没亡
const tally = new Map<string, number>();
for (let r = 0; r < reg.count; r++) {
  if (own.culture[r] < 0 || own.polity[r] >= 0) continue;
  let best = -1;
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    const kind = reg.adjKind[k];
    if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) continue;
    const p = own.polity[reg.adj[k]];
    if (p >= 0) best = Math.max(best, civ.polities[p].modern?.length ?? 0);
  }
  if (best < 0) continue;
  const key = `邻国近现代 ${best} 档`;
  tally.set(key, (tally.get(key) ?? 0) + 1);
}
console.log([...tally].map(([k, v]) => `${k}: ${v}`).join(' · '));
