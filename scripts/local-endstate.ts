/**
 * 本地实验:一批种子跑到 end 年,各世界的结局分类(全球联邦 / 联邦 + 对手 / 帝国 / 两极 / 多极),外加联邦成立过几次、亡过几次、核战几场。
 * npx tsx scripts/local-endstate.ts 1 30 5500
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
const s0 = Number(process.argv[2] ?? 1);
const n = Number(process.argv[3] ?? 30);
const end = Number(process.argv[4] ?? 5500);
const tally = new Map<string, number>();
for (let seed = s0; seed < s0 + n; seed++) {
  const t0 = Date.now();
  const civ = generateCiv(generateWorld({ seed } as WorldParams), { endYear: end });
  if (!civ.viable) {
    console.log(`种子 ${seed}:没有文明`);
    tally.set('没有文明', (tally.get('没有文明') ?? 0) + 1);
    continue;
  }
  const size = new Map<number, number>();
  let owned = 0;
  for (let r = 0; r < civ.polity.length; r++) {
    const p = civ.polity[r];
    if (p < 0) continue;
    owned++;
    size.set(p, (size.get(p) ?? 0) + 1);
  }
  const top = [...size].sort((a, b) => b[1] - a[1]);
  const s1 = top[0] ? top[0][1] / owned : 0,
    s2 = top[1] ? top[1][1] / owned : 0;
  const F = civ.polities.find((p) => p.federation !== undefined && p.ended === undefined);
  const fShare = F ? (size.get(F.id) ?? 0) / owned : 0;
  const fedFormed = civ.annals.filter((a) => a.kind === 'federation' && a.n === 0).length;
  const unified = civ.annals.find((a) => a.kind === 'federation' && a.n === 2);
  const fedDead = civ.polities.filter((p) => p.federation !== undefined && p.ended !== undefined).length;
  const nukeWars = new Set(civ.annals.filter((a) => a.kind === 'nuke').map((a) => a.war)).size;
  const winters = civ.annals.filter((a) => a.kind === 'nuke' && a.n === 4).length;
  let cls: string;
  if (F && fShare >= 0.9) cls = '全球联邦';
  else if (F) cls = '联邦+对手';
  else if (s1 >= 0.6) cls = '帝国';
  else if (s1 >= 0.25 && s2 >= 0.2 && s1 + s2 >= 0.6) cls = '两极';
  else cls = '多极';
  tally.set(cls, (tally.get(cls) ?? 0) + 1);
  console.log(
    `种子 ${seed}:${cls}|国家 ${size.size}|最大 ${(s1 * 100).toFixed(0)}% 次大 ${(s2 * 100).toFixed(0)}%|联邦成立 ${fedFormed} 次${fedFormed ? `(首次 ${Math.floor(civ.annals.find((a) => a.kind === 'federation' && a.n === 0)!.year)})` : ''}、亡 ${fedDead} 次${unified ? `、${Math.floor(unified.year)} 全球统一` : ''}|核战 ${nukeWars} 场、核冬天 ${winters}|${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
}
console.log('—— 合计:' + [...tally].map(([k, v]) => `${k} ${v}`).join(',') + ` / ${n}`);
