/**
 * 本地分支 modern-pace:新建世界的第一步「恒星系」(Studio.tsx;随机生成才有)。
 *   中间  SystemOrrery:俯视略斜的示意图(距离按平方根压缩,不然内侧的挤成一团),恒星、各行星的轨道和行星慢慢转(一年约 6 秒)、小行星带、母星标蓝。
 *         还没有文明,行星没有名字:按顺序编号"行星 I(岩质)";推出历史以后由最早那个民族起名(story/systemText.ts)
 *   左边  SystemSettings:恒星(光谱型、质量、光度)、母星离恒星多远(拖 = 改世界的气温参数:远 = 冷;gen/system.ts 的 fluxOfTemp)、
 *         一年几天、自转轴倾角、几颗行星、有没有小行星带。种子和地图同一个(换一颗 = 恒星系、星球一起换)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldParams } from '../../gen/world';
import {
  ARCH_NAME,
  KIND_NAME,
  STAR_CLASSES,
  generateSystem,
  homeDistance,
  promoteToHome,
  habitability,
  massOf,
  newPlanetSpec,
  orbitToEcliptic,
  planetAt,
  randomSpec,
  specWarnings,
  starsAt,
  type PlanetSpec,
  type StarClass,
  type StarSpec,
  type StarSystem,
  type SystemSpec,
} from '../../gen/system';
import { setSystemSpec, useEdits } from '../editsStore';
import { moonKind, moonTexture, planetTexture, prefetchSystem, ringOf, skyTexture } from './planetTex';
import { FOV, drawRingP, drawSphereP, drawStarP, makeCam, occluded, project, sphereScreen, v3, type Atmo } from './persp';
import { beltParticles, createPerspGL, skyParticles, type PerspGL } from './perspGL';
import { majorOf, obliquityOf } from './bodyFrame';

type V3 = [number, number, number];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm3 = (a: V3): V3 => {
  const L = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / L, a[1] / L, a[2] / L];
};

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** 还没有名字时的叫法:"行星 III(岩质)";第一步还没选母星,按种子长的那颗也只是"行星 N(类地行星)" */
export function catalogName(sys: StarSystem, i: number): string {
  const p = sys.planets[i];
  return `行星 ${ROMAN[i] ?? i + 1}(${p.kind === 'home' ? '类地行星' : KIND_NAME[p.kind]})`;
}

/** 示意图的快慢:母星几秒一圈(0 = 暂停) */
const SPEEDS = { 暂停: 0, 慢: 60, 中: 20, 快: 8 } as const;

