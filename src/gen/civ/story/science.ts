/**
 * 本地分支 modern-pace 第六十五轮:科学史 —— 推演完以后按发明表写出科学理论的突破,不改推演。纯计算。
 *
 * 推演里的"发明"全是技术(陶轮 … 火星殖民),没有一样是理论。这里按现实科学史(欧几里得 → 图灵 → 2017 年那八个人)
 * 在发明之间插上理论突破:每条一位(或几位)学者、一部著作,编年史标签"学"。
 *   年份:挂在两项发明之间(世上第一次有那项发明的年份,development.events 的 invent),按比例取;后一项没有 = 前一项 + 几十年
 *   国家:前一项发明最早出现那州那一年的主人;学者按那国民族的语感起名(personNamers),书名分东西方两套
 *   接上这个世界自己的数据(systemText.ts 的 starSystem):行星的古名、巨行星的卫星和环、双星(日心说写成绕质心、三体无通解)、
 *     母星的月亮挡不挡得住恒星(相对论靠日全食验证,还是另找办法)、母星的半径(量出星球周长)、国教(日心说、物种起源遭抵制)
 *   物种学名(本族的自称)在"物种起源"那条定下(speciesName)
 * 没走到那一步的世界(推演结束还没有那项发明)就没有那一条。
 */
import type { Civ, Year } from '../types';
import { INVENTIONS } from '../inventions';
import { ownersAt } from '../engine/timeline';
import { capitalAt, polityName } from '../growth';
import { keyed, subSeed } from '../engine/rand';
import { personNamers } from '../naming';
import { NAME_STYLES } from '../../names';
import { stateFaithAt } from '../religion';
import { starSystem } from './systemText';
import { cityNameAt } from './cityNames';
import { homeworldOf } from '../homeworld';
import type { ChronicleEntry } from './chronicle';

interface Ctx {
  civ: Civ;
  inv: Map<string, { year: Year; region: number }>;
  base: number;
}

/** 世上第一次有某项发明:年份、哪一州 */
function inventions(civ: Civ): Map<string, { year: Year; region: number }> {
  const out = new Map<string, { year: Year; region: number }>();
  for (const e of civ.development?.events ?? []) {
    if (e.kind !== 'invent') continue;
    const nm = INVENTIONS[(e as { invention: number }).invention]?.name;
    if (nm && !out.has(nm)) out.set(nm, { year: e.year, region: e.region });
  }
  return out;
}

const cache = new WeakMap<Civ, ChronicleEntry[]>();

