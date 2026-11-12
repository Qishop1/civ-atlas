/** 本地实验:恒星系。npx tsx scripts/local-system.ts 42 381500 20030519 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { starSystem } from '../src/gen/civ/story/systemText';
for (const seed of process.argv.slice(2).map(Number)) {
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: 30 });
  const S = starSystem(civ);
  const s = S.sys;
  console.log(`== 种子 ${seed}:${s.star.label} 主序星,一年 ${Math.round(s.yearDays)} 天,倾角 ${s.tilt.toFixed(1)}°,辐射 ${s.flux.toFixed(2)};${s.star.mass.toFixed(2)} 倍质量、${s.star.lum.toFixed(2)} 倍光度,雪线 ${s.frost.toFixed(2)} AU${s.belt ? `,${S.beltName} ${s.belt.inner.toFixed(2)}–${s.belt.outer.toFixed(2)} AU` : ',没有小行星带'};殖民目标 ${S.targetName}`);
  s.planets.forEach((p, i) => console.log(`  ${S.names[i]} ${p.kind} a=${p.a.toFixed(2)} AU 周期 ${p.period.toFixed(2)} 年 半径 ${Math.round(p.radius)} km ${p.teq}°C${p.ringed ? ' 有环' : ''} 卫星 ${p.moons}`));
}
