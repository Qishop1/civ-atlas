/**
 * 本地分支 modern-pace:恒星系视图 —— 地球仪缩到最小再往外缩就进来(Globe.tsx 的 zoomBy → spaceStore.enterSystemView)。
 * 第四十八轮起和新建世界的行星系统同一套:透视相机(视野 35°,studio/persp.ts),星体交给显卡画(studio/perspGL.ts;显卡不行退回 CPU)。
 *
 *   进来    母星在屏上的大小、位置和缩出去那一刻的地球仪一样,看着同一面、北在上;刚进来时母星照地球仪那样全亮,往外拉慢慢变成真的昼夜
 *   缩放    滚轮把镜头推近 / 拉远(真实比例):母星近旁 → 月球轨道 → 母星成点 → 整个恒星系;越往外,镜头对着的点从盯住的星体移向恒星。
 *           盯着母星推回到进来时那么近 = 回到地球仪
 *   点      行星、月球、恒星:镜头 0.8 秒飞过去、盯住它(能推到表面看);双击 / "回到母星" = 盯回母星
 *   时间    只有一个"现在" = 时间轴的年份(带小数);开着时按播放走天文档(spaceStore.astro;CivTimeline 照它推进)。历史档太快:自转、月亮按整年取
 *   母星    贴主图(推演里的地图),按 gen/system.ts 的 homeSpin 自转;月亮 = 推演里登月的那颗(月面图按文明种子,潮汐锁定)
 *   别的    各行星按新建世界那一步的贴图(planetTex.ts:高清的在后台线程算)、环、大卫星;同步轨道环和太空电梯(母星赤道上,跟着自转);
 *           小行星带;各行星轨道(离母星近时淡掉);殖民地汇总写在名字后面;悬停写天体的说明
 * 只读推演和编年史,不改推演。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { AU_KM, HOME_RADIUS, KIND_NAME, LUNA, homeSpin, homeSpinInv, lunaAt, orbitToEcliptic, planetAt, starsAt } from '../gen/system';
import { planetSeed, starSystem } from '../gen/civ/story/systemText';
import { orbitalRing, spaceTowers } from '../gen/civ/story/spaceText';
import { DEBRIS_N, blockadesOf, debrisDensity, debrisPoint, towerSevered } from '../gen/civ/orbit';
import { bodyName, colonies, colonyPop, headText, type ColonyBody } from '../gen/civ/story/colonies';
import { generateMoon, moonRgba } from '../gen/moon';
import { getCivTime, setCivTime, useCivTime } from './civView';
import { ASTRO_STEPS, exitSystemView, getSpaceUi, setAstro, setMoonView, useSpaceUi } from './spaceStore';
import { FOV, drawRingP, drawSphereP, makeCam, occluded, project, sphereScreen, type Atmo, type Cam, type V3 } from './studio/persp';
import { beltParticles, createPerspGL, skyParticles, type PerspGL } from './studio/perspGL';
import { moonTexture, planetTexture, prefetchSystem, ringOf, skyTexture } from './studio/planetTex';
import type { Tex } from './studio/planetTexGen';
import { atmoOf, eqBasis, majorOf, moonPeriodDays, obliquityOf, spinRows } from './studio/bodyFrame';
import './space.css';

const RAD = Math.PI / 180;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const norm = (d: V3): V3 => {
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / l, d[1] / l, d[2] / l];
};
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];

/** 地形画布缩成 2048 宽的像素(画母星用) */
function texOf(c: HTMLCanvasElement | null): Tex | null {
  if (!c || !c.width || !c.height) return null;
  const w = 2048, h = 1024;
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  const g = t.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(c, 0, 0, w, h);
  return { px: g.getImageData(0, 0, w, h).data, w, h };
}
const moonTex = new Map<string, Tex>();
/** 推演里的月球(和月球视图、登月地点同一张月面图:文明种子) */
function lunaTex(seed: number, size: number): Tex {
  const k = `${seed}:${size}`;
  let t = moonTex.get(k);
  if (!t) {
    const m = generateMoon(seed, size);
    t = { px: moonRgba(m), w: m.w, h: m.h };
    if (moonTex.size > 6) moonTex.clear();
    moonTex.set(k, t);
  }
  return t;
}

/** 镜头盯着什么:母星 / 第 i 颗行星 / 月亮 / 恒星 */
type Focus = { k: 'home' } | { k: 'planet'; i: number } | { k: 'moon' } | { k: 'star' };
const sameFocus = (a: Focus, b: Focus) => a.k === b.k && (a.k !== 'planet' || (b.k === 'planet' && a.i === b.i));

export function SystemView({ civ, terrain }: { civ: Civ | null; terrain: () => HTMLCanvasElement | null }) {
  const { system } = useSpaceUi();
  if (!system || !civ || !civ.viable) return null;
  return <SystemBody civ={civ} terrain={terrain} entry={system} />;
}

