/**
 * 本地实验(civ-atlas 自用分支 modern-pace):量时代节奏。
 * npx tsx scripts/local-era-pace.ts years=8000 seeds=7,2024,20030519 [out=file.json]
 * 每个种子:世界第一次进入各时代的年份、推完时各时代的州数、现存国家数、发明条数、各段耗时。
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ERAS, developmentAt, eraLevel, eraOf, CAP_COUNT } from '../src/gen/civ/development';
import { ownersFromScratch } from '../src/gen/civ/engine/timeline';
import { THOUGHTS } from '../src/gen/civ/ideology';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(k + '='))?.slice(k.length + 1);
const years = Number(opt('years') ?? 3000);
const seeds = (opt('seeds') ?? '7,2024,20030519').split(',').map(Number);
const out: unknown[] = [];

for (const seed of seeds) {
  const t0 = performance.now();
  const w = generateWorld({ seed } as WorldParams);
  const t1 = performance.now();
  const civ = generateCiv(w, { endYear: years });
  const t2 = performance.now();
  const dev = civ.development;
  const first: Record<string, number> = {};
  let invents = 0;
  for (const e of dev?.events ?? []) {
    if (e.kind === 'first' && first[ERAS[e.era]] === undefined) first[ERAS[e.era]] = Math.round(e.year);
    if (e.kind === 'invent') invents++;
  }
  // 每 1000 年一张:有国的州 / 无国(部落)的州,各时代几州(按 ERAS 顺序,"国:a/b/c… 野:…")
  const dist: Record<string, string> = {};
  if (dev) {
    const R = civ.regions.count;
    for (let y = 1000; y <= years; y += 1000) {
      const lv = developmentAt(dev, y);
      const own = ownersFromScratch(civ, y).polity;
      const st = new Array(ERAS.length).fill(0), wild = new Array(ERAS.length).fill(0);
      for (let r = 0; r < R; r++) {
        if (lv[r * CAP_COUNT] === 0 && lv[r * CAP_COUNT + 1] === 0) continue;
        const { era } = eraOf(eraLevel(lv, r));
        (own[r] >= 0 ? st : wild)[era]++;
      }
      dist[y] = `国 ${st.join('/')} 野 ${wild.join('/')}`;
    }
  }
  // 思潮头一处冒出来的年份
  const ideo: Record<string, number> = {};
  for (const e of civ.ideology?.events ?? []) if (e.kind === 'origin') ideo[THOUGHTS[e.thought].name] = Math.round(e.year);
  // 史事按千年分桶计数(只列关心的几种)
  const KINDS = ['war', 'fall', 'found', 'dynasty', 'split', 'revolt', 'collapse', 'famine', 'reform', 'council'];
  const ann: Record<string, string> = {};
  for (const k of KINDS) {
    const b = new Array(Math.ceil(years / 1000)).fill(0);
    for (const a of civ.annals) if (a.kind === k) b[Math.min(b.length - 1, Math.floor(a.year / 1000))]++;
    if (b.some((x) => x)) ann[k] = b.join('/');
  }
  {
    const b = new Array(Math.ceil(years / 1000)).fill(0);
    for (const a of civ.annals) if (a.kind === 'council' && a.war >= 11 && a.war <= 14) b[Math.min(b.length - 1, Math.floor(a.year / 1000))]++;
    ann['reformCouncil'] = b.join('/');
  }
  const alive = civ.polities.filter((p) => p.ended === undefined || p.ended >= years).length;
  const row = { seed, years, worldMs: Math.round(t1 - t0), civMs: Math.round(t2 - t1), polities: civ.polities.length, alive, invents, first, ideo, ann, dist };
  out.push(row);
  console.log(JSON.stringify(row));
}
const f = opt('out');
if (f) writeFileSync(f, JSON.stringify(out, null, 1));