export function SystemOrrery({ params, left, right = 0, onHome, onPickHome }: { params: WorldParams; left: number; right?: number; onHome?: () => void; onPickHome?: (key: number) => void }) {
  const spec = useEdits().system;
  const sys = useMemo(() => generateSystem(params.seed, params.temperature, spec), [params.seed, params.temperature, spec]);
  const cv = useRef<HTMLCanvasElement>(null);
  /** 第四十七轮:显卡画布(垫在 2D 画布下面;行星系统的星体、环、恒星画在这里)和渲染器(undefined = 还没建;null = 显卡不行,用 CPU) */
  const glCv = useRef<HTMLCanvasElement>(null);
  const glR = useRef<PerspGL | null | undefined>(undefined);
  // 镜头:偏航(绕恒星转)、俯仰(俯视 90°,贴着黄道面 ≈ 0°)、缩放;2D = 俯视、只能左右转
  const PITCH3D = 0.58;
  const cam = useRef({
    yaw: 0,
    pitch: PITCH3D,
    zoom: 1,
    /** 缩放的目标(每帧往它平滑地靠) */
    zt: 1,
    t: 0,
    last: performance.now(),
    off: { x: 0, y: 0 },
    /** 已经放到最大还往里滚:滚了多少(示意图里到 300 进行星系统;宜居行星贴到表面再滚到 600 = 选它当母星) */
    over: 0,
    /** 示意图 / 行星系统(真实比例);行星系统的比例尺(像素 / 公里)现在、目标,刚好装下卫星的、贴到表面的 */
    level: 'system' as 'system' | 'planet',
    sp: 1,
    spt: 1,
    sFit: 1,
    sMax: 1,
    /** 换了聚焦对象那一刻的平移量、时刻(0.4 秒里从它挪到新位置,之后精确钉住) */
    fFrom: { x: 0, y: 0 },
    fT0: 0,
    picks: [] as { key: number; moon?: number; x: number; y: number; r: number }[],
    /** 第五十二轮:示意图的镜头对着的点(压缩坐标)、换对象时从哪挪过来、哪一刻、上一帧盯的是谁 */
    tgt: [0, 0, 0] as V3,
    tFrom: [0, 0, 0] as V3,
    tT0: 0,
    tSel: null as number | null,
    /** 行星系统里镜头对着的点(行星坐标,公里):行星 = 原点,聚焦卫星 = 那颗卫星;换对象时 0.4 秒从 mFrom 挪过去 */
    mf: [0, 0, 0] as V3,
    mFrom: [0, 0, 0] as V3,
    mT0: 0,
    mIdx: null as number | null,
    /** 第四十六轮:行星系统的透视相机 —— 绕目标转的角度(在目标的框架里)、距离(公里,现在 / 目标)、远近的上下限;
     *  盯的是什么(p = 行星,m0… = 卫星;'' = 刚进来);镜头位置(换对象时从上一个位置挪过去) */
    pyaw: 1.6,
    ppitch: 0.3,
    pdist: 1,
    pdistT: 1,
    pdMin: 1,
    pdMax: 1,
    pMode: '',
    pT0: 0,
    pEye: null as V3 | null,
    pTgt: null as V3 | null,
    pFromEye: null as V3 | null,
    pFromTgt: null as V3 | null,
    drag: null as null | { x: number; y: number; yaw: number; pitch: number; pyaw: number; ppitch: number; moved: boolean },
  });
  useEffect(() => {
    const rank = (p: (typeof sys.planets)[number]) => (p.habitable ? 0 : p.kind === 'rocky' || p.kind === 'super' ? 1 : 2);
    prefetchSystem(params.seed, [...sys.planets].sort((a, b) => rank(a) - rank(b)), params);
  }, [sys, params]);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const onPickRef = useRef(onPickHome);
  onPickRef.current = onPickHome;
  /** 选中 / 聚焦的行星(键;null = 全图) */
  // 父组件每次重画都给一个新的 onHome:画图循环里从 ref 取,别因为它重启循环
  const onHomeRef = useRef(onHome);
  onHomeRef.current = onHome;
  const [sel, setSel] = useState<number | null>(null);
  /** 行星系统里点中的卫星(第几颗;null = 看行星) */
  const [moonSel, setMoonSel] = useState<number | null>(null);
  const moonRef = useRef(moonSel);
  moonRef.current = moonSel;
  useEffect(() => setMoonSel(null), [sel]);
  const selRef = useRef(sel);
  selRef.current = sel;
  const [speed, setSpeed] = useState<keyof typeof SPEEDS>('慢');
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [mode, setMode] = useState<'3d' | '2d'>('3d');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const home = sys.planets[sys.home];
    // 小行星带的点:正经的随机数(之前用的散列有相关,画出来一簇一簇的短划)
    let sd = 0x9e3779b9;
    const rnd = () => {
      sd = (sd + 0x6d2b79f5) >>> 0;
      let q = sd;
      q = Math.imul(q ^ (q >>> 15), q | 1);
      q ^= q + Math.imul(q ^ (q >>> 7), q | 61);
      return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
    };
    const belt = sys.belts.flatMap((b) =>
      Array.from({ length: Math.round(b.count / 2) }, () => {
        const a = b.inner + (b.outer - b.inner) * rnd();
        return { a, th: rnd() * Math.PI * 2, P: Math.pow(a / home.a, 1.5), z: (rnd() - 0.5) * 0.05 * a };
      }),
    );
    // 第五十轮:粒子 —— 小行星带每条约 count × 20 颗(周期按母星转几圈算,和示意图的时钟 t 同一种单位)、星空 + 银河
    const beltData = beltParticles(sys.belts, params.seed, 20, (a) => Math.pow(a / home.a, 1.5));
    const skyData = skyParticles(params.seed);
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const c = cv.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
        c.width = Math.round(r.width * dpr);
        c.height = Math.round(r.height * dpr);
      }
      const g = c.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, r.width, r.height);
      if (glR.current === undefined && glCv.current) glR.current = createPerspGL(glCv.current);
      const GL = glR.current ?? null;
      GL?.begin(r.width, r.height, dpr);
      const w = r.width, h = r.height;
      // 画布从左边面板的右缘起(不盖住面板),画布里的坐标从 0 起
      const cx = (w - right) / 2, cy = h * 0.47;
      const C = cam.current;
      const pitch = modeRef.current === '2d' ? Math.PI / 2 : C.pitch;
      // 比例尺只框行星和小行星带;远伴星太远就画在边上(箭头指着它)
      const outer = Math.max(sys.planets[sys.planets.length - 1].a, ...sys.belts.map((x) => x.outer));
      C.zoom = Math.exp(Math.log(C.zoom) + (Math.log(C.zt) - Math.log(C.zoom)) * 0.25);
      const K = ((Math.min(w - right - 60, h * 1.6) * 0.46) / Math.sqrt(outer)) * C.zoom;
      const cyaw = Math.cos(C.yaw), syaw = Math.sin(C.yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      // 节奏按母星:默认 60 秒一圈(左上可换慢 / 中 / 快 / 暂停;t = 母星转了几圈,换挡时接着转不跳);
      // 别的行星照真实的快慢比,太快的压到不快于 10 秒一圈(按 60 秒一挡算 = 母星周期的 1/6),免得转成一团
      const now = performance.now();
      const sec = SPEEDS[speedRef.current];
      C.t += sec > 0 ? (now - C.last) / 1000 / sec : 0;
      C.last = now;
      const t = C.t;
      // ---- 第五十二轮:透视相机 ----
      // 位置先按平方根压缩(示意图:内侧的不挤成一团),再用一台普通的透视相机看(视野 40°);
      // 镜头绕着对着的点转:偏航、俯仰(从北往下看 = 俯仰 90°,公转逆时针),距离按缩放定(对着的点上 1 个压缩单位 = K 像素)
      const comp = (x: number, y: number, z: number): V3 => {
        const d = Math.hypot(x, y, z) || 1e-9;
        const k = Math.sqrt(d) / d;
        return [x * k, y * k, z * k];
      };
      const posOf = (p: (typeof sys.planets)[number]) => planetAt({ ...p, period: Math.max(p.period, home.period / 6) }, t * home.period);
      // 聚焦:镜头对着的点在空间里 0.4 秒挪到选中的那颗(先快后慢),之后跟着它转
      const fp = selRef.current === null ? null : (sys.planets.find((p) => p.key === selRef.current) ?? null);
      if (C.tSel !== selRef.current) {
        C.tFrom = C.tgt;
        C.tT0 = performance.now();
        C.tSel = selRef.current;
      }
      const want: V3 = fp ? comp(...(posOf(fp) as [number, number, number])) : [0, 0, 0];
      const bl = Math.min(1, (performance.now() - C.tT0) / 400);
      const e = 1 - (1 - bl) * (1 - bl);
      C.tgt = [C.tFrom[0] + (want[0] - C.tFrom[0]) * e, C.tFrom[1] + (want[1] - C.tFrom[1]) * e, C.tFrom[2] + (want[2] - C.tFrom[2]) * e];
      C.off.x = 0;
      C.off.y = 0;
      const ofoc = h / 2 / Math.tan((40 * Math.PI) / 360);
      const D = ofoc / K;
      const dirE: V3 = [syaw * cp, -cyaw * cp, sp];
      const oeye: V3 = [C.tgt[0] + dirE[0] * D, C.tgt[1] + dirE[1] * D, C.tgt[2] + dirE[2] * D];
      const of: V3 = [-dirE[0], -dirE[1], -dirE[2]];
      const or_: V3 = [cyaw, syaw, 0];
      const ou: V3 = [or_[1] * of[2] - or_[2] * of[1], or_[2] * of[0] - or_[0] * of[2], or_[0] * of[1] - or_[1] * of[0]];
      /** AU(黄道坐标)→ 屏上 [x, y, 离镜头比对着的点近多少(朝外为正)];在镜头后面 = 画到画面外 */
      const proj = (x: number, y: number, z: number, _ox: number, _oy: number): [number, number, number] => {
        void _ox;
        void _oy;
        const X = comp(x, y, z);
        const dx = X[0] - oeye[0], dy = X[1] - oeye[1], dz = X[2] - oeye[2];
        const zc = dx * of[0] + dy * of[1] + dz * of[2];
        if (zc <= D * 0.02) return [-1e5, -1e5, -1e9];
        return [cx + (ofoc * (dx * or_[0] + dy * or_[1] + dz * or_[2])) / zc, cy - (ofoc * (dx * ou[0] + dy * ou[1] + dz * ou[2])) / zc, D - zc];
      };
      /** 近大远小:离镜头的远近换成大小的倍数(对着的点 = 1) */
      const nearK = (depth: number) => Math.max(0.35, Math.min(3, D / Math.max(D * 0.05, D - depth)));
      const ccx = cx, ccy = cy;
      // 星空、小行星带交给显卡(行星系统那一层另画星空)
      if (GL && C.level !== 'planet') {
        const sv = { f: of, r: or_, u: ou, foc: ofoc, cx, cy };
        const st0 = skyTexture(params.seed);
        if (st0) GL.skyTex(sv, st0, 0.4);
        GL.sky(sv, skyData, 1);
        GL.beltComp(sv, oeye, beltData, t, sys.frost, 0.42);
      }
      const P = (x: number, y: number, z = 0) => proj(x, y, z, C.off.x, C.off.y);
      // 选中的行星:装下卫星的比例尺、贴到表面的比例尺(进行星系统时用)
      if (fp) {
        const maxMoon = Math.max(fp.radius * 2.6, ...majorOf(fp).map((m) => fp.radius * m.dist * 1.05));
        C.sFit = (0.36 * h) / maxMoon;
        C.sMax = (0.4 * h) / fp.radius;
      }
      if (C.level === 'planet' && !fp) C.level = 'system';
      if (C.level === 'planet' && fp) {
        // ---- 行星系统 / 表面(第四十六轮:透视相机)----
        // 镜头是空间里的一点,绕着盯住的目标转(C.pyaw / C.ppitch,在"目标的框架"里),滚轮推拉距离(C.pdist → C.pdistT);
        // 看行星:框架跟着行星公转转(太阳方向在画面里固定,只有拖动才变);看卫星:框架跟着卫星公转转(卫星、背景里的行星都不乱转)
        const now2 = performance.now();
        // 卫星公转、行星自转跟着示意图的快慢挡走(C.t = 母星转了几圈;"慢"一圈 60 秒 = 原来的快慢,暂停就全停)
        const secs = C.t * 60;
        // 自转轴倾角(按种子;种子那颗按恒星系里写的):赤道面 = 环、大卫星轨道、条带所在的面
        const [ob, az] = fp.kind === 'home' ? [(sys.spec.home.tilt * Math.PI) / 180, (sys.spec.home.axisLon * Math.PI) / 180] : obliquityOf(params.seed, fp.key);
        const ax: V3 = [Math.sin(ob) * Math.cos(az), Math.sin(ob) * Math.sin(az), Math.cos(ob)];
        const eq1: V3 = norm3([-Math.sin(az), Math.cos(az), 0]);
        const eq2: V3 = [ax[1] * eq1[2] - ax[2] * eq1[1], ax[2] * eq1[0] - ax[0] * eq1[2], ax[0] * eq1[1] - ax[1] * eq1[0]];
        const eqPt = (x: number, y: number): V3 => [x * eq1[0] + y * eq2[0], x * eq1[1] + y * eq2[1], x * eq1[2] + y * eq2[2]];
        const toEq = (q: V3): V3 => [dot3(q, eq1), dot3(q, eq2), dot3(q, ax)];
        const spin = (secs * 2 * Math.PI) / 40;
        const cs = Math.cos(spin), sn = Math.sin(spin);
        // 卫星:各自的轨道(真实比例),按开普勒的快慢比转(最里那颗 8 秒一圈)
        const minD = Math.min(...majorOf(fp).map((m) => m.dist), 99);
        const moonPos = majorOf(fp).map((m, idx) => {
          const per = 8 * Math.pow(m.dist / minD, 1.5);
          const a = (secs / per) * Math.PI * 2 + idx * 2.1;
          const km = fp.radius * m.dist;
          return { m, idx, km, a, p: eqPt(km * Math.cos(a), km * Math.sin(a)) };
        });
        const mSel = moonRef.current !== null && moonRef.current < moonPos.length ? moonRef.current : null;
        const pos = posOf(fp);
        const sunE = norm3([-pos[0], -pos[1], -pos[2]]);
        // ---- 目标、框架、远近 ----
        const zN: V3 = [0, 0, 1];
        let tgt: V3, b1: V3, b2: V3, b3: V3, dMin: number, dFit: number, dMax: number;
        if (mSel !== null) {
          const mo = moonPos[mSel];
          tgt = mo.p;
          b3 = ax;
          b1 = norm3(mo.p);
          b2 = v3.cross(ax, b1);
          dMin = mo.m.radius * 2.6;
          dFit = mo.m.radius * 14;
          dMax = mo.m.radius * 60;
        } else {
          tgt = [0, 0, 0];
          b3 = zN;
          const sh = norm3([sunE[0], sunE[1], 0]);
          b1 = [-sh[0], -sh[1], 0];
          b2 = v3.cross(zN, b1);
          const maxMoon = Math.max(fp.radius * 2.6, ...majorOf(fp).map((m) => fp.radius * m.dist * 1.05));
          dMin = fp.radius * 2.6;
          dFit = maxMoon / Math.sin(FOV / 2) * 1.05;
          dMax = dFit * 2.5;
        }
        C.pdMin = dMin;
        C.pdMax = dMax;
        // 换了盯的对象:角度、远近回到默认,0.6 秒从原来的镜头位置挪过去
        const mode = mSel === null ? 'p' : `m${mSel}`;
        if (C.pMode !== mode) {
          C.pFromEye = C.pEye;
          C.pFromTgt = C.pTgt;
          C.pT0 = now2;
          if (mSel === null) {
            // 镜头偏向恒星那一侧(约四分之三亮着),恒星在画面外、边上的箭头指着它;轨道面斜着看得出形状
            C.pyaw = 2.1;
            C.ppitch = 0.45;
            if (C.pMode === '') C.pdist = dFit * 2.5;
          } else {
            // 从受光的一侧斜着看(太阳在卫星框架里的方向偏 0.6 弧度):卫星大半亮着
            C.pyaw = Math.atan2(v3.dot(sunE, b2), v3.dot(sunE, b1)) + 0.6;
            C.ppitch = 0.25;
          }
          C.pdistT = dFit;
          C.pMode = mode;
        }
        C.pdistT = Math.max(dMin, Math.min(dMax * 1.2, C.pdistT));
        C.pdist = Math.exp(Math.log(C.pdist) + (Math.log(C.pdistT) - Math.log(C.pdist)) * 0.2);
        const cpp = Math.cos(C.ppitch), spp = Math.sin(C.ppitch), cpy = Math.cos(C.pyaw), spy = Math.sin(C.pyaw);
        const dirE: V3 = [cpp * (cpy * b1[0] + spy * b2[0]) + spp * b3[0], cpp * (cpy * b1[1] + spy * b2[1]) + spp * b3[1], cpp * (cpy * b1[2] + spy * b2[2]) + spp * b3[2]];
        let eye: V3 = [tgt[0] + dirE[0] * C.pdist, tgt[1] + dirE[1] * C.pdist, tgt[2] + dirE[2] * C.pdist];
        let look: V3 = tgt;
        const tb = Math.min(1, (now2 - C.pT0) / 600);
        if (tb < 1 && C.pFromEye && C.pFromTgt) {
          const e = 1 - (1 - tb) * (1 - tb);
          const L = (a: V3, b: V3): V3 => [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
          eye = L(C.pFromEye, eye);
          look = L(C.pFromTgt, look);
        }
        C.pEye = eye;
        C.pTgt = look;
        const cam = makeCam(eye, look, b3, cx, cy, w, h);
        const st1 = skyTexture(params.seed);
        if (GL && st1) GL.skyTex(cam, st1, 0.4);
        GL?.sky(cam, skyData, 1);
        const balls = [{ C: [0, 0, 0] as V3, R: fp.radius }, ...moonPos.map((mo) => ({ C: mo.p, R: mo.m.radius }))];
        // ---- 背景:恒星(真实方向;在画面外就在边上画箭头)----
        const sunAng = Math.atan(sys.star.radius / (fp.a * 1.496e8));
        const sunFar: V3 = [eye[0] + sunE[0] * 1e12, eye[1] + sunE[1] * 1e12, eye[2] + sunE[2] * 1e12];
        drawStarP(g, cam, sunE, sunAng, sys.star.color, '恒星', GL ? { star: (x, y, r0, gr) => GL.star(cam, x, y, r0, gr, sys.star.color), hidden: occluded(cam, sunFar, balls) } : undefined);
        // ---- 卫星轨道 ----
        g.lineWidth = 1;
        for (const mo of moonPos) {
          g.strokeStyle = 'rgba(200,200,215,0.25)';
          g.beginPath();
          let on = false;
          for (let j = 0; j <= 128; j++) {
            const a = (j / 128) * Math.PI * 2;
            const wp = eqPt(mo.km * Math.cos(a), mo.km * Math.sin(a));
            const q = project(cam, wp);
            // 被星体挡住的段不画(轨道线画在星体上面那一层)
            if (!q || occluded(cam, wp, balls)) {
              on = false;
              continue;
            }
            if (on) g.lineTo(q[0], q[1]);
            else g.moveTo(q[0], q[1]);
            on = true;
          }
          g.stroke();
        }
        // ---- 星体:由远到近画(行星连着它的环)----
        const picks: typeof C.picks = [];
        const dist = (p: V3) => Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]);
        const pt = planetTexture(params.seed, fp, paramsRef.current);
        // 有大气的:气态 / 冰巨星 / 迷你海王星按自己的颜色,宜居的偏蓝,别的岩质很淡
        const atmoOf = (): Atmo | undefined => {
          if (fp.kind === 'gas' || fp.kind === 'ice' || fp.kind === 'mini') return { color: [Math.min(255, fp.color[0] + 50), Math.min(255, fp.color[1] + 50), Math.min(255, fp.color[2] + 60)], strength: 0.35 };
          if (fp.habitable || fp.kind === 'home') return { color: [130, 180, 255], strength: 0.55 };
          if ((fp.kind === 'rocky' || fp.kind === 'super') && fp.radius >= 0.35 * 6371 && fp.teq <= 200) return { color: [215, 200, 180], strength: 0.2 };
          return undefined;
        };
        let pScr: { x: number; y: number; r: number } | null = null;
        const drawPlanet = () => {
          if (GL) {
            // 星体坐标 = M × 法线:先换到赤道坐标,再按自转转
            const M: [V3, V3, V3] = [
              [cs * eq1[0] + sn * eq2[0], cs * eq1[1] + sn * eq2[1], cs * eq1[2] + sn * eq2[2]],
              [-sn * eq1[0] + cs * eq2[0], -sn * eq1[1] + cs * eq2[1], -sn * eq1[2] + cs * eq2[2]],
              ax,
            ];
            GL.sphere(cam, [0, 0, 0], fp.radius, pt.tex, M, sunE, 0.04, atmoOf());
            if (fp.ringed) GL.ring(cam, [0, 0, 0], fp.radius, ringOf(params.seed, fp), ax, eq1, eq2, sunE);
            pScr = sphereScreen(cam, [0, 0, 0], fp.radius);
            return;
          }
          pScr = drawSphereP(g, cam, [0, 0, 0], fp.radius, pt.tex, (n) => {
            const e2 = toEq(n);
            return [e2[0] * cs + e2[1] * sn, -e2[0] * sn + e2[1] * cs, e2[2]];
          }, sunE, 0.04, atmoOf());
          if (fp.ringed) drawRingP(g, cam, [0, 0, 0], fp.radius, ringOf(params.seed, fp), ax, eq1, eq2, sunE);
        };
        const drawMoon = (mo: (typeof moonPos)[number]) => {
          // 潮汐锁定:跟着公转转,同一面一直朝着行星
          const ca = Math.cos(mo.a), sa = Math.sin(mo.a);
          const mtex = moonTexture(params.seed, fp, mo.m, mo.idx, mo.idx === mSel);
          let s: { x: number; y: number; r: number } | null;
          if (GL) {
            const M: [V3, V3, V3] = [
              [ca * eq1[0] + sa * eq2[0], ca * eq1[1] + sa * eq2[1], ca * eq1[2] + sa * eq2[2]],
              [-sa * eq1[0] + ca * eq2[0], -sa * eq1[1] + ca * eq2[1], -sa * eq1[2] + ca * eq2[2]],
              ax,
            ];
            GL.sphere(cam, mo.p, mo.m.radius, mtex, M, sunE, 0.04);
            s = sphereScreen(cam, mo.p, mo.m.radius);
          } else
            s = drawSphereP(g, cam, mo.p, mo.m.radius, mtex, (n) => {
              const e3 = toEq(n);
              return [e3[0] * ca + e3[1] * sa, -e3[0] * sa + e3[1] * ca, e3[2]];
            }, sunE, 0.04);
          if (!s) return;
          const mr = Math.max(2, s.r);
          picks.push({ key: fp.key, moon: mo.idx, x: s.x, y: s.y, r: Math.max(10, mr + 6) });
          if (mo.idx === mSel && mr < Math.min(w, h) * 0.45) {
            g.strokeStyle = 'rgba(255,255,255,0.9)';
            g.lineWidth = 1.5;
            g.setLineDash([3, 3]);
            g.beginPath();
            g.arc(s.x, s.y, mr + 6, 0, Math.PI * 2);
            g.stroke();
            g.setLineDash([]);
          }
          if (mr < Math.min(w, h) * 0.45) {
            g.font = '11px sans-serif';
            g.textAlign = 'center';
            g.lineWidth = 3;
            g.strokeStyle = 'rgba(0,0,0,0.8)';
            g.strokeText(`卫星 ${mo.idx + 1}`, s.x, s.y - mr - 7);
            g.fillStyle = 'rgba(220,220,230,0.85)';
            g.fillText(`卫星 ${mo.idx + 1}`, s.x, s.y - mr - 7);
          }
        };
        const bodies: { d: number; draw: () => void }[] = [{ d: dist([0, 0, 0]), draw: drawPlanet }, ...moonPos.map((mo) => ({ d: dist(mo.p), draw: () => drawMoon(mo) }))];
        bodies.sort((a, b) => b.d - a.d);
        for (const bo of bodies) bo.draw();
        const ps = pScr as { x: number; y: number; r: number } | null;
        // 卫星排在前面(小的先认);行星最后
        C.picks = ps ? [...picks, { key: fp.key, x: ps.x, y: ps.y, r: ps.r + 8 }] : picks;
        (window as unknown as { __orreryPicks?: typeof C.picks }).__orreryPicks = C.picks;
        const nm = catalogName(sys, sys.planets.indexOf(fp));
        if (ps && ps.r < Math.min(w, h) * 0.45 && mSel === null) {
          g.font = '13px sans-serif';
          g.textAlign = 'center';
          g.lineWidth = 3;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.strokeText(nm, ps.x, ps.y - ps.r - 14);
          g.fillStyle = '#eef2f8';
          g.fillText(nm, ps.x, ps.y - ps.r - 14);
        }
        g.font = '12px sans-serif';
        g.textAlign = 'center';
        g.fillStyle = 'rgba(200,210,230,0.55)';
        g.fillText(mSel !== null ? '卫星:潮汐锁定,同一面一直朝着行星;拖动绕着它转;点行星或往外滚回到行星' : '行星系统:真实比例、透视;拖动绕着转;点卫星看它;往外滚回到恒星系', cx, h - 24);
        if (mSel !== null) {
          // 看卫星时不提示行星的事
        } else if (!pt.hd) {
          g.font = '13px sans-serif';
          g.fillStyle = 'rgba(200,220,255,0.85)';
          g.fillText('正在生成这颗行星的高清地表…', cx, h - 48);
        } else if (fp.habitable && onPickRef.current && C.pdistT <= C.pdMin * 1.001) {
          g.font = '14px sans-serif';
          g.fillStyle = `rgba(170,240,190,${0.6 + 0.4 * Math.min(1, C.over / 600)})`;
          g.fillText(C.over > 0 ? `继续放大:选它当母星 ${Math.round((C.over / 600) * 100)}%` : '继续放大:选它当母星', cx, h - 48);
        }
        return;
      }
      // 黄道面(= 母星的轨道面)参考网格:3D 时画几圈、几条辐射线,别的轨道斜了看得出来
      if (pitch < Math.PI / 2 - 0.01) {
        g.strokeStyle = 'rgba(120,170,230,0.10)';
        g.lineWidth = 1;
        for (const f of [0.25, 0.5, 0.75, 1]) {
          g.beginPath();
          for (let k = 0; k <= 96; k++) {
            const a = (k / 96) * Math.PI * 2;
            const [x, y] = P(outer * f * Math.cos(a), outer * f * Math.sin(a));
            if (k) g.lineTo(x, y);
            else g.moveTo(x, y);
          }
          g.stroke();
        }
        for (let k = 0; k < 12; k++) {
          const a = (k / 12) * Math.PI * 2;
          const [x0, y0] = P(outer * 0.02 * Math.cos(a), outer * 0.02 * Math.sin(a));
          const [x1, y1] = P(outer * Math.cos(a), outer * Math.sin(a));
          g.beginPath();
          g.moveTo(x0, y0);
          g.lineTo(x1, y1);
          g.stroke();
        }
      }
      // 轨道:按真实的偏心、倾角、升交点画(行星一直在自己那条线上);倾斜明显的画成别的颜色
      for (const [i, p] of sys.planets.entries()) {
        const tilted = p.incl > 8;
        g.strokeStyle = i === sys.home ? 'rgba(120,180,255,0.6)' : tilted ? 'rgba(255,190,120,0.35)' : 'rgba(255,255,255,0.16)';
        g.lineWidth = i === sys.home ? 1.4 : 1;
        g.beginPath();
        const b = p.a * Math.sqrt(1 - p.e * p.e);
        for (let k = 0; k <= 128; k++) {
          const E = (k / 128) * Math.PI * 2;
          const q = orbitToEcliptic(p.a * (Math.cos(E) - p.e), b * Math.sin(E), p);
          const [x, y] = P(q[0], q[1], q[2]);
          if (k) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = 'rgba(210,200,180,0.5)';
      if (!GL) for (const b of belt) {
        const th = b.th + (t / b.P) * Math.PI * 2;
        const [x, y] = P(b.a * Math.cos(th), b.a * Math.sin(th), b.z);
        g.fillRect(x, y, 1, 1);
      }
      // 恒星(双星:P 型两颗挨着互绕,画开一点看得出是两颗;S 型伴星在远处)
      const st = starsAt(sys, t * home.period);
      const star = (x: number, y: number, col: [number, number, number], r0: number) => {
        const [sr, sg, sb] = col;
        const gl = g.createRadialGradient(x, y, 0, x, y, r0 * 5);
        gl.addColorStop(0, `rgba(${sr},${sg},${sb},1)`);
        gl.addColorStop(0.3, `rgba(${sr},${sg},${sb},0.55)`);
        gl.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
        g.fillStyle = gl;
        g.beginPath();
        g.arc(x, y, r0 * 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `rgb(${sr},${sg},${sb})`;
        g.beginPath();
        g.arc(x, y, r0, 0, Math.PI * 2);
        g.fill();
      };
      g.font = '12px sans-serif';
      g.textAlign = 'center';
      // 双星的相对轨道(伴星相对主星):真实间距 sep、偏心率 e;质心在主星→伴星连线上 q = 伴星质量 / 总质量 处
      const bin = sys.companion;
      const relAt = (E: number): [number, number] => (bin ? [bin.sep * (Math.cos(E) - bin.e), bin.sep * Math.sqrt(1 - bin.e * bin.e) * Math.sin(E)] : [0, 0]);
      const qm = bin ? bin.mass / (sys.star.mass + bin.mass) : 0;
      const ring = (f: (E: number) => [number, number], style: string, dash: number[]) => {
        g.strokeStyle = style;
        g.lineWidth = 1;
        g.setLineDash(dash);
        g.beginPath();
        for (let k = 0; k <= 160; k++) {
          const [x, y] = f((k / 160) * Math.PI * 2);
          const [sx, sy] = P(x, y, 0);
          if (k) g.lineTo(sx, sy);
          else g.moveTo(sx, sy);
        }
        g.stroke();
        g.setLineDash([]);
      };
      if (bin && st.companion && bin.mode === 'P') {
        // 近距互绕:两颗各自绕质心(原点)的椭圆,真实位置。
        // 示意图的平方根压缩会把小距离放大(0.18 AU 看着像行星轨道的一半),双星这一小块改成线性:
        // 按最内侧行星处的比例画,双星和最内侧行星的大小比是真的(喂给 P 的距离 d → d² / aRef,压缩后正好 = d · √aRef / aRef)
        const aRef = Math.max(bin.sep * 1.5, Math.min(...sys.planets.map((q) => q.a)));
        const lin = (x: number, y: number): [number, number] => {
          const k = Math.hypot(x, y) / aRef;
          return [x * k, y * k];
        };
        ring((E) => {
          const [x, y] = relAt(E);
          return lin(-x * qm, -y * qm);
        }, 'rgba(255,220,170,0.45)', []);
        ring((E) => {
          const [x, y] = relAt(E);
          return lin(x * (1 - qm), y * (1 - qm));
        }, 'rgba(255,220,170,0.45)', []);
        const [ax, ay] = P(...lin(st.primary[0], st.primary[1]));
        const [bx, by] = P(...lin(st.companion[0], st.companion[1]));
        const [ox, oy] = P(0, 0);
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.beginPath();
        g.moveTo(ox - 3, oy);
        g.lineTo(ox + 3, oy);
        g.moveTo(ox, oy - 3);
        g.lineTo(ox, oy + 3);
        g.stroke();
        star(ax, ay, sys.star.color, 7);
        star(bx, by, bin.color, 4.5);
      } else {
        star(ccx, ccy, sys.star.color, 9);
        if (bin && st.companion) {
          // 远伴星:以主星为中心的相对轨道(示意图里行星绕主星画,所以按主星的框架看伴星)
          ring(relAt, 'rgba(255,220,170,0.3)', [4, 4]);
          const rel: [number, number, number] = [st.companion[0] - st.primary[0], st.companion[1] - st.primary[1], 0];
          const [x, y] = P(rel[0], rel[1], rel[2]);
          const name = `伴星 ${bin.label} · ${Math.round(bin.sep)} 天文单位`;
          const x0 = 40, x1 = w - right - 40, y0 = 40, y1 = h - 60;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) {
            star(x, y, bin.color, 5);
            g.fillStyle = 'rgba(255,230,180,0.85)';
            g.fillText(name, x, y - 14);
          } else {
            const dx = x - ccx, dy = y - ccy;
            const k = Math.min(dx > 0 ? (x1 - ccx) / dx : dx < 0 ? (x0 - ccx) / dx : Infinity, dy > 0 ? (y1 - ccy) / dy : dy < 0 ? (y0 - ccy) / dy : Infinity);
            const ex = ccx + dx * k, ey = ccy + dy * k;
            star(ex, ey, bin.color, 4);
            const ang = Math.atan2(dy, dx);
            g.strokeStyle = 'rgba(255,230,180,0.85)';
            g.lineWidth = 1.5;
            g.beginPath();
            g.moveTo(ex + Math.cos(ang) * 9, ey + Math.sin(ang) * 9);
            g.lineTo(ex + Math.cos(ang) * 18, ey + Math.sin(ang) * 18);
            g.lineTo(ex + Math.cos(ang + 2.6) * 6 + Math.cos(ang) * 18, ey + Math.sin(ang + 2.6) * 6 + Math.sin(ang) * 18);
            g.moveTo(ex + Math.cos(ang) * 18, ey + Math.sin(ang) * 18);
            g.lineTo(ex + Math.cos(ang - 2.6) * 6 + Math.cos(ang) * 18, ey + Math.sin(ang - 2.6) * 6 + Math.sin(ang) * 18);
            g.stroke();
            g.fillStyle = 'rgba(255,230,180,0.9)';
            // 贴着右边的字往左写、贴着左边的往右写,别出画面
            g.textAlign = ex > cx + 40 ? 'right' : ex < cx - 40 ? 'left' : 'center';
            g.fillText(`${name}(在画面外)`, ex + (ex > cx + 40 ? 6 : ex < cx - 40 ? -6 : 0), ey - 14);
            g.textAlign = 'center';
          }
        }
      }
      const items = sys.planets.map((p, i) => {
        const q = posOf(p);
        const [x, y, d] = P(q[0], q[1], q[2]);
        return { p, i, x, y, d };
      });
      C.picks = [];
      // 冒烟检查用:这一帧各行星在屏上哪(和 window.__wfProbe 一类)
      (window as unknown as { __orreryPicks?: typeof C.picks }).__orreryPicks = C.picks;
      // 远的先画、近的后画
      items.sort((a, b) => a.d - b.d);
      for (const { p, i, x, y, d } of items) {
        const R = (p.kind === 'gas' ? 7 : p.kind === 'ice' ? 5.5 : p.kind === 'mini' ? 4.5 : p.kind === 'home' ? 5 : p.kind === 'super' ? 4 : p.kind === 'dwarf' ? 2.2 : 3.5) * Math.min(2, Math.sqrt(C.zoom)) * nearK(d);
        if (p.ringed) {
          // 气态巨行星:宽亮的环;冰巨星 / 迷你海王星:细暗的环
          g.strokeStyle = p.kind === 'gas' ? 'rgba(230,215,180,0.7)' : 'rgba(150,155,165,0.45)';
          g.lineWidth = p.kind === 'gas' ? 1.5 : 0.8;
          g.beginPath();
          g.ellipse(x, y, R * 2, Math.max(0.8, R * 2 * Math.abs(sp)), 0, 0, Math.PI * 2);
          g.stroke();
        }
        const [r0, g0, b0] = p.color;
        g.fillStyle = `rgb(${r0},${g0},${b0})`;
        g.beginPath();
        g.arc(x, y, R, 0, Math.PI * 2);
        g.fill();
        C.picks.push({ key: p.key, x, y, r: R + 8 });
        if (p.key === selRef.current) {
          g.strokeStyle = 'rgba(255,255,255,0.95)';
          g.lineWidth = 1.5;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.arc(x, y, R + 9, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
        }
        const hab = p.habitable;
        if (hab) {
          g.strokeStyle = 'rgba(120,230,150,0.9)';
          g.lineWidth = 1.5;
          g.beginPath();
          g.arc(x, y, R + 4, 0, Math.PI * 2);
          g.stroke();
        }
        const label = hab ? `${catalogName(sys, i)} · 宜居` : catalogName(sys, i);
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(label, x, y - R - 8);
        g.fillStyle = hab ? '#9df0b4' : 'rgba(230,230,230,0.85)';
        g.fillText(label, x, y - R - 8);
      }
      g.fillStyle = 'rgba(200,210,230,0.55)';
      g.textAlign = 'center';
      g.fillText('示意图:距离按平方根压缩,行星大小放大;太快的内侧行星放慢了', cx, h - 24);
      if (fp && C.zoom > 7.5) {
        g.font = '14px sans-serif';
        g.fillStyle = `rgba(190,220,255,${0.6 + 0.4 * Math.min(1, C.over / 300)})`;
        g.fillText('继续放大进入这颗行星的系统', cx, cy + 70);
        g.font = '12px sans-serif';
      }
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [sys, left, right]);
  return (
    <>
      <canvas ref={glCv} className="st-orrery" style={{ left, width: `calc(100% - ${left}px)`, pointerEvents: 'none' }} aria-hidden="true" />
      <canvas
        ref={cv}
        className="st-orrery"
        style={{ left, width: `calc(100% - ${left}px)` }}
        aria-label="恒星系"
        onWheel={(e) => {
          // 按滚了多少成比例缩放(触控板一下来很多小事件,不再每个都跳一大格)
          const C = cam.current;
          const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
          if (C.level === 'planet') {
            const fpk = sys.planets.find((q) => q.key === selRef.current);
            if (moonRef.current === null && fpk && fpk.habitable && C.pdistT <= C.pdMin * 1.001 && dy < 0 && (fpk.kind === 'home' ? onHomeRef.current : onPickRef.current)) {
              C.over += -dy;
              if (C.over > 600) {
                C.over = 0;
                if (fpk.kind === 'home') onHomeRef.current?.();
                else onPickRef.current?.(fpk.key);
              }
              return;
            }
            C.over = 0;
            // 推拉:离得越远一下推得越多(按比例)
            C.pdistT *= Math.exp(dy * 0.0015);
            if (moonRef.current !== null && C.pdistT > C.pdMax) {
              // 看卫星时拉过头:回到行星
              setMoonSel(null);
              return;
            }
            C.pdistT = Math.max(C.pdMin, C.pdistT);
            if (C.pdistT > C.pdMax) {
              C.pMode = '';
              // 缩过头:回到示意图(还聚焦着这颗)
              C.level = 'system';
              C.zt = 6;
              C.zoom = 8;
              C.pitch = Math.max(0.03, Math.min(Math.PI / 2, C.pitch));
            }
            return;
          }
          if (selRef.current !== null && C.zt >= 7.99 && dy < 0) {
            C.over += -dy;
            if (C.over > 300) {
              C.over = 0;
              C.level = 'planet';
              C.pMode = '';
              C.sp = C.sFit * 0.35;
              C.spt = C.sFit;
            }
            return;
          }
          C.over = 0;
          C.zt = Math.max(0.3, Math.min(8, C.zt * Math.exp(-dy * 0.0015)));
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const C = cam.current;
          C.drag = { x: e.clientX, y: e.clientY, yaw: C.yaw, pitch: C.pitch, pyaw: C.pyaw, ppitch: C.ppitch, moved: false };
        }}
        onPointerMove={(e) => {
          const C = cam.current;
          if (!C.drag) return;
          if (Math.abs(e.clientX - C.drag.x) + Math.abs(e.clientY - C.drag.y) > 4) C.drag.moved = true;
          if (!C.drag.moved) return;
          // 行星系统(透视):拖动 = 镜头绕着盯住的目标转(抓着它转的手感);俯仰放开到能看两极
          if (C.level === 'planet') {
            C.pyaw = C.drag.pyaw - (e.clientX - C.drag.x) * 0.006;
            C.ppitch = Math.max(-1.45, Math.min(1.45, C.drag.ppitch + (e.clientY - C.drag.y) * 0.006));
            return;
          }
          C.yaw = C.drag.yaw - (e.clientX - C.drag.x) * 0.006;
          if (modeRef.current === '3d') C.pitch = Math.max(0.03, Math.min(Math.PI / 2, C.drag.pitch + (e.clientY - C.drag.y) * 0.006));
        }}
        onPointerUp={(e) => {
          const C = cam.current;
          const d = C.drag;
          C.drag = null;
          if (!d || d.moved) return;
          // 点:点到行星 = 选中、聚焦、放大一点;点空处 = 回全图
          const r = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - r.left, y = e.clientY - r.top;
          const hit = C.picks.filter((q) => Math.hypot(q.x - x, q.y - y) <= q.r).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0];
          if (C.level === 'planet') {
            if (hit?.moon !== undefined) {
              setMoonSel(hit.moon);
            } else if (hit) setMoonSel(null);
            return;
          }
          C.fFrom = { ...C.off };
          C.fT0 = performance.now();
          if (hit) {
            setSel(hit.key);
            C.zt = Math.max(C.zt, 3);
          } else setSel(null);
        }}
        onDoubleClick={() => {
          const C = cam.current;
          C.fFrom = { ...C.off };
          C.fT0 = performance.now();
          setSel(null);
          Object.assign(C, { yaw: 0, pitch: PITCH3D, zt: 1, level: 'system' });
        }}
      />
      <div className="st-orrery-bar" style={{ left: left + 16 }}>
        <span>拖动旋转 · 滚轮缩放 · 点行星看数据 · 双击回正</span>
        {(Object.keys(SPEEDS) as (keyof typeof SPEEDS)[]).map((k) => (
          <button key={k} type="button" className={`sys-chip${speed === k ? ' on' : ''}`} onClick={() => setSpeed(k)}>
            {k}
          </button>
        ))}
        <span className="sep" />
        {(['2d', '3d'] as const).map((m) => (
          <button key={m} type="button" className={`sys-chip${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      {sel !== null && moonSel !== null && (
        <MoonCard sys={sys} k={sel} idx={moonSel} seed={params.seed} left={left} onClose={() => setMoonSel(null)} />
      )}
      {sel !== null && moonSel === null && (
        <PlanetCard
          sys={sys}
          k={sel}
          left={left}
          onHome={onHome}
          onPickHome={onPickHome}
          onClose={() => {
            const C = cam.current;
            C.fFrom = { ...C.off };
            C.fT0 = performance.now();
            setSel(null);
          }}
        />
      )}
    </>
  );
}

const MOON_KIND: Record<string, string> = {
  old: '老坑地(坑坑洼洼的古老地面)',
  mare: '有月海(古老的熔岩平原)',
  lava: '熔岩世界',
  ice: '冰壳(底下可能有海)',
  plains: '冰原和暗色斑块',
  volcanic: '火山卫星(潮汐加热)',
  haze: '浓厚的雾霭大气',
};
/** 行星的密度(g/cm³,按种类估):算卫星公转周期用 */
const DENSITY: Record<string, number> = { home: 5.5, rocky: 5.5, super: 5.0, dwarf: 2.0, mini: 1.6, ice: 1.6, gas: 1.3 };

/** 点中的卫星:地表、半径、离行星多远、绕一圈几天、潮汐锁定 */
function MoonCard({ sys, k, idx, seed, left, onClose }: { sys: StarSystem; k: number; idx: number; seed: number; left: number; onClose: () => void }) {
  const p = sys.planets.find((q) => q.key === k);
  const m = p ? majorOf(p)[idx] : undefined;
  if (!p || !m) return null;
  const aKm = p.radius * m.dist;
  const M = (4 / 3) * Math.PI * Math.pow(p.radius * 1e3, 3) * (DENSITY[p.kind] ?? 3) * 1e3;
  const days = (2 * Math.PI * Math.sqrt(Math.pow(aKm * 1e3, 3) / (6.674e-11 * M))) / 86400;
  const kind = p.kind === 'home' ? '月海和高地(推演里登月的就是这一颗)' : MOON_KIND[moonKind(seed, p, m, idx)] ?? '';
  const rows: [string, string][] = [
    ['地表', kind],
    ['半径', `${Math.round(m.radius).toLocaleString()} 公里(月球的 ${(m.radius / 1737).toFixed(2)} 倍)`],
    ['离行星', `${Math.round(aKm).toLocaleString()} 公里(行星半径的 ${m.dist.toFixed(1)} 倍)`],
    ['绕一圈', days < 2 ? `${(days * 24).toFixed(1)} 小时` : `${days.toFixed(1)} 天`],
    ['自转', '潮汐锁定,同一面一直朝着行星'],
    ['温度', `约 ${p.teq}°C(和行星差不多)`],
  ];
  return (
    <div className="st-planet-card" style={{ left: left + 16 }}>
      <div className="hd">
        <b>
          {catalogName(sys, sys.planets.indexOf(p))} · 卫星 {idx + 1}
        </b>
        <button type="button" className="sys-chip" onClick={onClose}>
          回到行星
        </button>
      </div>
      <dl>
        {rows.map(([a, b]) => (
          <div key={a}>
            <dt>{a}</dt>
            <dd>{b}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 选中的那颗:种类、离恒星多远、公转、倾角、偏心、半径、平衡温度、卫星 */
function PlanetCard({ sys, k, left, onClose, onHome, onPickHome }: { sys: StarSystem; k: number; left: number; onClose: () => void; onHome?: () => void; onPickHome?: (key: number) => void }) {
  const i = sys.planets.findIndex((p) => p.key === k);
  if (i < 0) return null;
  const p = sys.planets[i];
  const per = p.period < 1 ? `${Math.round(p.period * 365.25)} 天` : `${p.period.toFixed(2)} 年`;
  const rows: [string, string][] = [
    ['种类', p.kind === 'home' ? '类地行星' : KIND_NAME[p.kind]],
    ['离恒星', `${p.a.toFixed(p.a < 1 ? 3 : 2)} 天文单位`],
    ['公转一圈', per],
    ...(p.kind === 'home' ? [] : ([['轨道倾角', `${p.incl.toFixed(1)}°`]] as [string, string][])),
    ['偏心率', p.e.toFixed(2)],
    ['半径', `${Math.round(p.radius).toLocaleString()} 公里(地球的 ${(p.radius / 6371).toFixed(2)} 倍)`],
    ['平衡温度', `${p.teq}°C`],
    ...(p.kind === 'rocky' || p.kind === 'super' || p.kind === 'home'
      ? ([
          ['温室', `+${p.greenhouse}°C`],
          ['地表', `约 ${p.surface}°C${p.habitable ? '(宜居)' : p.surface > 27 ? '(太热)' : p.surface < 3 ? '(太冷)' : p.radius < 0.6 * 6371 ? '(太小,留不住大气)' : '(太大)'}`],
        ] as [string, string][])
      : []),
    ['卫星', p.kind === 'home' ? '一颗和月球一样的' : p.moons ? `${p.moons} 颗(大的 ${p.major.length} 颗)` : '没有'],
    ...(p.ringed ? ([['环', '有']] as [string, string][]) : []),
  ];
  return (
    <div className="st-planet-card" style={{ left: left + 16 }}>
      <div className="hd">
        <b>{catalogName(sys, i)}</b>
        {p.kind === 'home' && onHome && (
          <button type="button" className="sys-chip on" onClick={onHome}>
            选它当母星 ›
          </button>
        )}
        {p.kind !== 'home' && p.habitable && onPickHome && (
          <button type="button" className="sys-chip on" onClick={() => onPickHome(p.key)}>
            选它当母星 ›
          </button>
        )}
        <button type="button" className="sys-chip" onClick={onClose}>
          取消聚焦
        </button>
      </div>
      <dl>
        {rows.map(([a, b]) => (
          <div key={a}>
            <dt>{a}</dt>
            <dd>{b}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** 光谱型 + 次型的选择 */
function StarPick({ star, onChange }: { star: StarSpec; onChange: (s: StarSpec) => void }) {
  return (
    <span className="sys-pick">
      {STAR_CLASSES.map((c) => (
        <button key={c} type="button" className={`sys-chip${star.cls === c ? ' on' : ''}`} onClick={() => onChange({ cls: c, sub: star.sub, mass: massOf(c, star.sub) })}>
          {c}
        </button>
      ))}
      <select value={star.sub} aria-label="次型" onChange={(e) => onChange({ cls: star.cls, sub: Number(e.target.value), mass: massOf(star.cls, Number(e.target.value)) })}>
        {Array.from({ length: 10 }, (_, k) => (
          <option key={k} value={k}>
            {star.cls}
            {k}
          </option>
        ))}
      </select>
    </span>
  );
}

const ADD_KINDS: PlanetSpec['kind'][] = ['rocky', 'super', 'mini', 'ice', 'gas', 'dwarf'];

/** 第一步左边:恒星系编辑器(改动存进世界设定 WorldEdits.system;没改过 = 按种子随机) */
export function SystemSettings({ params, onParams, disabled }: { params: WorldParams; onParams: (p: WorldParams) => void; disabled?: boolean }) {
  const edited = useEdits().system;
  const spec: SystemSpec = useMemo(() => edited ?? randomSpec(params.seed), [edited, params.seed]);
  const sys = useMemo(() => generateSystem(params.seed, params.temperature, spec), [params.seed, params.temperature, spec]);
  const home = sys.planets[sys.home];
  const dist = (T: number) => homeDistance(spec, sys.lum, T);
  const warn = habitability(sys.star);
  const warns = useMemo(() => specWarnings(spec), [spec]);
  const T = params.temperature;
  const set = (next: SystemSpec) => setSystemSpec({ ...next, planets: [...next.planets].sort((a, b) => a.ar - b.ar) });
  const setPlanet = (key: number, patch: Partial<PlanetSpec>) => set({ ...spec, planets: spec.planets.map((p) => (p.key === key ? { ...p, ...patch } : p)) });
  const nextKey = () => Math.max(0, ...spec.planets.map((p) => p.key)) + 1;
  const au = (ar: number) => (ar * home.a).toFixed(ar * home.a < 1 ? 3 : 2);
  const rows = sys.planets.map((p, i) => ({ p, i, sp: spec.planets.find((q) => q.key === p.key) }));
  const shortName = (i: number) => catalogName(sys, i).replace(/\(.*\)$/, '');
  return (
    <div className="sys-set">
      <div className="sys-item">
        <b>恒星</b>
        <StarPick star={spec.star} onChange={(st) => set({ ...spec, star: st })} />
        <p>
          {sys.star.label} 主序星 · {sys.star.mass.toFixed(2)} 倍太阳质量 · {sys.star.lum.toFixed(2)} 倍太阳光度 · 表面 {Math.round(sys.star.temp)} K
        </p>
        {warn && <p className="sys-warn">{warn}</p>}
      </div>
      <div className="sys-item">
        <b>伴星</b>
        <span className="sys-pick">
          {(['none', 'S', 'P'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`sys-chip${(spec.companion?.mode ?? 'none') === m ? ' on' : ''}`}
              onClick={() => {
                if (m === 'none') {
                  const { companion: _c, ...rest } = spec;
                  void _c;
                  set(rest);
                  return;
                }
                const cs = spec.companion?.star ?? { cls: 'M' as StarClass, sub: 4, mass: massOf('M', 4) };
                set({ ...spec, companion: { star: cs, mode: m, sep: m === 'P' ? 0.15 : 60, e: spec.companion?.e ?? 0.1 } });
              }}
            >
              {m === 'none' ? '没有' : m === 'S' ? '远伴星(S 型)' : '近距互绕(P 型)'}
            </button>
          ))}
        </span>
        {spec.companion && (
          <>
            <StarPick star={spec.companion.star} onChange={(st) => set({ ...spec, companion: { ...spec.companion!, star: st } })} />
            <label className="sys-row">
              <span>
                相距 {spec.companion.sep.toFixed(spec.companion.mode === 'P' ? 2 : 0)} 天文单位
              </span>
              <input
                type="range"
                min={spec.companion.mode === 'P' ? 0.05 : 15}
                max={spec.companion.mode === 'P' ? 0.4 : 300}
                step={spec.companion.mode === 'P' ? 0.01 : 1}
                value={spec.companion.sep}
                onChange={(e) => set({ ...spec, companion: { ...spec.companion!, sep: Number(e.target.value) } })}
              />
            </label>
            <p>{spec.companion.mode === 'P' ? '两颗星挨着互绕,行星绕着两颗转(只有离得够远的稳得住)' : '伴星在远处,行星只绕主星(离伴星太近的稳不住)'}</p>
          </>
        )}
      </div>
      <label className="sys-item">
        <b>类地行星离恒星</b>
        <p>
          {home.a.toFixed(2)} 天文单位 · 收到的辐射是地球的 {sys.flux.toFixed(2)} 倍 · 星球气温 {T > 0 ? '+' : ''}
          {T}°C · 绕一圈 {Math.round(sys.yearDays)} 天
        </p>
        <input type="range" min={-12} max={12} step={1} value={-T} disabled={disabled} aria-label="类地行星离恒星多远(远 = 冷)" onChange={(e) => onParams({ ...params, temperature: -Number(e.target.value) })} />
        <span className="sys-ends">
          <span>近 · 暖 {dist(12).toFixed(2)}</span>
          <span>远 · 冷 {dist(-12).toFixed(2)}</span>
        </span>
      </label>
      <div className="sys-item">
        <b>
          行星<small>{ARCH_NAME[spec.arch]}</small>
        </b>
        <ol className="sys-list">
          {rows.map(({ p, i, sp }) =>
            !sp ? (
              <li key="home" className="home pl">
                <span className="nm">{shortName(i)}</span>
                <span>{p.a.toFixed(2)} AU</span>
                <span>一颗月亮</span>
              </li>
            ) : (
              <li key={sp.key} className="pl">
                <span className="nm">{shortName(i)}</span>
                <select value={sp.kind} aria-label="种类" onChange={(e) => setPlanet(sp.key, { ...newPlanetSpec(e.target.value as PlanetSpec['kind'], sp.ar, sp.key), node: sp.node, m0: sp.m0 })}>
                  {ADD_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_NAME[k]}
                    </option>
                  ))}
                </select>
                <input
                  className="au"
                  type="number"
                  step="0.01"
                  min="0.01"
                  defaultValue={au(sp.ar)}
                  key={`${sp.key}:${au(sp.ar)}`}
                  aria-label="离恒星(天文单位)"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0) setPlanet(sp.key, { ar: v / home.a });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
                <span className="tq">AU</span>
                <span className="br" />
                <span className="tq2">{p.teq}°C</span>
                <input
                  className="au inc"
                  type="number"
                  step="1"
                  min="0"
                  max="90"
                  defaultValue={Math.round(sp.incl)}
                  key={`i${sp.key}:${Math.round(sp.incl)}`}
                  aria-label="轨道倾角(度)"
                  title="轨道倾角:对黄道(母星的轨道面)斜多少度"
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 0 && v <= 90) setPlanet(sp.key, { incl: v });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  }}
                />
                <span>°</span>
                <select
                  value={sp.moons.length}
                  aria-label="大卫星"
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const ms = Array.from({ length: n }, (_, k) => sp.moons[k] ?? { key: sp.key * 10 + k, radius: 800 + ((k * 397) % 1500), dist: 8 + k * 9 });
                    setPlanet(sp.key, { moons: ms });
                  }}
                >
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} 颗大卫星
                    </option>
                  ))}
                </select>
                {(sp.kind === 'gas' || sp.kind === 'ice') && (
                  <label className="ring">
                    <input type="checkbox" checked={sp.ringed} onChange={(e) => setPlanet(sp.key, { ringed: e.target.checked })} />环
                  </label>
                )}
                <button type="button" className="x" aria-label="删掉这颗" onClick={() => set({ ...spec, planets: spec.planets.filter((q) => q.key !== sp.key) })}>
                  ×
                </button>
              </li>
            ),
          )}
        </ol>
        <span className="sys-pick">
          {ADD_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className="sys-chip"
              onClick={() => {
                const far = Math.max(1, ...spec.planets.map((p) => p.ar));
                set({ ...spec, planets: [...spec.planets, newPlanetSpec(k, far * 1.7, nextKey())] });
              }}
            >
              + {KIND_NAME[k]}
            </button>
          ))}
        </span>
      </div>
      <div className="sys-item">
        <b>小行星带</b>
        {spec.belts.length === 0 && <p>没有</p>}
        <ol className="sys-list">
          {spec.belts.map((b, k) => (
            <li key={k}>
              <span className="nm">第 {k + 1} 条</span>
              <span>
                {au(b.inner)}–{au(b.outer)} AU
              </span>
              <button type="button" className="x" aria-label="删掉这条" onClick={() => set({ ...spec, belts: spec.belts.filter((_, j) => j !== k) })}>
                ×
              </button>
            </li>
          ))}
        </ol>
        <span className="sys-pick">
          <button
            type="button"
            className="sys-chip"
            onClick={() => {
              const far = Math.max(1, ...spec.planets.map((p) => p.ar), ...spec.belts.map((b) => b.outer));
              set({ ...spec, belts: [...spec.belts, { inner: far * 1.3, outer: far * 1.3 * 1.4, count: 900 }] });
            }}
          >
            + 小行星带
          </button>
        </span>
      </div>
      {warns.length > 0 && (
        <div className="sys-item">
          {warns.map((w) => (
            <p key={w} className="sys-warn">
              {w}
            </p>
          ))}
        </div>
      )}
      <div className="sys-item sys-actions">
        <button type="button" className="sys-chip" onClick={() => setSystemSpec(randomSpec((params.seed * 31 + Math.floor(Math.random() * 1e9)) >>> 0))}>
          整系重掷
        </button>
        <button type="button" className="sys-chip" disabled={!edited} onClick={() => setSystemSpec(null)}>
          恢复默认
        </button>
        <span className="sys-note">{edited ? '改过,跟着存档走' : '按种子生成'}</span>
      </div>
    </div>
  );
}
