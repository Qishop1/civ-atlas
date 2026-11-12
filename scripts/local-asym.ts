// 近现代国家打古代国家:有多少场、打得怎样
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { developmentAt, eraLevel, ERAS } from '../src/gen/civ/development';
import { capitalAt } from '../src/gen/civ/growth';
import { modernSteps } from '../src/gen/civ/polities';
const seed = Number(process.argv[2] ?? 20030519), Y = Number(process.argv[3] ?? 4600);
const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: Y });
const dev = civ.development!;
const eraOfP = (pid: number, y: number) => {
  const p = civ.polities[pid]; const s = civ.settlements[capitalAt(p, y)];
  return s ? eraLevel(developmentAt(dev, y), s.region) : -1;
};
const conq = new Map<number, number>();
for (const a of civ.annals) if (a.kind === 'conquer' && a.war >= 0) conq.set(a.war, (conq.get(a.war) ?? 0) + 1);
const rows: string[] = [];
let n = 0;
civ.annals.forEach((a, i) => {
  if (a.kind !== 'war' || a.year < 3200) return;
  const ea = eraOfP(a.a, a.year), eb = eraOfP(a.b, a.year);
  if (ea < 0 || eb < 0 || ea - eb < 1.5) return;
  n++;
  const ma = modernSteps(civ.polities[a.a], a.year), mb = modernSteps(civ.polities[a.b], a.year);
  if (rows.length < 25) rows.push(`${Math.round(a.year)} 攻 ${ERAS[Math.min(8, Math.floor(ea))]}(${ea.toFixed(1)},近现代${ma}档) → 守 ${ERAS[Math.min(8, Math.floor(eb))]}(${eb.toFixed(1)},${mb}档) 攻下 ${conq.get(a.war) ?? 0} 州 ${civ.polities[a.b].ended !== undefined && civ.polities[a.b].ended! - a.year < 30 ? '守方亡' : ''}`);
});
console.log(`种子 ${seed}:3200 年以后攻方比守方先进 1.5 档以上的战争 ${n} 场`);
console.log(rows.join('\n'));