function SystemBody({ civ, terrain, entry }: { civ: Civ; terrain: () => HTMLCanvasElement | null; entry: NonNullable<ReturnType<typeof useSpaceUi>['system']> }) {
  const S = useMemo(() => starSystem(civ), [civ]);
  const sys = S.sys;
  const home = sys.planets[sys.home];
  const seed = planetSeed() ?? civ.seed;
  const { astro } = useSpaceUi();
  const ct = useCivTime();
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const glCv = useRef<HTMLCanvasElement>(null);
  const glR = useRef<PerspGL | null | undefined>(undefined);
  const tex = useMemo(() => texOf(terrain()), [terrain]);
  // 月面图:先用 256 宽的,0.1 秒后换 1024 宽的(推近看月面不糊)
  const [lunaBig, setLunaBig] = useState<Tex | null>(null);
  const lunaSmall = useMemo(() => lunaTex(civ.seed, 256), [civ.seed]);
  useEffect(() => {
    const h = setTimeout(() => setLunaBig(lunaTex(civ.seed, 1024)), 100);
    return () => clearTimeout(h);
  }, [civ.seed]);
  const ltex = lunaBig ?? lunaSmall;
  const ltexRef = useRef(ltex);
  ltexRef.current = ltex;
  // 别的行星、它们的大卫星的高清贴图:进来就排上
  useEffect(() => {
    prefetchSystem(seed, sys.planets.filter((p) => p.kind !== 'home'), null);
  }, [seed, sys]);
  const outer = Math.max(sys.planets[sys.planets.length - 1].a, ...sys.belts.map((b) => b.outer)) * AU_KM;
  const t0 = getCivTime().year ?? civ.endYear;
  // 镜头:绕着盯住的点转(偏航、俯仰在黄道坐标里),离它多远(公里,现在 / 目标);换对象时从上一个镜头位置飞过去
  const view = useRef(
    (() => {
      const v: V3 = [Math.cos(entry.lat) * Math.cos(entry.lon), Math.cos(entry.lat) * Math.sin(entry.lon), Math.sin(entry.lat)];
      const D = homeSpin(sys, t0)(v);
      return {
        focus: (entry.focus === 'moon' ? { k: 'moon' } : { k: 'home' }) as Focus,
        yaw: Math.atan2(D[1], D[0]),
        pitch: Math.asin(Math.max(-1, Math.min(1, D[2]))),
        dist: 0,
        distT: 0,
        d0: 0,
        from: null as null | { eye: V3; look: V3; t: number },
        eye: [0, 0, 0] as V3,
        look: [0, 0, 0] as V3,
      };
    })(),
  );
  const [focus, setFocusState] = useState<Focus>(entry.focus === 'moon' ? { k: 'moon' } : { k: 'home' });
  const [hover, setHover] = useState<string>('');
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const picks = useRef<{ x: number; y: number; r: number; text: string; focus: Focus }[]>([]);
  const lim = useRef({ dMin: 1, dMax: 1 });

  const cols = useMemo(() => colonies(civ), [civ]);
  const ring = useMemo(() => orbitalRing(civ), [civ]);
  const debrisBlocks = useMemo(() => blockadesOf((civ.history ?? civ).annals), [civ]);
  const towerLons = useMemo(() => spaceTowers(civ).map((t) => civ.regions.lon?.[t.region] ?? 0), [civ]);
  // 小行星带的点;周期按标准年:母星的周期 × (a / 母星的 a)^1.5
  const belt = useMemo(() => {
    let a = (civ.seed ^ 0x9e3779b9) >>> 0;
    const r = () => ((a = (Math.imul(a ^ (a >>> 15), 2246822507) + 0x6d2b79f5) >>> 0) / 4294967296);
    return sys.belts.flatMap((b) =>
      Array.from({ length: b.count }, () => {
        const R0 = b.inner + (b.outer - b.inner) * r();
        return { a: R0, th: r() * Math.PI * 2, z: (r() - 0.5) * 0.06 * R0, P: home.period * Math.pow(R0 / home.a, 1.5) };
      }),
    );
  }, [sys, civ.seed, home.a, home.period]);
  // 第五十轮:粒子 —— 小行星带(周期按标准年)、星空 + 银河
  const beltData = useMemo(() => beltParticles(sys.belts, civ.seed, 20, (a) => home.period * Math.pow(a / home.a, 1.5)), [sys, civ.seed, home.a, home.period]);
  const skyData = useMemo(() => skyParticles(seed), [seed]);
  // 各行星的自转轴
  const frames = useMemo(() => sys.planets.map((p) => eqBasis(...obliquityOf(seed, p.key))), [sys, seed]);

  const setFocus = (f: Focus) => {
    const v = view.current;
    if (sameFocus(f, v.focus)) return;
    v.from = { eye: v.eye, look: v.look, t: performance.now() };
    v.focus = f;
    v.distT = 0; // 下一帧按新对象的默认远近
    setFocusState(f);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && exitSystemView();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const c = cv.current, el = box.current;
      if (!c || !el) return;
      const rect = el.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      if (glR.current === undefined && glCv.current) glR.current = createPerspGL(glCv.current);
      const GL = glR.current ?? null;
      GL?.begin(w, h, dpr);
      const v = view.current;
      const tc = getCivTime();
      const t = tc.year ?? civ.endYear;
      // 历史档在放:太快,自转、月亮的位置按整年取(不画频闪)
      const fast = tc.playing && getAstro() === null;
      const tSpin = fast ? Math.floor(t) : t;
      const foc = h / 2 / Math.tan(FOV / 2);
      // 进来那一刻的远近:母星在屏上的半径 = 地球仪的半径
      if (!v.d0) {
        v.d0 = HOME_RADIUS / Math.sin(Math.atan(entry.R / foc));
        // 点"月球"进来的:从月球外面一点推近
        v.dist = v.distT = entry.focus === 'moon' ? LUNA.radius * 12 : v.d0;
        if (entry.focus === 'moon') v.distT = LUNA.radius * 5;
      }
      // ---- 各星体此刻的位置(公里,黄道坐标,主星在原点附近)----
      const st = starsAt(sys, t);
      const starPos = mul(st.primary as V3, AU_KM);
      // S 型双星:行星绕主星转,主星自己绕质心转 —— 行星、轨道、小行星带都跟着主星走(P 型绕质心,不挪)
      const host: V3 = sys.companion?.mode === 'S' ? starPos : [0, 0, 0];
      const pos = sys.planets.map((p) => add(host, mul(planetAt(p, t) as V3, AU_KM)));
      const E = pos[sys.home];
      const lm = lunaAt(fast ? Math.floor(t) : t) as V3;
      const moonPos = add(E, lm);
      // ---- 镜头 ----
      const f = v.focus;
      const fPos: V3 = f.k === 'home' ? E : f.k === 'planet' ? pos[f.i] : f.k === 'moon' ? moonPos : starPos;
      const fR = f.k === 'home' ? HOME_RADIUS : f.k === 'planet' ? sys.planets[f.i].radius : f.k === 'moon' ? LUNA.radius : sys.star.radius;
      const dMin = f.k === 'home' ? v.d0 * 0.999 : fR * 2.6;
      const dMax = (outer * 1.15) / Math.tan(FOV / 2);
      lim.current = { dMin, dMax };
      if (!v.distT) v.distT = f.k === 'home' ? v.d0 * 3 : f.k === 'star' ? fR * 40 : fR * 6;
      v.distT = Math.max(dMin, Math.min(dMax, v.distT));
      v.dist = Math.exp(Math.log(v.dist) + (Math.log(v.distT) - Math.log(v.dist)) * 0.2);
      // 越往外,镜头对着的点从盯住的星体移向恒星
      const rf = Math.hypot(fPos[0] - starPos[0], fPos[1] - starPos[1], fPos[2] - starPos[2]);
      const wgt = rf > 0 ? smooth(Math.log(rf * 0.15), Math.log(rf * 1.5), Math.log(v.dist)) : 0;
      let look: V3 = add(mul(fPos, 1 - wgt), mul(starPos, wgt));
      const dirE: V3 = [Math.cos(v.pitch) * Math.cos(v.yaw), Math.cos(v.pitch) * Math.sin(v.yaw), Math.sin(v.pitch)];
      let eye = add(look, mul(dirE, v.dist));
      if (v.from) {
        const b = Math.min(1, (performance.now() - v.from.t) / 800);
        const e = 1 - (1 - b) * (1 - b);
        // 对数插值远近:从远处飞到近处不会一下子冲进去
        eye = add(mul(v.from.eye, 1 - e), mul(eye, e));
        look = add(mul(v.from.look, 1 - e), mul(look, e));
        if (b >= 1) v.from = null;
      }
      v.eye = eye;
      v.look = look;
      // 北在上:刚进来时按母星的自转轴(和地球仪一样),往外拉慢慢换成黄道的北
      const axis = homeSpin(sys, tSpin)([0, 0, 1]);
      const upW = f.k === 'home' ? smooth(Math.log(v.d0 * 1.5), Math.log(v.d0 * 40), Math.log(v.dist)) : 1;
      const up = norm(add(mul(axis, 1 - upW), mul([0, 0, 1], upW)));
      const cx = Math.max(60, Math.min(w - 60, entry.cx - rect.left)), cy = Math.max(60, Math.min(h - 60, entry.cy - rect.top));
      // 算的时候一律以镜头为原点(位置都是几亿公里,显卡的单精度会抖)
      const cam: Cam = makeCam([0, 0, 0], sub(look, eye), up, cx, cy, w, h);
      const R = (p: V3): V3 => sub(p, eye);
      const P = (p: V3) => project(cam, R(p));
      picks.current = [];
      const labels: { t: string; x: number; y: number; c: string; size: number }[] = [];
      // 星体(挡轨道线、挡星空用)
      const balls: { C: V3; R: number }[] = [{ C: R(E), R: HOME_RADIUS }, { C: R(moonPos), R: LUNA.radius }, ...sys.planets.map((p, i) => ({ C: R(pos[i]), R: p.radius }))];
      // 刚进来时母星照地球仪那样全亮,往外拉慢慢变成真的昼夜
      const flat = f.k === 'home' ? 1 - smooth(Math.log(v.d0), Math.log(v.d0 * 6), Math.log(v.dist)) : 0;

      // ---- 背景星空(被星体挡住的不画)----
      const discs = balls.map((b) => sphereScreen(cam, b.C, b.R)).filter((q): q is { x: number; y: number; r: number } => !!q && q.r > 2);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      if (GL) {
        const stx = skyTexture(seed);
        if (stx) GL.skyTex(cam, stx, 0.4);
        GL.sky(cam, skyData, 1);
      }
      else for (let k = 0; k < 220; k++) {
        const x = (((k * 7919) % 1000) / 1000) * w, y = (((k * 104729) % 997) / 997) * h;
        if (discs.some((d) => Math.hypot(d.x - x, d.y - y) < d.r)) continue;
        g.fillRect(x, y, k % 7 === 0 ? 1.6 : 1, k % 7 === 0 ? 1.6 : 1);
      }

      // ---- 恒星(双星:主星、伴星各画一颗)----
      const drawStar = (sp: V3, s0: { radius: number; color: [number, number, number]; label: string; mass: number; lum: number; temp: number }, name: string) => {
        const rel = R(sp);
        const q = project(cam, rel);
        if (!q) return;
        const d = Math.hypot(rel[0], rel[1], rel[2]);
        const r0 = Math.max(3, foc * Math.tan(Math.asin(Math.min(1, s0.radius / d))));
        const gr = r0 * 5 + 26;
        if (GL) GL.star(cam, q[0], q[1], r0, gr, s0.color);
        else {
          const [sr0, sg0, sb0] = s0.color;
          const glow = g.createRadialGradient(q[0], q[1], 0, q[0], q[1], gr);
          glow.addColorStop(0, `rgba(${sr0},${sg0},${sb0},1)`);
          glow.addColorStop(0.25, `rgba(${sr0},${sg0},${sb0},0.6)`);
          glow.addColorStop(1, `rgba(${sr0},${sg0},${sb0},0)`);
          g.fillStyle = glow;
          g.beginPath();
          g.arc(q[0], q[1], gr, 0, Math.PI * 2);
          g.fill();
        }
        if (occluded(cam, rel, balls)) return;
        labels.push({ t: name, x: q[0], y: q[1] + r0 + 12, c: '#ffe7b0', size: 13 });
        picks.current.push({ x: q[0], y: q[1], r: r0 + 6, focus: { k: 'star' }, text: `${name}:${s0.label} 主序星,${s0.mass.toFixed(2)} 倍太阳质量、${s0.lum.toFixed(2)} 倍太阳光度、表面 ${Math.round(s0.temp)} K` });
      };
      drawStar(starPos, sys.star, sys.companion ? '太阳(主星)' : '太阳');
      if (sys.companion && st.companion) drawStar(mul(st.companion as V3, AU_KM), sys.companion, `伴星(${sys.companion.mode === 'P' ? '近距互绕' : '远伴星'})`);

      // ---- 线:3D 点串投到屏上,被星体挡住的、在镜头后面的段断开 ----
      const line3 = (pts: V3[], color: string, width: number, test = true) => {
        g.strokeStyle = color;
        g.lineWidth = width;
        g.beginPath();
        let on = false;
        for (const p of pts) {
          const rel = R(p);
          const q = project(cam, rel);
          if (!q || (test && occluded(cam, rel, balls))) {
            on = false;
            continue;
          }
          if (on) g.lineTo(q[0], q[1]);
          else g.moveTo(q[0], q[1]);
          on = true;
        }
        g.stroke();
      };
      // 行星轨道:离母星很近时淡掉
      const orbitA = smooth(Math.log(Math.hypot(E[0], E[1], E[2]) * 0.004), Math.log(Math.hypot(E[0], E[1], E[2]) * 0.08), Math.log(v.dist));
      if (orbitA > 0.01)
        for (const [i, p] of sys.planets.entries()) {
          const b = p.a * Math.sqrt(1 - p.e * p.e);
          const pts: V3[] = [];
          for (let k = 0; k <= 200; k++) {
            const Ek = (k / 200) * Math.PI * 2;
            pts.push(add(host, mul(orbitToEcliptic(p.a * (Math.cos(Ek) - p.e), b * Math.sin(Ek), p) as V3, AU_KM)));
          }
          line3(pts, i === sys.home ? `rgba(120,180,255,${0.55 * orbitA})` : `rgba(255,255,255,${0.16 * orbitA})`, i === sys.home ? 1.2 : 1, false);
        }
      if (GL && orbitA > 0.01) GL.beltPersp(cam, sub(eye, host), beltData, t, AU_KM, sys.frost, 0.9 * orbitA);
      else if (belt.length && orbitA > 0.01) {
        g.fillStyle = `rgba(200,190,170,${0.55 * orbitA})`;
        for (const q of belt) {
          const th = q.th + (t / q.P) * Math.PI * 2;
          const s = P(add(host, [q.a * Math.cos(th) * AU_KM, q.a * Math.sin(th) * AU_KM, q.z * AU_KM]));
          if (s) g.fillRect(s[0], s[1], 1, 1);
        }
      }
      // 双星:两颗各自绕质心的轨道、质心小十字
      if (sys.companion) {
        const c2 = sys.companion;
        const qm = c2.mass / (sys.star.mass + c2.mass);
        const rel = (E: number): V3 => [c2.sep * (Math.cos(E) - c2.e) * AU_KM, c2.sep * Math.sqrt(1 - c2.e * c2.e) * Math.sin(E) * AU_KM, 0];
        const pa: V3[] = [], pb: V3[] = [];
        for (let k = 0; k <= 240; k++) {
          const r = rel((k / 240) * Math.PI * 2);
          pa.push(mul(r, -qm));
          pb.push(mul(r, 1 - qm));
        }
        line3(pa, 'rgba(255,220,170,0.35)', 1, false);
        line3(pb, 'rgba(255,220,170,0.35)', 1, false);
        const bc = P([0, 0, 0]);
        if (bc) {
          g.strokeStyle = 'rgba(255,255,255,0.45)';
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(bc[0] - 4, bc[1]);
          g.lineTo(bc[0] + 4, bc[1]);
          g.moveTo(bc[0], bc[1] - 4);
          g.lineTo(bc[0], bc[1] + 4);
          g.stroke();
        }
      }
      // 月亮轨道
      {
        const i = LUNA.incl * RAD;
        const pts: V3[] = [];
        for (let k = 0; k <= 160; k++) {
          const a = (k / 160) * Math.PI * 2;
          pts.push([E[0] + LUNA.a * Math.cos(a), E[1] + LUNA.a * Math.sin(a) * Math.cos(i), E[2] + LUNA.a * Math.sin(a) * Math.sin(i)]);
        }
        const la = 1 - smooth(Math.log(LUNA.a * 30), Math.log(LUNA.a * 200), Math.log(v.dist));
        if (la > 0.01) line3(pts, `rgba(200,200,210,${0.28 * la})`, 1);
      }

      const sum = (b: ColonyBody) => {
        const list = cols.filter((c) => c.body === b && c.founded <= t);
        return list.length ? `${list.length} 处殖民地 · ${headText(list.reduce((a, c) => a + colonyPop(c, t), 0)).replace(/^约 /, '共约 ')}` : '';
      };

      // ---- 星体:由远到近画 ----
      type Body = { d: number; draw: () => void };
      const bodies: Body[] = [];
      const sphere = (C: V3, Rk: number, tx: Tex, M: [V3, V3, V3], sun: V3, amb: number, atmo?: Atmo) => {
        const rel = R(C);
        if (GL) {
          GL.sphere(cam, rel, Rk, tx, M, sun, amb, atmo);
          return sphereScreen(cam, rel, Rk);
        }
        return drawSphereP(g, cam, rel, Rk, tx, (n) => [dot(M[0], n), dot(M[1], n), dot(M[2], n)], sun, amb, atmo);
      };
      /** 太小(不到一两像素)的画个点,好看见、好点 */
      const dot2 = (C: V3, col: [number, number, number], minR: number) => {
        const q = P(C);
        if (!q) return null;
        g.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
        g.beginPath();
        g.arc(q[0], q[1], minR, 0, Math.PI * 2);
        g.fill();
        return { x: q[0], y: q[1], r: minR };
      };
      for (const [i, p] of sys.planets.entries()) {
        const isHome = i === sys.home;
        const C = pos[i];
        const sun = norm(sub(starPos, C));
        bodies.push({
          d: Math.hypot(...R(C)),
          draw: () => {
            let scr: { x: number; y: number; r: number } | null;
            if (isHome) {
              const inv = homeSpinInv(sys, tSpin);
              const M: [V3, V3, V3] = [inv([1, 0, 0]), inv([0, 1, 0]), inv([0, 0, 1])];
              // inv 把黄道方向换成星体坐标:三行 = 对 x、y、z 各取一个分量
              const rows: [V3, V3, V3] = [
                [M[0][0], M[1][0], M[2][0]],
                [M[0][1], M[1][1], M[2][1]],
                [M[0][2], M[1][2], M[2][2]],
              ];
              scr = tex ? sphere(C, HOME_RADIUS, tex, rows, sun, flat + (1 - flat) * 0.04, { color: [130, 180, 255], strength: 0.55 * (1 - flat) }) : sphereScreen(cam, R(C), HOME_RADIUS);
            } else {
              const fr = frames[i];
              const spin = ((fast ? Math.floor(t) : t) * 365.25 * 2 * Math.PI) / 1.5;
              scr = sphere(C, p.radius, planetTexture(seed, p, null, f.k === 'planet' && f.i === i).tex, spinRows(fr, spin), sun, 0.04, atmoOf(p));
              if (p.ringed && scr && scr.r > 1.5) {
                const rel = R(C);
                if (GL) GL.ring(cam, rel, p.radius, ringOf(seed, p), fr.ax, fr.eq1, fr.eq2, sun);
                else drawRingP(g, cam, rel, p.radius, ringOf(seed, p), fr.ax, fr.eq1, fr.eq2, sun);
              }
              // 大卫星(行星在屏上够大时)
              if (scr && scr.r > 3) {
                majorOf(p).forEach((m, idx) => {
                  const a = (((fast ? Math.floor(t) : t) * 365.25) / moonPeriodDays(p, m)) * 2 * Math.PI + idx * 2.1;
                  const km = p.radius * m.dist;
                  const mp = add(C, add(mul(fr.eq1, km * Math.cos(a)), mul(fr.eq2, km * Math.sin(a))));
                  const ms = sphere(mp, m.radius, moonTexture(seed, p, m, idx, false), spinRows(fr, a), norm(sub(starPos, mp)), 0.04);
                  if (ms && ms.r > 4) labels.push({ t: `${S.names[i]}的卫星 ${idx + 1}`, x: ms.x, y: ms.y - ms.r - 8, c: 'rgba(220,220,230,0.8)', size: 10 });
                });
              }
            }
            const minR = isHome ? 2.6 : p.kind === 'gas' ? 3.5 : p.kind === 'ice' ? 3 : p.kind === 'super' ? 2.6 : p.kind === 'dwarf' ? 1.6 : 2.2;
            if (!scr || scr.r < minR) scr = dot2(C, isHome ? [120, 170, 240] : p.color, minR) ?? scr;
            if (!scr) return;
            const name = isHome ? '母星' : S.names[i];
            const extra = i === S.target ? sum('mars') : '';
            if (scr.r < Math.min(w, h) * 0.45) labels.push({ t: extra ? `${name}  ${extra}` : name, x: scr.x, y: scr.y - scr.r - 10, c: isHome ? '#bcd8ff' : '#e6e6e6', size: 12 });
            const homeNote = isHome ? `,绕一圈 ${Math.round(sys.yearDays)} 天,自转轴倾斜 ${sys.tilt.toFixed(1)}°,收到的辐射是地球的 ${sys.flux.toFixed(2)} 倍` : `,平衡温度约 ${p.teq}°C`;
            picks.current.push({
              x: scr.x,
              y: scr.y,
              r: scr.r + 6,
              focus: isHome ? { k: 'home' } : { k: 'planet', i },
              text: `${name}:${KIND_NAME[p.kind]},距恒星 ${p.a.toFixed(2)} 天文单位,公转 ${p.period < 1 ? `${Math.round(p.period * 365.25)} 天` : `${p.period.toFixed(2)} 年`}${p.e > 0.15 ? `(偏心率 ${p.e.toFixed(2)})` : ''}${isHome ? '' : `,轨道倾角 ${p.incl.toFixed(1)}°`}${homeNote},半径 ${Math.round(p.radius)} 公里,${p.moons} 颗卫星${extra ? `;${extra}` : ''}`,
            });
          },
        });
      }
      // 月亮:潮汐锁定 —— 星体 x 轴(月面经度 0)朝母星,z 轴 = 月亮轨道的法线
      bodies.push({
        d: Math.hypot(...R(moonPos)),
        draw: () => {
          const i = LUNA.incl * RAD;
          const xb = norm([-lm[0], -lm[1], -lm[2]]);
          const zb = norm([0, -Math.sin(i), Math.cos(i)]);
          const yb = norm(cross(zb, xb));
          let ms = sphere(moonPos, LUNA.radius, ltexRef.current, [xb, yb, zb], norm(sub(starPos, moonPos)), 0.04);
          if (!ms || ms.r < 1.6) ms = dot2(moonPos, [200, 200, 200], 1.6) ?? ms;
          if (!ms) return;
          // 离得太远(和母星挤成一个点)不写字、不让点
          const hs = sphereScreen(cam, R(E), HOME_RADIUS);
          if (hs && Math.hypot(hs.x - ms.x, hs.y - ms.y) < 8) return;
          const ms2 = sum('moon');
          if (ms.r < Math.min(w, h) * 0.45) labels.push({ t: ms2 ? `月球  ${ms2}` : '月球', x: ms.x, y: ms.y - ms.r - 9, c: '#dddddd', size: 11 });
          picks.current.push({ x: ms.x, y: ms.y, r: ms.r + 6, focus: { k: 'moon' }, text: `月球:半径 1737 公里,轨道 38.4 万公里,27.3 天一圈,潮汐锁定(正面永远朝着母星)${ms2 ? `;${ms2}` : ''}` });
        },
      });
      bodies.sort((a, b) => b.d - a.d);
      for (const b of bodies) b.draw();
      if (sys.belt) {
        const s = P(add(host, [((sys.belt.inner + sys.belt.outer) / 2) * AU_KM, 0, 0]));
        const bs = sum('belt');
        if (s && orbitA > 0.3) labels.push({ t: `${S.beltName ?? '小行星带'}${bs ? `  ${bs}` : ''}`, x: s[0], y: s[1] + 14, c: 'rgba(230,220,200,0.85)', size: 11 });
      }

      // ---- 同步轨道环、太空电梯(母星赤道上,跟着自转)----
      if (v.dist < 3e6) {
        const spin = homeSpin(sys, tSpin);
        const eq = (lonDeg: number, rr: number): V3 => {
          const a = lonDeg * RAD;
          return add(E, mul(spin([Math.cos(a), Math.sin(a), 0]), rr));
        };
        const geo = 42164;
        if (ring && t >= ring.start) {
          const pts: V3[] = [];
          for (let k = 0; k <= 240; k++) pts.push(eq(k * 1.5, geo));
          line3(pts, t >= ring.end ? 'rgba(185,235,255,0.85)' : 'rgba(255,205,130,0.75)', 1.4);
        }
        // 第六十六轮:凯斯勒碎片壳(轨道封锁期间,越清理越稀)
        const dd = debrisDensity(debrisBlocks, t);
        if (dd > 0) {
          const nowS = performance.now() / 1000;
          const n = Math.floor(DEBRIS_N * Math.pow(dd, 0.6));
          for (let i = 0; i < n; i++) {
            const dp = debrisPoint(i, nowS);
            const lo = (dp.lon * Math.PI) / 180,
              la = (dp.lat * Math.PI) / 180;
            const pt = add(E, mul(spin([Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]), HOME_RADIUS * (1 + dp.h)));
            const q = P(pt);
            if (!q || occluded(cam, R(pt), balls)) continue;
            g.fillStyle = `rgba(${i % 5 === 0 ? '255,214,170' : '226,230,236'},${(0.3 + 0.5 * dd) * (0.55 + 0.45 * Math.sin(nowS * (2 + (i % 7)) + i))})`;
            g.fillRect(q[0] - 0.6, q[1] - 0.6, 1.2, 1.2);
          }
        }
        spaceTowers(civ).forEach((tw, k) => {
          if (t < tw.start || towerSevered((civ.history ?? civ).annals, tw.region, t)) return;
          const prog = Math.min(1, (t - tw.start) / Math.max(1, tw.build));
          const pts: V3[] = [];
          for (let j = 0; j <= 24; j++) pts.push(eq(towerLons[k], HOME_RADIUS * 1.002 + (geo - HOME_RADIUS) * prog * (j / 24)));
          line3(pts, 'rgba(200,240,255,0.8)', 1);
        });
      }

      // ---- 字 ----
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const boxes: [number, number, number, number][] = [];
      for (const L of labels) {
        g.font = `${L.size}px sans-serif`;
        const tw = g.measureText(L.t).width / 2 + 2, th = L.size / 2 + 1;
        if (L.x < -80 || L.x > w + 80 || L.y < -20 || L.y > h + 20) continue;
        if (boxes.some(([a, b, c2, d]) => L.x - tw < c2 && L.x + tw > a && L.y - th < d && L.y + th > b)) continue;
        boxes.push([L.x - tw, L.y - th, L.x + tw, L.y + th]);
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(L.t, L.x, L.y);
        g.fillStyle = L.c;
        g.fillText(L.t, L.x, L.y);
      }
      // 镜头离盯住的星体多远
      const dd = Math.hypot(...sub(eye, fPos)) - fR;
      g.fillStyle = 'rgba(200,210,230,0.8)';
      g.font = '12px sans-serif';
      g.textAlign = 'left';
      const dText = dd >= AU_KM * 0.05 ? `${(dd / AU_KM).toFixed(2)} 天文单位` : dd >= 1e4 ? `${Math.round(dd / 1e4).toLocaleString()} 万公里` : `${Math.round(dd).toLocaleString()} 公里`;
      g.fillText(`镜头离${f.k === 'home' ? '母星' : f.k === 'moon' ? '月球' : f.k === 'star' ? '太阳' : S.names[f.i]}地面约 ${dText}`, 16, h - 122);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [civ, sys, S, home, tex, belt, entry, cols, ring, towerLons, frames, seed, outer, beltData, skyData]);

  // 进来时时间轴在按历史档放:换成天文档
  useEffect(() => {
    const a = getAstro();
    // 天文档的默认 = 1 天/秒(按这个世界一年几天换算);进来时在按历史档放,也换成它
    const known = ASTRO_STEPS.some((st) => st.days !== null && a !== null && Math.abs(a - st.days / 365.25) < 1e-9);
    if ((a !== null && !known) || (getCivTime().playing && a === null)) setAstro(1 / 365.25);
  }, []);

  const t = ct.year ?? civ.endYear;
  const day = Math.floor((t - Math.floor(t)) * 365.25) + 1;
  /** 母星绕了几圈(本地年) */
  const orbits = Math.floor(t / home.period);
  return (
    <div
      ref={box}
      className="moon-view sys-view"
      style={{ background: '#03040a' }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setFocus({ k: 'home' });
      }}
    >
      <canvas ref={glCv} aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      <canvas
        ref={cv}
        className="moon-cv"
        style={{ position: 'relative', width: '100%', height: '100%' }}
        onWheel={(e) => {
          const v = view.current;
          const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
          const next = v.distT * Math.exp(dy * 0.0015);
          // 盯着母星推回到进来时那么近 = 回到地球仪
          if (v.focus.k === 'home' && dy < 0 && next < v.d0 * 1.001) return exitSystemView();
          v.distT = Math.max(lim.current.dMin, Math.min(lim.current.dMax, next));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, yaw: view.current.yaw, pitch: view.current.pitch, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) {
            if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
            if (d.moved) {
              view.current.yaw = d.yaw - (e.clientX - d.x) * 0.006;
              view.current.pitch = Math.max(-1.5, Math.min(1.5, d.pitch + (e.clientY - d.y) * 0.006));
            }
          }
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left, y = e.clientY - r.top;
          const hit = picks.current.filter((p) => Math.hypot(p.x - x, p.y - y) <= p.r).sort((a, b) => a.r - b.r)[0];
          setHover(hit?.text ?? '');
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          // 点到星体 = 镜头飞过去盯住它
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left, y = e.clientY - r.top;
          const hit = picks.current.filter((p) => Math.hypot(p.x - x, p.y - y) <= p.r).sort((a, b) => a.r - b.r)[0];
          if (hit) setFocus(hit.focus);
        }}
        onPointerLeave={() => setHover('')}
      />
      <div className="moon-card glass">
        <div className="moon-title">
          <strong>恒星系</strong>
          <span className="sp-note">
            {sys.star.label}
            {sys.companion ? ` + ${sys.companion.label}` : ''} · 第 {Math.floor(t)} 年第 {day} 天 · 本地第 {orbits} 圈
          </span>
          {focus.k === 'moon' && (
            <button
              type="button"
              className="sp-link"
              onClick={() => {
                exitSystemView();
                setMoonView(true);
              }}
            >
              月面图
            </button>
          )}
          {focus.k !== 'home' && (
            <button type="button" className="sp-link" onClick={() => setFocus({ k: 'home' })}>
              回到母星
            </button>
          )}
          <button type="button" className="sp-link" onClick={exitSystemView}>
            回到星球
          </button>
        </div>
        <div className="sys-speed" role="radiogroup" aria-label="播放速度">
          <button type="button" className="moon-btn" onClick={() => setCivTime({ playing: !ct.playing, story: false, scrubbing: false })}>
            {ct.playing ? '暂停' : '播放'}
          </button>
          {ASTRO_STEPS.map((st) => {
            const rate = st.days === null ? null : st.days / 365.25;
            const on = rate === null ? astro === null : astro !== null && Math.abs(astro - rate) < 1e-9;
            return (
              <button key={st.name} type="button" role="radio" aria-checked={on} className={`sys-step${on ? ' on' : ''}`} onClick={() => setAstro(rate)}>
                {st.name}
              </button>
            );
          })}
        </div>
        <div className="sp-note">{hover || `${S.names.length - 1} 颗行星(不算母星)${sys.belts.length ? `、${sys.belts.length} 条小行星带` : ''};拖动转动,滚轮推拉,点星体飞过去,双击回到母星;盯着母星推近回到地球仪`}</div>
        <div className="sp-note">殖民目标:{bodyName(civ, 'mars')}</div>
      </div>
    </div>
  );
}

const getAstro = () => getSpaceUi().astro;