/** 科学史的编年史条目(id 从 idBase 起) */
export function scienceEntries(civ0: Civ, idBase: number): ChronicleEntry[] {
  const civ = civ0;
  const hit = cache.get(civ);
  if (hit) return hit;
  const out: ChronicleEntry[] = [];
  cache.set(civ, out);
  if (!civ.viable || !civ.development) return out;
  const cx: Ctx = { civ, inv: inventions(civ.history ?? civ), base: subSeed(civ.seed, 'civ-science') };
  const rnd = (k: number, u: number) => keyed(cx.base, k, u);
  const namer = personNamers(civ.seed);
  const end = civ.endYear;
  let own: ReturnType<typeof ownersAt> | undefined;
  let ownY = NaN;
  const ownerOf = (r: number, y: Year) => {
    if (y !== ownY) {
      own = ownersAt(civ.history ?? civ, y, own);
      ownY = y;
    }
    return { p: own!.polity[r], c: own!.culture[r] };
  };
  const sys = starSystem(civ);
  const home = sys.sys.planets[sys.sys.home];
  const hw = homeworldOf(civ);
  let id = idBase;
  /** 某项发明之后、下一项之前,按比例 f 取年份;下一项没有 = 前一项 + gap 年 */
  const between = (a: string, b: string | null, f: number, gap: number): { year: Year; region: number } | null => {
    const A = cx.inv.get(a);
    if (!A) return null;
    const B = b ? cx.inv.get(b) : undefined;
    const y = B && B.year > A.year ? A.year + (B.year - A.year) * f : A.year + gap;
    return y < end ? { year: Math.floor(y), region: A.region } : null;
  };
  /** 学者:按所在州那一年的民族语感起名;key 区分是第几位 */
  const scholar = (r: number, y: Year, key: number) => {
    const o = ownerOf(r, y);
    const cu = o.c >= 0 ? civ.cultures[o.c] : undefined;
    const style = cu?.style || 'kingdom';
    const nm = namer(style);
    const name = nm.surnamed ? nm.surname(91000 + key) + nm.given(91000 + key) : `${nm.given(91000 + key)}·${nm.given(92000 + key)}`;
    const east = NAME_STYLES.find((s) => s.id === style)?.family === 'eastern';
    const P = o.p >= 0 ? civ.polities[o.p] : undefined;
    return { name, east, polity: o.p, who: P ? `${polityName(P, y)}学者${name}` : `学者${name}`, short: nm.surnamed ? nm.surname(91000 + key) : nm.given(91000 + key) };
  };
  const push = (y: Year, r: number, p: number, text: string, importance: 1 | 2 | 3) => {
    out.push({ id: id++, kind: 'science', year: y, end: y, text, tag: '学', importance, polities: p >= 0 ? [p] : [], regions: r >= 0 ? [r] : [], settlement: -1 });
  };
  const faithBans = (p: number, y: Year, k: number) => p >= 0 && !!stateFaithAt((civ.history ?? civ).religion, p, y) && rnd(k, 7) < 0.6;
  const bk = (east: boolean, w: string, e: string) => (east ? `《${e}》` : `《${w}》`);
  const planetNames = sys.names.filter((_, i) => i !== sys.sys.home);
  const giant = sys.sys.planets.findIndex((q) => (q.kind === 'gas' || q.kind === 'ice') && q.moons >= 2);
  const binary = sys.sys.companion;

  // ---- 古代 ----
  let t = between('文字', '造纸', 0.35, 300);
  if (t) {
    const s = scholar(t.region, t.year, 1);
    push(t.year, t.region, s.polity, `${s.who}著${bk(s.east, '几何原本', '方圆算经')},从五条公设推出整套几何`, 2);
  }
  t = between('文字', '造纸', 0.45, 350);
  if (t) {
    const s = scholar(t.region, t.year, 2);
    push(t.year, t.region, s.polity, `${s.who}著${bk(s.east, '论自然', '天地论')},以为${hw}居于天地正中,日月众星皆绕之而行`, 2);
  }
  t = between('文字', '造纸', 0.6, 420);
  if (t) {
    const s = scholar(t.region, t.year, 3);
    const real = 2 * Math.PI * home.radius;
    const err = (rnd(3, 1) - 0.5) * 0.16;
    push(t.year, t.region, s.polity, `${s.who}比较两地正午日影的长短,推算出${hw}周长约 ${Math.round((real * (1 + err)) / 1000) / 10} 万公里(今测 ${Math.round(real / 1000) / 10} 万公里)`, 2);
  }
  t = between('帆船', '水车', 0.5, 200);
  if (t) {
    const s = scholar(t.region, t.year, 4);
    push(t.year, t.region, s.polity, `${s.who}著${bk(s.east, '论浮体', '浮沉术')},提出浮力与杠杆之理`, 1);
  }
  // ---- 近代早期 ----
  const cop = between('印刷术', '远洋帆船', 0.5, 60);
  let kepY = NaN,
    kepR = -1;
  if (cop) {
    const s = scholar(cop.region, cop.year, 5);
    const center = binary?.mode === 'P' ? '两日共绕的质心' : '太阳';
    const seen = planetNames.slice(0, 3).join('、');
    const ban = faithBans(s.polity, cop.year, 5) ? ';国教教士斥为异端,其书被列为禁书' : '';
    push(cop.year, cop.region, s.polity, `${s.who}著${bk(s.east, '天球运行论', '天运论')},主张${hw}与${seen || '众游星'}皆绕${center}运行${ban}`, 3);
    const gy = cop.year + 25 + Math.floor(rnd(6, 1) * 20);
    if (gy < end) {
      const g = scholar(cop.region, gy, 6);
      const what =
        giant >= 0
          ? `见${sys.names[giant]}旁有 ${sys.sys.planets[giant].moons} 颗卫星绕行${sys.sys.planets[giant].ringed ? `,又见${sys.names[giant]}有环` : ''}`
          : '见月面山谷起伏,与地面无异';
      push(gy, cop.region, g.polity, `${g.who}自制望远镜观天,${what}`, 2);
    }
    kepY = cop.year + 55 + Math.floor(rnd(7, 1) * 25);
    kepR = cop.region;
    if (kepY < end) {
      const k = scholar(kepR, kepY, 7);
      push(kepY, kepR, k.polity, `${k.who}据多年观测推出行星运动三定律:${planetNames[0] ?? '游星'}等的轨道皆为椭圆`, 2);
    }
  }
  if (Number.isFinite(kepY)) {
    const st = cx.inv.get('蒸汽机');
    const ny = Math.floor(st && st.year > kepY + 20 ? kepY + (st.year - kepY) * 0.45 : kepY + 40);
    if (ny < end) {
      const n = scholar(kepR, ny, 8);
      const three = binary ? `;然${hw}天上两日并悬,三体之运动终无通解,此后数代学者为之耗尽心血` : '';
      push(ny, kepR, n.polity, `${n.who}著${bk(n.east, '自然哲学的数学原理', '格物数理')},提出运动三定律与万有引力,以一套法则统摄天上地下${three}`, 3);
      // 微积分之争:另一国的学者各自发明
      const others = civ.polities.filter((P) => P.id !== n.polity && P.founded <= ny && (P.ended === undefined || P.ended > ny));
      if (others.length) {
        const P2 = others[Math.floor(rnd(9, 1) * others.length)];
        const r2 = civ.settlements[capitalAt(P2, ny)]?.region ?? kepR;
        const l = scholar(r2, ny + 2, 9);
        if (ny + 2 < end) push(ny + 2, r2, l.polity, `${l.who}发表微积分之法,与${n.name}各自独立发明;两国学界为谁先谁后争执数十年`, 2);
      }
    }
  }
  // ---- 工业 ----
  t = between('机械织机', '化学工业', 0.5, 40);
  if (t) {
    const s = scholar(t.region, t.year, 10);
    push(t.year, t.region, s.polity, `${s.who}证明燃烧是物质与气体化合、质量守恒,又提出原子之说,化学自此成为一门科学`, 2);
  }
  t = between('化学工业', null, 0, 25);
  if (t) {
    const s = scholar(t.region, t.year, 11);
    push(t.year, t.region, s.polity, `${s.who}排出元素周期表,并预言了几种尚未发现的元素`, 2);
  }
  t = between('蒸汽机', '电报', 0.75, 50);
  if (t) {
    const s = scholar(t.region, t.year, 12);
    push(t.year, t.region, s.polity, `${s.who}发现电磁感应:磁能生电`, 2);
  }
  t = between('电报', '电力', 0.5, 30);
  if (t) {
    const s = scholar(t.region, t.year, 13);
    push(t.year, t.region, s.polity, `${s.who}写出电磁场方程组,推断光就是电磁波`, 2);
  }
  const dar = between('蒸汽机', null, 0, 75 + Math.floor(rnd(14, 1) * 25));
  if (dar) {
    const s = scholar(dar.region, dar.year, 14);
    const sp = speciesName(civ, s.east, dar.region, dar.year);
    const ban = faithBans(s.polity, dar.year, 14) ? ';国教教士群起抨击,论战延续数十年' : '';
    push(dar.year, dar.region, s.polity, `${s.who}著${bk(s.east, '物种起源', '物类原始')},提出生物经自然选择而演变;将本族定名为${sp}${ban}`, 3);
    const my = dar.year + 6;
    if (my < end) {
      const m = scholar(dar.region, my, 15);
      const back = my + 34 < end ? `;这篇论文无人问津,直到第 ${my + 34} 年才被重新发现` : ';这篇论文发表后无人问津';
      push(my, dar.region, m.polity, `${m.who}发表豌豆杂交实验,提出遗传定律${back}`, 1);
    }
  }
  if (dar && dar.year + 4 < end) {
    const s = scholar(dar.region, dar.year + 4, 16);
    push(dar.year + 4, dar.region, s.polity, `${s.who}证明疾病和腐败由微生物引起,创立细菌学说`, 2);
  }
  // ---- 电气 ----
  t = between('电力', '核武器', 0.08, 10);
  if (t) {
    const s = scholar(t.region, t.year, 17);
    push(t.year, t.region, s.polity, `${s.who}发现放射性,并分离出两种新元素`, 2);
  }
  const ein = between('电力', '核武器', 0.18, 20);
  if (ein) {
    const s = scholar(ein.region, ein.year, 18);
    push(ein.year, ein.region, s.polity, `${s.who}提出相对论:时间、空间随运动而变,引力是时空的弯曲`, 3);
    // 日全食验证:母星的月亮挡不挡得住恒星
    const moon = home.moons > 0 ? { radius: 1737, dist: 60.3 } : null;
    const moonAng = moon ? moon.radius / (moon.dist * home.radius) : 0;
    const starAng = (sys.sys.star.radius * 696000) / (home.a * 1.496e8);
    const vy = ein.year + (moonAng >= starAng ? 4 : 15 + Math.floor(rnd(18, 2) * 20));
    if (vy < end) {
      const v = scholar(ein.region, vy, 19);
      push(
        vy,
        ein.region,
        v.polity,
        moonAng >= starAng
          ? `${v.who}趁日全食观测太阳近旁的星光,证实光线被引力弯折,相对论得到验证`
          : `${hw}的月亮${moon ? '太小,遮不住太阳,这里没有日全食' : '不存在,这里没有日全食'};${v.who}改从${planetNames[0] ?? '内侧行星'}近日点的进动证实了相对论`,
        2,
      );
    }
  }
  t = between('电力', '核武器', 0.3, 30);
  if (t) {
    const a = scholar(t.region, t.year, 20);
    const b = scholar(t.region, t.year, 21);
    push(t.year, t.region, a.polity, `${a.name}、${b.name}等学者先后提出量子力学:能量一份一份,粒子也是波`, 2);
  }
  t = between('电力', '核武器', 0.55, 50);
  const hub = t?.year ?? -Infinity;
  if (t) {
    const s = scholar(t.region, t.year, 22);
    push(t.year, t.region, s.polity, `${s.who}发现天上那条光带外还有无数星系,而且彼此正在远离 —— 宇宙在膨胀`, 2);
  }
  // ---- 信息 ----
  const comp = cx.inv.get('计算机');
  if (comp) {
    // 现实里图灵(1936)在哈勃(1929)之后、计算机(1945)之前
    const ty = Math.floor(Math.max(comp.year - 12, hub + 4));
    const s = scholar(comp.region, ty, 23);
    if (ty < end && ty > -Infinity) {
      push(ty, comp.region, s.polity, `${s.who}提出可计算性理论,设想一种只靠纸带和规则就能完成一切计算的机器`, 3);
      // 战时破译
      const war = (civ.history ?? civ).annals.find((a) => a.kind === 'war' && a.year >= ty && a.year < ty + 15 && (a.a === s.polity || a.b === s.polity));
      if (war) {
        const foe = war.a === s.polity ? war.b : war.a;
        const F = foe >= 0 ? civ.polities[foe] : undefined;
        if (F) push(Math.floor(war.year) + 1, comp.region, s.polity, `${s.name}在战时主持破译${polityName(F, war.year)}的密码`, 2);
      }
    }
    const sh = Math.floor(comp.year + 3);
    if (sh < end) {
      const h = scholar(comp.region, sh, 24);
      push(sh, comp.region, h.polity, `${h.who}创立信息论,以"比特"度量信息`, 2);
    }
    const dn = Math.floor(comp.year + 7);
    if (dn < end) {
      const a = scholar(comp.region, dn, 25);
      const b = scholar(comp.region, dn, 26);
      push(dn, comp.region, a.polity, `${a.name}、${b.name}解出遗传物质的双螺旋结构`, 2);
    }
    const ai = cx.inv.get('人工智能');
    if (ai) {
      const ey = Math.floor(ai.year - 5);
      const lead = scholar(ai.region, ey, 27);
      const P = lead.polity >= 0 ? civ.polities[lead.polity] : undefined;
      const city = P ? cityNameAt(civ, capitalAt(P, ey), ey) : '';
      if (ey < end) push(ey, ai.region, lead.polity, `${city ? `${city}` : ''}一家研究院的八位研究者联名发表${bk(lead.east, '注意力就是你所需的一切', '专注论')}(第一作者${lead.name}),提出一种只靠"注意力"的模型结构;八人此后各奔东西,多数自立门户`, 3);
      const tt = Math.floor(ai.year + 1);
      if (tt < end) push(tt, ai.region, -1, `首次有机器在对话中让大多数提问者无法分辨对方是人还是机器 —— 通过了${s.name}当年提出的测试`, 3);
    }
  }
  out.sort((a, b) => a.year - b.year);
  return out;
}

/** 物种学名(本族的自称):东方语感两个字(意译),西方语感音译双名 + 意译 */
export function speciesName(civ: Civ, east: boolean, region: number, year: Year): string {
  const base = subSeed(civ.seed, 'civ-species');
  const cuOf = () => {
    const o = ownersAt(civ.history ?? civ, year);
    return o.culture[region] >= 0 ? civ.cultures[o.culture[region]] : undefined;
  };
  if (east) {
    const A = '灵明智慧思言知觉';
    return `${A[Math.floor(keyed(base, 1, 1) * A.length)]}人`;
  }
  const nm = personNamers(civ.seed)(cuOf()?.style || 'kingdom');
  const MEAN = ['能言者', '能思者', '知者', '制器者'];
  return `${nm.given(93001)}·${nm.given(93002)}(意为"${MEAN[Math.floor(keyed(base, 2, 1) * MEAN.length)]}")`;
}
