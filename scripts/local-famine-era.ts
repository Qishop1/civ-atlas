/** 本地实验:信息时代以后各国的饥荒史事 —— 在不在核冬天、近 10 年打没打仗、轨道封锁。npx tsx scripts/local-famine-era.ts 2 11 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
for (const seed of process.argv.slice(2).map(Number)) {
  const civ: any = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 5500 });
  const h = civ.history ?? civ;
  const winters: [number, number][] = h.annals.filter((a: any) => a.kind === 'nuke' && a.n === 4).map((a: any) => [a.year, a.year + (a.oob?.[0] ?? 3)]);
  const wars = h.annals.filter((a: any) => a.kind === 'war');
  let nw = 0, war = 0, calm = 0, states = 0;
  const per = new Map<number, number>();
  for (const a of h.annals) {
    if (a.kind !== 'famine') continue;
    const P = civ.polities[a.a];
    const m: number[] | undefined = P?.modern;
    if (!m || m[2] === undefined || m[2] > a.year) continue;
    states += a.b;
    if (winters.some(([f, u]) => a.year >= f && a.year < u + 30)) nw++;
    else if (wars.some((w: any) => (w.a === a.a || w.b === a.a) && w.year <= a.year && w.year > a.year - 10)) war++;
    else { calm++; const c = Math.floor(a.year / 100) * 100; per.set(c, (per.get(c) ?? 0) + 1); }
  }
  console.log(`seed ${seed}: 核冬天(+30 年) ${nw} / 近 10 年打过仗 ${war} / 太平年 ${calm},平均 ${(states / Math.max(1, nw + war + calm)).toFixed(1)} 州;核冬天 ${winters.map((w) => w.map(Math.floor).join('–')).join(' ')}`);
  console.log('   太平年按百年:', [...per].sort((x, y) => x[0] - y[0]).map(([c, n]) => `${c}:${n}`).join(' '));
}
