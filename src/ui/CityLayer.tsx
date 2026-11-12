/**
 * 本地分支 modern-pace 第五十三轮:城市的样子(夜景照 NASA "黑色大理石"那种)—— 只读推演(城和乡村的人口、各州的能力、道路、核打击),不改推演。
 *
 * 一张世界坐标的贴图(主图栅格的 2 倍,最宽 4096),按像素算,不画圆:
 *   人口光场  各州乡村人口按宜居度摊到陆地块;大路地块加上沿路的镇子;城的一半人口摊到周围的郊区,优先沿大路和海岸摊(城不是圆的)。
 *             主图栅格每个像素按所在地块取值,再模糊一点(地块的边看不出来)
 *   像素亮不亮  密度(相对全世界最密那 1%)越高,亮的像素越多:高频噪声 < 概率就亮 —— 城心几乎全亮、城郊稀疏、乡下偶尔一点;
 *             边缘是参差的一粒粒
 *   大路      一像素宽的细光线(按两头通电的程度)
 *   夜景      地图压成深蓝黑(陆地、海岸在"月光"下隐约看得见);灯是钠灯的橙黄,城心偏淡黄白;
 *             通电 = 本州生产 5.5→7(没电只有很暗的火光);核打击十年内、核冬天灯灭;另叠一层很淡的低分辨率光晕
 *   城区(白天;卫星、白模底图)  第六十轮起和夜景同一份光场:夜里亮的地方白天就是建成区(建成的概率 = 亮的概率),
 *             用成团的噪声定边(稀的地方是散落的小镇团块、密的地方连成整片,顺着路、海岸、河谷长),不透明;陡坡少建;
 *             城心水泥灰、郊区灰褐、零星深色工业区和成块绿地,叠一点山地明暗
 * 显示:按地图投影把贴图分成网格、一块块仿射贴上去(平面图、地球仪都行);不插值(放大不糊)。年份变了才重算贴图,镜头动了只重贴。
 */
import { setGlobeCity } from './globeCity';
import { cityPos } from '../render/civ/cityPos';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { populationAt, ruralPopulationAt } from '../gen/civ/growth';
import { CAP_COUNT, developmentAt } from '../gen/civ/development';
import { routeLines, terrainCached } from '../render/civ/routes';
import { drawRealisticRivers } from '../render/realistic';
import { cityStreets } from '../render/civ/roadDetail';
import { KM_PER_UNIT } from '../gen/civ/scale';
import { getCivTime } from './civView';
import type { WorldToClient } from './EventPins';
import './timeline.css';

export interface CityLayerProps {
  civ: Civ | null;
  world: World;
  raster: Raster;
  toClient: MutableRefObject<WorldToClient | null>;
  /** 底图是卫星 / 白模(画城区) */
  urban: boolean;
  night: boolean;
  hidden?: boolean;
  /** 第六十九轮:地球仪上 —— 城区贴图交给球的着色器画(ui/globeCity.ts),这一层只画街道 */
  globe?: boolean;
}

/** 像素的整数哈希 → [0, 1) */
const ph = (x: number, y: number) => {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function CityLayer({ civ, world, raster, toClient, urban, night, hidden, globe }: CityLayerProps) {
  const ok = !!civ && civ.viable && civ.settlements.length > 0;
  const data = useMemo(() => {
    if (!ok) return null;
    const c = civ!.history ?? civ!;
    const R = c.regions;
    const n = world.mesh.n;
    // 各州的陆地块和按宜居度的分摊权重
    const cellW = new Float32Array(n);
    for (let r = 0; r < R.count; r++) {
      let sum = 0;
      for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) sum += Math.max(0.05, c.habitat.suitability[R.cells[k]] ?? 0);
      for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) {
        const cell = R.cells[k];
        if (cell < n) cellW[cell] = Math.max(0.05, c.habitat.suitability[cell] ?? 0) / (sum || 1);
      }
    }
    // 大路经过的地块
    const roadOf = new Map<number, { built: number; end: number }>();
    for (const rt of c.routes) {
      if (rt.kind !== 'road') continue;
      for (let k = 0; k < rt.cells.length; k++) {
        const o = roadOf.get(rt.cells[k]);
        const end = rt.abandoned ?? Infinity;
        if (!o || rt.built < o.built)
          roadOf.set(rt.cells[k], {
            built: rt.built,
            end: Math.max(end, o?.end ?? 0),
          });
      }
    }
    const roads = c.routes.filter((r) => r.kind === 'road' && r.cells.length > 1);
    // 每座城周围的地块(郊区往外摊):离城心 6 个地块间距以内;沿大路、海岸的权重大(城沿着路和海岸长,不是圆的)
    const sp = world.width / Math.sqrt(n * (world.width / world.height));
    const grid = new Map<string, number[]>();
    const key = (x: number, y: number) => `${Math.floor(x / (sp * 3))},${Math.floor(y / (sp * 3))}`;
    for (let i = 0; i < n; i++) {
      if (R.of[i] < 0) continue;
      const k = key(world.mesh.x[i], world.mesh.y[i]);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
    const near: { s: number; cell: number; d: number; bias: number }[] = [];
    c.settlements.forEach((s, si) => {
      const x = world.mesh.x[s.cell],
        y = world.mesh.y[s.cell];
      const gx = Math.floor(x / (sp * 3)),
        gy = Math.floor(y / (sp * 3));
      for (let a = -2; a <= 2; a++)
        for (let b = -2; b <= 2; b++)
          for (const i of grid.get(`${gx + a},${gy + b}`) ?? []) {
            const d = Math.hypot(world.mesh.x[i] - x, world.mesh.y[i] - y) / sp;
            if (d > 6) continue;
            const coast = c.habitat.coastDist[i] === 1 ? 1.8 : 1;
            const road = roadOf.has(i) ? 2.5 : 1;
            near.push({
              s: si,
              cell: i,
              d,
              bias: coast * road * (0.6 + 0.8 * ph(i, si)),
            });
          }
    });
    // 每座城的主干方向:从城心出去的大路(没有路 = 按城的编号随便定一个)
    const cityAng = c.settlements.map((s, si) => {
      for (const rt of roads) {
        const a = rt.cells[0] === s.cell ? 0 : rt.cells[rt.cells.length - 1] === s.cell ? rt.cells.length - 1 : -1;
        if (a < 0) continue;
        const b = rt.cells[Math.min(rt.cells.length - 1, Math.max(0, a === 0 ? 2 : a - 2))];
        return Math.atan2(world.mesh.y[b] - world.mesh.y[s.cell], world.mesh.x[b] - world.mesh.x[s.cell]);
      }
      return ph(si, 77) * Math.PI;
    });
    return { c, cellW, roadOf, roads, near, cityAng, sp };
  }, [civ, world, ok]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const ccanvas = useRef<HTMLCanvasElement | null>(null);
  const tcanvas = useRef<HTMLCanvasElement | null>(null);
  const show = !hidden && ok && (urban || night);

  useEffect(() => {
    if (!show || !data) return;
    let raf = 0;
    let sig = '';
    let texKey = '';
    const { c, cellW, roadOf, roads, near, cityAng, sp } = data;
    let popsNow: number[] = [];
    let topNow = 1;
    /** 亮度的固定标尺(末年最密那 1%;第一次重算时算) */
    let topRef: number | null = null;
    const R = c.regions;
    const n = world.mesh.n;
    // 贴图:主图栅格的 2 倍(最宽 4096)
    const k2 = Math.max(1, Math.min(2, Math.floor(4096 / raster.w)));
    const TW = raster.w * k2,
      TH = raster.h * k2;
    const tex = document.createElement('canvas');
    tex.width = TW;
    tex.height = TH;
    const tg = tex.getContext('2d')!;
    // 第七十二轮:明暗贴图(灰 = 128 不变,亮 = 提亮,暗 = 压暗;平面图上 soft-light 叠)
    const ltex = document.createElement('canvas');
    ltex.width = TW;
    ltex.height = TH;
    const lg = ltex.getContext('2d')!;
    /** 屏幕像素级的细颗粒(灰 128 ± ,2×2 一粒),跟着地图平移 */
    const grain = document.createElement('canvas');
    grain.width = grain.height = 128;
    {
      const gg2 = grain.getContext('2d')!;
      const im = gg2.createImageData(128, 128);
      for (let y = 0; y < 128; y++)
        for (let x = 0; x < 128; x++) {
          const v = 128 + (ph((x >> 1) * 7 + 1, (y >> 1) * 11 + 3) - 0.5) * 120 + (ph(x + 5, y + 9) - 0.5) * 40;
          const o = (y * 128 + x) * 4;
          im.data[o] = im.data[o + 1] = im.data[o + 2] = v;
          im.data[o + 3] = 255;
        }
      gg2.putImageData(im, 0, 0);
    }
    let gcv: HTMLCanvasElement | null = null;
    const glow = document.createElement('canvas');
    glow.width = Math.ceil(TW / 8);
    glow.height = Math.ceil(TH / 8);
    const gg = glow.getContext('2d')!;
    const field = new Float32Array(n);
    const cityField = new Float32Array(n);
    const dens = new Float32Array(raster.w * raster.h);
    // 建成区的噪声和年份无关:第一次用到某个像素时算好存起来(0 = 还没算;门槛噪声 1–255;标记位 1 = 绿地、2 = 工业区)
    let nzThr: Uint8Array | null = null;
    let nzFlag: Uint8Array | null = null;
    /** 第七十二轮:农田强度(主图栅格,模糊过) */
    let farmI: Float32Array | null = null;
    let farmT: Float32Array | null = null;
    /** 每格能不能种(0–1):气温、降水、坡度 */
    let arable: Float32Array | null = null;
    /** 开垦标尺:末年乡村人口(有人的地块)的中位数 */
    let farmRef: number | null = null;
    const tmp = new Float32Array(raster.w * raster.h);
    const uArr = new Float32Array(raster.w * raster.h);
    // 第六十二轮:城市生长(SLEUTH 式,见 buildGrowth):每格"多早建起来"的分数、归哪座城、各城按分数分档的累计格数;
    // 这一年各城建到哪个分数(thrNow)、市中心到哪(coreNow)、老城到哪(oldNow)
    let grow: { S: Float32Array; own: Int32Array; cum: Int32Array; NB: number; Smax: number } | null = null;
    let pxOfCell: Int32Array | null = null;
    /** 河道蒙版(贴图像素;1 = 河):和卫星底图同一个画河的函数画一遍,城区、灯光在河上空出来 */
    let rivMask: Uint8Array | null = null;
    /** 白天城区挖掉河道的一份(地球仪 / 弯边投影用:那里没有叠在城区上面的河) */
    let texM: HTMLCanvasElement | null = null;
    let maskCv: HTMLCanvasElement | null = null;
    let texMDirty = true;
    const maskedTex = () => {
      if (!texM) {
        texM = document.createElement('canvas');
        texM.width = TW;
        texM.height = TH;
      }
      if (!texMDirty) return texM;
      texMDirty = false;
      if (!maskCv) {
        maskCv = document.createElement('canvas');
        maskCv.width = TW;
        maskCv.height = TH;
        const mg = maskCv.getContext('2d')!;
        const im = mg.createImageData(TW, TH);
        const M = riverMask();
        for (let i = 0; i < TW * TH; i++) if (M[i]) im.data[i * 4 + 3] = 255;
        mg.putImageData(im, 0, 0);
      }
      const g3 = texM.getContext('2d')!;
      g3.globalCompositeOperation = 'source-over';
      g3.clearRect(0, 0, TW, TH);
      g3.drawImage(tex, 0, 0);
      g3.globalCompositeOperation = 'destination-out';
      g3.drawImage(maskCv, 0, 0);
      g3.globalCompositeOperation = 'source-over';
      return texM;
    };
    /** 城区上面重画的河(屏幕大小);画它时的视口;拖动停下后补画一次的计时器 */
    let rv: HTMLCanvasElement | null = null;
    let rvView = { s: -1, ox: 0, oy: 0 };
    let rvForce = false;
    let rvTimer = 0;
    const riverMask = () => {
      if (rivMask) return rivMask;
      rivMask = new Uint8Array(TW * TH);
      try {
        const cv = document.createElement('canvas');
        cv.width = TW;
        cv.height = TH;
        const g2 = cv.getContext('2d', { willReadFrequently: true })!;
        // 按总览那一档的河画,只挖河道中间(透明度 > 120;抗锯齿的边不挖) —— 挖宽了城和河之间露出一道自然地形的缝
        drawRealisticRivers(g2, world, raster, { s: TW / world.width, ox: 0, oy: 0, k: 1 }, false);
        const a = g2.getImageData(0, 0, TW, TH).data;
        for (let i = 0; i < TW * TH; i++) if (a[i * 4 + 3] > 120) rivMask[i] = 1;
      } catch {
        // 画不出来就不空(城区照常画)
      }
      return rivMask;
    };
    let mThr: Float32Array | null = null,
      mOld: Float32Array | null = null,
      mCore: Float32Array | null = null;
    let thrNow = new Float32Array(0),
      coreNow = new Float32Array(0),
      oldNow = new Float32Array(0);
    let dev: Float32Array | null = null;

    const T = terrainCached(raster, world.width);
    const nearCell = (wx: number, wy: number) => {
      const ix = Math.floor(((((wx % world.width) + world.width) % world.width) * raster.w) / world.width);
      const iy = Math.min(raster.h - 1, Math.max(0, Math.floor((wy * raster.h) / world.height)));
      return Math.max(0, raster.cell[iy * raster.w + Math.min(raster.w - 1, ix)]);
    };
    /** 世界坐标那一点的城区密度 0–1 */
    const urbanAt = (wx: number, wy: number) => {
      const ix = Math.floor(((((wx % world.width) + world.width) % world.width) * raster.w) / world.width);
      const iy = Math.floor((wy * raster.h) / world.height);
      if (iy < 0 || iy >= raster.h) return 0;
      const ri = iy * raster.w + Math.min(raster.w - 1, ix);
      if (raster.water[ri]) return 0;
      // 建成了 = 1(街道只长在建成区里);外面按光场,最多 0.4
      if (grow) {
        const o = grow.own[ri];
        if (o >= 0 && grow.S[ri] <= thrNow[o]) return 1;
      }
      return Math.min(0.4, 0.4 * Math.pow(dens[ri] / topNow, 0.7));
    };
    /** 各城的街道(按人口分档缓存;推演往前走、城长大了才重长) */
    const streetCache = new Map<number, { band: number; lines: Float32Array[] }>();
    /** 平滑的值噪声(格点哈希 + 双线性),0–1 */
    const vnoise = (x: number, y: number, salt: number) => {
      const x0 = Math.floor(x),
        y0 = Math.floor(y),
        fx = x - x0,
        fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx),
        sy = fy * fy * (3 - 2 * fy);
      const a = ph(x0 + salt, y0),
        b = ph(x0 + 1 + salt, y0),
        c2 = ph(x0 + salt, y0 + 1),
        d2 = ph(x0 + 1 + salt, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d2 * sx) * sy;
    };
    const fbm = (x: number, y: number, salt: number) => 0.5 * vnoise(x / 9, y / 9, salt) + 0.3 * vnoise(x / 4.5, y / 4.5, salt + 101) + 0.2 * vnoise(x / 2.2, y / 2.2, salt + 211);
    /** 主图栅格每格的"陡"(0–0.6,陡坡少建)和山地明暗(光从左上来);地形不变,第一次用到时算 */
    let steepArr: Float32Array | null = null;
    let shadeArr: Float32Array | null = null;
    const terrainShade = () => {
      if (steepArr && shadeArr) return;
      const PW = raster.w,
        PH = raster.h,
        E = raster.elev;
      const pxM = (KM_PER_UNIT * world.width * 1000) / PW;
      steepArr = new Float32Array(PW * PH);
      shadeArr = new Float32Array(PW * PH).fill(1);
      for (let ry = 1; ry < PH - 1; ry++)
        for (let rx = 0; rx < PW; rx++) {
          const ri = ry * PW + rx;
          const ex = (E[ry * PW + ((rx + 1) % PW)] - E[ry * PW + ((rx - 1 + PW) % PW)]) / (2 * pxM);
          const ey = (E[ri + PW] - E[ri - PW]) / (2 * pxM);
          steepArr[ri] = Math.min(0.6, Math.max(0, Math.hypot(ex, ey) - 0.004) * 30);
          shadeArr[ri] = Math.max(0.78, Math.min(1.14, 1 - (ex + ey) * 18));
        }
    };
    /**
     * 第六十二轮:城市怎么长(SLEUTH 式,一张地图只算一次)。
     *   从各城城心出发,按栅格 8 邻跑多源最短路:一步的代价 = 距离 × 坡度阻力 × 路的引力(路过的格 × 0.35)× 每格的难易(对数正态 —— 前沿长成分形);
     *   分数 = 代价 + 成团的"跳跃"噪声(前沿外面低的地方先建 → 卫星镇)。每格归最先够到它的那座城。
     *   每座城按分数分 NB 档记格数(累计):某一年这座城要多少格,查到哪一档就建到哪
     */
    const buildGrowth = () => {
      if (grow) return grow;
      terrainShade();
      const PW = raster.w,
        PH = raster.h,
        N = PW * PH;
      const pxu = PW / world.width;
      const road = new Uint8Array(N);
      for (const l of routeLines(world.mesh, c, c.endYear, T).road) {
        const Q = l.pts;
        for (let k = 0; k < Q.length / 2; k++) {
          const ix = ((Math.floor(Q[k * 2] * pxu) % PW) + PW) % PW,
            iy = Math.floor(Q[k * 2 + 1] * pxu);
          if (iy >= 0 && iy < PH) road[iy * PW + ix] = 1;
        }
      }
      // 每格的难易:对数正态(三个均匀数凑一个近似正态)
      const het = new Float32Array(N);
      // 波动别太大(第六十二轮第二版:0.9 → 0.45,太大城区碎成一片片)
      // 第六十九轮:难易度是成片的噪声(逐格独立的随机走远了就互相抵消,城长成圆的、城与城之间切成 Voronoi 格子)
      for (let i = 0; i < N; i++) {
        const x = i % PW,
          y = (i / PW) | 0;
        const lo = vnoise(x / 14, y / 14, 7001) * 0.65 + vnoise(x / 5, y / 5, 7013) * 0.35;
        het[i] = Math.exp(1.6 * (lo - 0.5) * 2 + 0.25 * (ph(i, 7) - 0.5));
      }
      const S = new Float32Array(N).fill(Infinity);
      const own = new Int32Array(N).fill(-1);
      const hk: number[] = [],
        hv: number[] = [];
      const push = (k: number, v: number) => {
        let i = hk.length;
        hk.push(k);
        hv.push(v);
        while (i > 0) {
          const pi = (i - 1) >> 1;
          if (hk[pi] <= k) break;
          hk[i] = hk[pi];
          hv[i] = hv[pi];
          i = pi;
        }
        hk[i] = k;
        hv[i] = v;
      };
      const pop = () => {
        const v = hv[0];
        const k = hk.pop()!,
          w = hv.pop()!;
        const n0 = hk.length;
        if (n0) {
          let i = 0;
          for (;;) {
            const l = 2 * i + 1;
            if (l >= n0) break;
            const r = l + 1;
            const m = r < n0 && hk[r] < hk[l] ? r : l;
            if (hk[m] >= k) break;
            hk[i] = hk[m];
            hv[i] = hv[m];
            i = m;
          }
          hk[i] = k;
          hv[i] = w;
        }
        return v;
      };
      c.settlements.forEach((st, si) => {
        const [cxw, cyw] = cityPos(world, raster, st.cell);
        const ix = ((Math.floor(cxw * pxu) % PW) + PW) % PW,
          iy = Math.min(PH - 1, Math.max(0, Math.floor(cyw * pxu)));
        const i = iy * PW + ix;
        if (raster.water[i] || S[i] === 0) return;
        S[i] = 0;
        own[i] = si;
        push(0, i);
      });
      const CUT = 90;
      const NBX = [1, -1, 0, 0, 1, 1, -1, -1],
        NBY = [0, 0, 1, -1, 1, -1, 1, -1];
      const done = new Uint8Array(N);
      while (hk.length) {
        const k0 = hk[0];
        const i = pop();
        if (done[i]) continue;
        done[i] = 1;
        if (k0 > CUT) break;
        const x = i % PW,
          y = (i / PW) | 0;
        for (let t = 0; t < 8; t++) {
          const yy = y + NBY[t];
          if (yy < 0 || yy >= PH) continue;
          const j = yy * PW + ((x + NBX[t] + PW) % PW);
          if (done[j] || raster.water[j]) continue;
          const step = (t < 4 ? 1 : 1.414) * (1 + 4 * steepArr![j]) * (road[j] ? 0.15 : 1) * het[j];
          const v = k0 + step;
          if (v < S[j]) {
            S[j] = v;
            own[j] = own[i];
            push(v, j);
          }
        }
      }
      // 成团的跳跃:前沿外面"低"的地方先建(± 5 个代价单位,按 6 格大小的团)
      let Smax = 0;
      for (let i = 0; i < N; i++) {
        if (own[i] < 0 || !Number.isFinite(S[i])) {
          own[i] = -1;
          continue;
        }
        const x = i % PW,
          y = (i / PW) | 0;
        S[i] = Math.max(0, S[i] + 4 * (vnoise(x / 6, y / 6, 4099) - 0.5) + 1 * (vnoise(x / 2.5, y / 2.5, 4111) - 0.5));
        if (S[i] > Smax) Smax = S[i];
      }
      const NB = 256;
      const cum = new Int32Array(c.settlements.length * NB);
      for (let i = 0; i < N; i++) if (own[i] >= 0) cum[own[i] * NB + Math.min(NB - 1, Math.floor((S[i] / (Smax || 1)) * NB))]++;
      for (let si = 0; si < c.settlements.length; si++) for (let b = 1; b < NB; b++) cum[si * NB + b] += cum[si * NB + b - 1];
      grow = { S, own, cum, NB, Smax };
      return grow;
    };
    /** 重算贴图(年份、模式变了才算) */
    const bake = (year: number) => {
      if (c.development) dev = developmentAt(c.development, Math.floor(year), dev ?? undefined);
      const prodOf = (r: number) => (dev && r >= 0 ? dev[r * CAP_COUNT] : 0);
      const elec = (r: number) => Math.max(0, Math.min(1, (prodOf(r) - 5.5) / 1.5));
      /** 某一年的光场 → dens(千人 / 地块,模糊过);返回各城人口、这一年最密那 1% */
      const fillDens = (yr: number, withDens = true) => {
        // ---- 光场(千人 / 地块)----
        field.fill(0);
        cityField.fill(0);
        for (let r = 0; r < R.count; r++) {
          const rural = ruralPopulationAt(c, r, yr);
          if (rural <= 0) continue;
          for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) {
            const cell = R.cells[k];
            if (cell < n) field[cell] += rural * cellW[cell];
          }
        }
        for (const [cell, rd] of roadOf) if (rd.built <= yr && rd.end > yr && R.of[cell] >= 0) field[cell] += 0.6 * (field[cell] + 3);
        const pops = c.settlements.map((st) => (st.founded > yr || (st.ended !== undefined && st.ended <= yr) ? 0 : populationAt(st, yr)));
        const reach = pops.map((p) => 1 + 1.6 * Math.log10(1 + p / 100));
        const wsum = new Float32Array(c.settlements.length);
        for (const q of near) if (pops[q.s] > 0 && q.d <= reach[q.s]) wsum[q.s] += q.bias * Math.exp(-q.d / (reach[q.s] * 0.45));
        for (const q of near) {
          const p = pops[q.s];
          if (p <= 0 || q.d > reach[q.s]) continue;
          cityField[q.cell] += (0.85 * p * q.bias * Math.exp(-q.d / (reach[q.s] * 0.45))) / (wsum[q.s] || 1);
        }
        c.settlements.forEach((st, i) => {
          if (pops[i] > 0) cityField[st.cell] += 0.15 * pops[i];
        });
        // 白天只要各城人口和乡村人口场(城郊面积用);密度、模糊、标尺是夜景用的
        if (!withDens) return { pops, top: 1 };
        // ---- 主图栅格上的密度(每个像素按所在地块取值),模糊两遍(地块的边看不出来)----
        const RW = raster.w,
          RH = raster.h;
        for (let i = 0; i < RW * RH; i++) {
          const cell = raster.cell[i];
          dens[i] = raster.water[i] || cell < 0 ? 0 : field[cell] + cityField[cell];
        }
        // 方框模糊(滑动求和:每个像素加一个、减一个;横向左右相连,纵向边上按边上的值延伸)
        const blur = (src: Float32Array, dst: Float32Array, horiz: boolean, rad: number) => {
          const k = 1 / (2 * rad + 1);
          if (horiz)
            for (let y = 0; y < RH; y++) {
              const row = y * RW;
              let s = 0;
              for (let j = -rad; j <= rad; j++) s += src[row + ((j + RW) % RW)];
              for (let x = 0; x < RW; x++) {
                dst[row + x] = s * k;
                s += src[row + ((x + rad + 1) % RW)] - src[row + ((x - rad + RW) % RW)];
              }
            }
          else
            for (let x = 0; x < RW; x++) {
              let s = 0;
              for (let j = -rad; j <= rad; j++) s += src[Math.min(RH - 1, Math.max(0, j)) * RW + x];
              for (let y = 0; y < RH; y++) {
                dst[y * RW + x] = s * k;
                s += src[Math.min(RH - 1, y + rad + 1) * RW + x] - src[Math.max(0, y - rad) * RW + x];
              }
            }
        };
        blur(dens, tmp, true, 2);
        blur(tmp, dens, false, 2);
        // 满格 = 最密那 1%
        const samp: number[] = [];
        for (let i = 0; i < RW * RH; i += 7) if (dens[i] > 0.3) samp.push(dens[i]);
        samp.sort((a, b) => a - b);
        return {
          pops,
          top: samp.length ? samp[Math.floor(samp.length * 0.99)] : 1,
        };
      };
      // 第六十一轮:固定标尺 —— 末年最密那 1% = 满格,每年都按它折算(比末年还密的年份取大的);人口涨了城就长大,不会"逆城市化"
      if (night && topRef === null) topRef = fillDens(c.endYear).top;
      // 第七十一轮:开垦标尺(末年,固定 —— 人多了田就多,不会因为别处更密反而变少)
      if (!night && farmRef === null) {
        fillDens(c.endYear, false);
        const v: number[] = [];
        for (let i = 0; i < n; i++) if (field[i] > 0) v.push(field[i]);
        v.sort((a, b) => a - b);
        farmRef = v.length ? Math.max(1e-6, v[Math.floor(v.length * 0.75)]) : 1;
      }
      const { pops, top: top0 } = fillDens(year, night);
      const top = Math.max(topRef ?? top0, top0);
      popsNow = pops;
      topNow = top;
      const RW = raster.w,
        RH = raster.h;
      // 核冬天;刚挨过核打击的地块
      const winter = c.annals.some((a) => a.kind === 'nuke' && a.n === 4 && year >= a.year && year <= a.year + (a.oob?.[0] ?? 3) + 1);
      const dark = new Set<number>();
      for (const st of c.settlements) if (st.sacks?.some((k) => k.cause === 'nuke' && year >= k.year && year < k.year + 10)) dark.add(st.cell);
      // 第六十八轮(用户"这给炸的外焦里嫩啊"):挨过核打击的城,整片建成区变成废墟(按挨了几发、多重,几十年里重建)
      const ruinOf = new Float32Array(c.settlements.length);
      c.settlements.forEach((st, si) => {
        let r = 0;
        for (const k of st.sacks ?? []) {
          if (k.cause !== 'nuke' || !(year >= k.year)) continue;
          r = Math.min(1, r + Math.min(1, 0.4 + k.loss) * Math.exp(-(year - k.year) / 22));
        }
        ruinOf[si] = r;
      });
      // ---- 按像素:亮不亮、多亮 ----
      const img = tg.createImageData(TW, TH);
      const d = img.data;
      const limg = !night ? lg.createImageData(TW, TH) : null;
      const ld = limg ? limg.data : d;
      // 第六十二轮:各城这一年建多少格(人口 × 人均占地 60–300 m² × 视觉放大 27 倍,总面积和上一版光场画法对上),按生长的先后取前面那么多;最早的 12% = 市中心、到 35% = 老城
      const G = buildGrowth();
      const RM = riverMask();
      {
        const pxKm = KM_PER_UNIT / (RW / world.width);
        const N0 = c.settlements.length;
        if (thrNow.length !== N0) {
          thrNow = new Float32Array(N0);
          coreNow = new Float32Array(N0);
          oldNow = new Float32Array(N0);
        }
        const at = (si: number, want: number) => {
          if (want < 0.5) return -1;
          for (let b = 0; b < G.NB; b++) if (G.cum[si * G.NB + b] >= want) return ((b + 1) / G.NB) * G.Smax;
          return Infinity;
        };
        // 城郊:每座城腹地(生长时归它的格)里的乡村人口(光场里乡村 + 沿路的镇子;千人),× 城郊化比例(0.6 × 电气化)也算进建成区 —— 城与城之间连成片
        if (!pxOfCell) {
          pxOfCell = new Int32Array(n);
          for (let i = 0; i < RW * RH; i++) if (raster.cell[i] >= 0) pxOfCell[raster.cell[i]]++;
        }
        const hinter = new Float32Array(N0);
        for (let i = 0; i < RW * RH; i++) {
          const o = G.own[i];
          if (o < 0) continue;
          const cell = raster.cell[i];
          if (cell >= 0 && pxOfCell[cell] > 0) hinter[o] += field[cell] / pxOfCell[cell];
        }
        c.settlements.forEach((st, si) => {
          const e = elec(st.region);
          const k = ((0.06 + 0.24 * e) * 27) / (pxKm * pxKm);
          const urban = pops[si] * k;
          // 第六十九轮:腹地加成偏给大城(小城保持小,不再满地一样大的斑)
          thrNow[si] = pops[si] > 0 ? at(si, urban + 0.45 * e * Math.min(1, Math.max(0.15, pops[si] / 3000)) * hinter[si] * k) : -1;
          // 市中心、老城只按城市人口
          coreNow[si] = at(si, urban * 0.12);
          oldNow[si] = at(si, urban * 0.35);
        });
        // 每格"离建起来还差多少"(> 0 = 建了):建成 / 老城 / 市中心各一份。贴图像素按周围四格双线性取,边是顺的曲线,不是一格一格的台阶
        if (!mThr || mThr.length !== RW * RH) {
          mThr = new Float32Array(RW * RH);
          mOld = new Float32Array(RW * RH);
          mCore = new Float32Array(RW * RH);
        }
        for (let i = 0; i < RW * RH; i++) {
          const o = G.own[i];
          if (o < 0) {
            mThr[i] = mOld![i] = mCore![i] = -50;
            continue;
          }
          const sv = G.S[i];
          mThr[i] = Math.max(-50, Math.min(50, thrNow[o] - sv));
          mOld![i] = Math.max(-50, Math.min(50, oldNow[o] - sv));
          mCore![i] = Math.max(-50, Math.min(50, coreNow[o] - sv));
        }
        // 第六十九轮:余量图各模糊两遍(1-2-1,横竖各一次)—— 生长按栅格格子走,放大后边上一格一格的台阶磨成圆滑的曲线
        {
          const tmpB = tmp;
          const blur121 = (a: Float32Array) => {
            for (let pass = 0; pass < 2; pass++) {
              for (let y = 0; y < RH; y++) {
                const row = y * RW;
                for (let x = 0; x < RW; x++) tmpB[row + x] = 0.25 * a[row + ((x - 1 + RW) % RW)] + 0.5 * a[row + x] + 0.25 * a[row + ((x + 1) % RW)];
              }
              for (let y = 0; y < RH; y++) {
                const u = Math.max(0, y - 1) * RW,
                  dn = Math.min(RH - 1, y + 1) * RW,
                  row = y * RW;
                for (let x = 0; x < RW; x++) a[row + x] = 0.25 * tmpB[u + x] + 0.5 * tmpB[row + x] + 0.25 * tmpB[dn + x];
              }
            }
          };
          blur121(mThr);
          blur121(mOld!);
          blur121(mCore!);
        }
      }
      const mT = mThr!,
        mO = mOld!,
        mC = mCore!;
      /** 贴图像素 (x, y) 处,数组 a 的双线性值(左右相连) */
      const bil = (a: Float32Array, x: number, y: number) => {
        const fx = (x + 0.5) / k2 - 0.5,
          fy = Math.min(RH - 1.001, Math.max(0, (y + 0.5) / k2 - 0.5));
        const x0 = Math.floor(fx),
          y0 = Math.floor(fy),
          ax = fx - x0,
          ay = fy - y0;
        const xa = ((x0 % RW) + RW) % RW,
          xb = (xa + 1) % RW;
        return (a[y0 * RW + xa] * (1 - ax) + a[y0 * RW + xb] * ax) * (1 - ay) + (a[(y0 + 1) * RW + xa] * (1 - ax) + a[(y0 + 1) * RW + xb] * ax) * ay;
      };
      // 每格的相对密度(按主图栅格算一次,贴图 k2 × k2 个像素共用)
      if (night) for (let i = 0; i < RW * RH; i++) uArr[i] = raster.water[i] ? 0 : Math.min(1, Math.pow(dens[i] / top, 0.7));
      {
        // 噪声第一次重算时一次算好(和年份无关;播放时不再边用边算)
        if (!nzThr) {
          nzThr = new Uint8Array(TW * TH);
          nzFlag = new Uint8Array(TW * TH);
          for (let y = 0; y < TH; y++) {
            const ry = (y / k2) | 0;
            for (let x = 0; x < TW; x++) {
              if (raster.water[ry * RW + ((x / k2) | 0)]) continue;
              const q = y * TW + x;
              nzThr[q] = 1 + Math.round(254 * Math.min(1, Math.max(0, fbm(x, y, 17))));
              nzFlag![q] = (vnoise(x / 6, y / 6, 523) > 0.86 ? 1 : 0) | (vnoise(x / 5, y / 5, 911) > 0.83 ? 2 : 0);
            }
          }
        }
        if (!night && !arable) {
          arable = new Float32Array(RW * RH);
          for (let i = 0; i < RW * RH; i++) {
            if (raster.water[i]) continue;
            const tw = Math.min(1, Math.max(0, (raster.temp[i] + 2) / 8));
            const pw = Math.min(1, Math.max(0, (raster.precip[i] - 200) / 250));
            const sw = Math.max(0, 1 - steepArr![i] / 0.3);
            arable[i] = tw * pw * sw;
          }
        }
        // 第七十二轮:农田强度 = 能不能种 × 乡村人口(按末年标尺),模糊两遍(地块的多边形边看不出来)
        if (!night) {
          if (!farmI) {
            farmI = new Float32Array(RW * RH);
            farmT = new Float32Array(RW * RH);
          }
          const F = farmI,
            T = farmT!;
          for (let i = 0; i < RW * RH; i++) {
            const cell = raster.cell[i];
            F[i] = raster.water[i] || cell < 0 ? 0 : arable![i] * (1 - Math.exp((-1.2 * field[cell]) / farmRef!));
          }
          const rad = 3,
            kk = 1 / (2 * rad + 1);
          for (let pass = 0; pass < 2; pass++) {
            for (let y = 0; y < RH; y++) {
              const row = y * RW;
              let sm = 0;
              for (let j = -rad; j <= rad; j++) sm += F[row + ((j + RW) % RW)];
              for (let x = 0; x < RW; x++) {
                T[row + x] = sm * kk;
                sm += F[row + ((x + rad + 1) % RW)] - F[row + ((x - rad + RW) % RW)];
              }
            }
            for (let x = 0; x < RW; x++) {
              let sm = 0;
              for (let j = -rad; j <= rad; j++) sm += T[Math.min(RH - 1, Math.max(0, j)) * RW + x];
              for (let y = 0; y < RH; y++) {
                F[y * RW + x] = sm * kk;
                sm += T[Math.min(RH - 1, y + rad + 1) * RW + x] - T[Math.max(0, y - rad) * RW + x];
              }
            }
          }
        }
      }
      for (let y = 0; y < TH; y++) {
        const ry = (y / k2) | 0;
        for (let x = 0; x < TW; x++) {
          const ri = ry * RW + ((x / k2) | 0);
          if (raster.water[ri]) continue;
          // 白天:离建成区还远的格子,这一格对应的几列贴图像素一起跳过
          if (!night && mThr![ri] <= -8 && !(farmI![ri] > 0.01)) {
            x += k2 - 1 - (x % k2);
            continue;
          }
          const q = y * TW + x;
          // 夜里河道上不点灯(城中的河是一条暗线)。白天不挖:平面图上河叠在城区上面画;地球仪 / 弯边投影用挖过的那份(maskedTex)
          if (night && RM[q]) continue;
          // 建成没有:周围四格的"余量"双线性插值 + 一点贴图像素级的抖动 > 0
          const ow = G.own[ri];
          let built = false,
            zone = -1,
            mt = -50,
            mo = -50;
          // 只在边界带里(余量绝对值 ≤ 4)插值;离边界远的直接用本格的值(省时间)
          const t0 = mT[ri];
          if (t0 > -4) {
            // 边上的细碎起伏(第六十九轮加大:边缘不是光滑的弧)
            const jit = ((nzThr![q] - 1) / 254 - 0.5) * 1.6;
            mt = (t0 > 4 ? t0 : bil(mT, x, y)) + jit;
            if (mt > 0) {
              built = true;
              const o0 = mO[ri],
                c0 = mC[ri];
              mo = (Math.abs(o0) > 4 ? o0 : bil(mO, x, y)) + jit;
              zone = (Math.abs(c0) > 4 ? c0 : bil(mC, x, y)) + jit > 0 ? 2 : mo > 0 ? 1 : 0;
            }
          }
          const o = q * 4;
          if (!night) {
            // 第七十二轮:城市化强度 sc —— 生长余量上很宽的平滑坡(外 5 格起、里 3 格到顶),边上一点成片的起伏
            const jit2 = ((nzThr![q] - 1) / 254 - 0.5) * 1.2;
            const mtD = mT[ri] > -8 ? bil(mT, x, y) + jit2 : -50;
            let sc = 0,
              core = 0,
              old = 0;
            if (mtD > -5) {
              const u0 = Math.min(1, (mtD + 5) / 8);
              sc = u0 * u0 * (3 - 2 * u0);
              const cu = Math.min(1, Math.max(0, (bil(mC, x, y) + jit2 + 1.5) / 4));
              const ou = Math.min(1, Math.max(0, (bil(mO, x, y) + jit2 + 1.5) / 4));
              core = cu * cu * (3 - 2 * cu);
              old = ou * ou * (3 - 2 * ou);
              if (core < 0.5 && nzFlag![q] & 1) sc *= 0.6; // 郊区里成片的绿地
              sc *= 1 - 0.75 * Math.min(1, bil(steepArr!, x, y) / 0.35); // 城铺平原、河谷;山坡上留原色
            }
            const sf = farmI ? Math.min(1, bil(farmI, x, y)) * (1 - sc) : 0;
            if (sc < 0.01 && sf < 0.01) continue;
            // 城的颜色(只取色相、饱和度)和明暗(128 = 不变)
            const ind = nzFlag![q] & 2 && core < 0.5;
            let cr = 146 - 6 * core,
              cg = 143 - 5 * core,
              cb = 137 - 2 * core;
            if (ind) {
              cr = cg = 134;
              cb = 130;
            }
            let Lc = 128 + 50 - 6 * old - 14 * core + (ind ? 6 : 0);
            // 第六十八轮:挨过核打击的城 —— 炭黑夹灰烬;越近市中心越重,几十年里重建回来
            const rn = mtD > 0 ? ruinOf[ow] * (0.75 + 0.25 * Math.max(core, old)) : 0;
            if (rn > 0.03) {
              const ash = ph(x * 7 + 3, y * 5 + 1) < 0.35;
              cr += (122 - cr) * rn;
              cg += (118 - cg) * rn;
              cb += (114 - cb) * rn;
              Lc += ((ash ? 150 : 40) - Lc) * rn;
              sc = Math.max(sc, rn);
            }
            // 农田:按干湿往黄褐(干)/ 橄榄(湿)偏,略亮
            const wet = Math.min(1, Math.max(0, (raster.precip[ri] - 450) / 600));
            const fr = 178 - 70 * wet,
              fg = 158 - 18 * wet,
              fb = 96 - 34 * wet;
            const Lf = 146;
            const ac = sc * (0.86 + 0.1 * Math.max(core, old)),
              af = 0.7 * sf,
              A = 1 - (1 - ac) * (1 - af),
              wc = ac / Math.max(1e-6, ac + af * (1 - ac));
            const L = 128 + (Lc - 128) * sc + (Lf - 128) * sf;
            // 颜色贴图:色相、饱和度用混合色;亮度顺手存成 L(平面图 color 混合不看亮度;地球仪靠它取明暗)
            let r0 = cr * wc + fr * (1 - wc),
              g0 = cg * wc + fg * (1 - wc),
              b0 = cb * wc + fb * (1 - wc);
            const lum0 = 0.3 * r0 + 0.59 * g0 + 0.11 * b0;
            r0 += L - lum0;
            g0 += L - lum0;
            b0 += L - lum0;
            d[o] = r0;
            d[o + 1] = g0;
            d[o + 2] = b0;
            d[o + 3] = 255 * A;
            ld[o] = ld[o + 1] = ld[o + 2] = L;
            ld[o + 3] = 255;
            continue;
          }
          // 夜里:建成区就是亮区(城心偏白);外面是乡下的零星暗灯
          const u = uArr[ri];
          const cell = raster.cell[ri];
          const r = cell >= 0 ? R.of[cell] : -1;
          const e = r >= 0 ? elec(r) : 0;
          const lit = winter || dark.has(cell) || (built && ruinOf[ow] > 0.35) ? 0.03 : (0.06 + 0.94 * e) * (built ? 1 - 0.8 * ruinOf[ow] : 1);
          let b: number, w: number;
          if (built) {
            // 第六十九轮:边缘的灯渐稀
            if (ph(x, y) >= (zone === 2 ? 0.97 : zone === 1 ? 0.9 : 0.8) * Math.min(1, 0.2 + mt / 2)) continue;
            b = lit * (zone === 2 ? 1 : zone === 1 ? 0.85 : 0.65) * (0.75 + 0.5 * ph(x + 7, y + 3));
            w = zone === 2 ? 0.85 : zone === 1 ? 0.5 : 0.15;
          } else {
            if (u < 0.02 || ph(x, y) >= Math.min(1, u * u * 1.6 + u * 0.25) * 0.5) continue;
            b = lit * 0.35 * (0.4 + 0.6 * u) * (0.7 + 0.6 * ph(x + 7, y + 3));
            w = 0;
          }
          if (b < 0.02) continue;
          // 钠灯的橙黄;城心偏淡黄白
          d[o] = 255;
          d[o + 1] = 168 + 72 * w;
          d[o + 2] = 72 + 128 * w;
          d[o + 3] = 255 * Math.min(1, b);
        }
      }
      // 路(第五十五轮:按地形细化过的路线,和地图的道路图层同一份):夜里沿路一串暖光;白天不画(路归地图的道路图层)
      if (night && !winter) {
        const RL = routeLines(world.mesh, c, year, T);
        const sx = (raster.w / world.width) * k2,
          sy = (raster.h / world.height) * k2;
        for (const [list, w0] of [
          [RL.road, 1],
          [RL.trail, 0.5],
        ] as const)
          for (const l of list) {
            const P = l.pts;
            const m = P.length / 2;
            const ra = R.of[world.mesh.n > 0 ? nearCell(P[0], P[1]) : 0],
              rb = R.of[nearCell(P[P.length - 2], P[P.length - 1])];
            const e = ((ra >= 0 ? elec(ra) : 0) + (rb >= 0 ? elec(rb) : 0)) / 2;
            if (e < 0.05) continue;
            for (let k = 1; k < m; k++) {
              let x0 = P[(k - 1) * 2] * sx,
                y0 = P[(k - 1) * 2 + 1] * sy,
                x1 = P[k * 2] * sx,
                y1 = P[k * 2 + 1] * sy;
              x0 = ((x0 % TW) + TW) % TW;
              x1 = x0 + (x1 - P[(k - 1) * 2] * sx);
              const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
              for (let st = 0; st <= steps; st++) {
                const px = Math.round(x0 + ((x1 - x0) * st) / (steps || 1)),
                  py = Math.round(y0 + ((y1 - y0) * st) / (steps || 1));
                const qx = ((px % TW) + TW) % TW;
                if (py < 0 || py >= TH) continue;
                // 隔一两像素一盏(不连成实线)
                if (ph(qx, py) < 0.45) continue;
                const o = (py * TW + qx) * 4;
                const al = 150 * e * w0 * (0.6 + 0.4 * ph(qx + 5, py));
                if (d[o + 3] < al) {
                  d[o] = 255;
                  d[o + 1] = 165;
                  d[o + 2] = 75;
                  d[o + 3] = al;
                }
              }
            }
          }
      }
      tg.putImageData(img, 0, 0);
      texMDirty = true;
      if (limg) lg.putImageData(limg, 0, 0);
      else lg.clearRect(0, 0, TW, TH);
      // 光晕:缩小 8 倍的一份,显示时平滑放大、淡淡叠上
      gg.clearRect(0, 0, glow.width, glow.height);
      gg.imageSmoothingEnabled = true;
      gg.imageSmoothingQuality = 'high';
      gg.drawImage(tex, 0, 0, glow.width, glow.height);
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      const tc = toClient.current;
      if (!cv || !ctx || !tc) return;
      const rect = cv.getBoundingClientRect();
      const year = getCivTime().year ?? c.endYear;
      // 播放时每 10 年重算一次贴图(每年一次很卡),停下来再按那一年
      const playing = getCivTime().playing;
      const tk = `${playing ? Math.floor(year / 10) * 10 : Math.floor(year)}|${night}|${playing ? 'p' : 's'}`;
      const p0 = tc(world.width * 0.25, world.height * 0.5),
        p1 = tc(world.width * 0.75, world.height * 0.3);
      const s = `${tk}|${p0?.map((v) => v.toFixed(1))}|${p1?.map((v) => v.toFixed(1))}|${rect.width}x${rect.height}|${urban}`;
      if (s === sig) return;
      sig = s;
      if (tk !== texKey) {
        bake(year);
        texKey = tk;
        // 城区换了:城区上面的河要按新城区重画
        rvForce = true;
        // 第六十九轮:地球仪上贴图交给球画(白天用挖过河道的那份)
        if (globe) setGlobeCity(night ? tex : maskedTex(), night ? 2 : 1);
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      if (night && !globe) {
        // 深蓝黑:陆地、海岸在"月光"下还隐约看得见
        ctx.fillStyle = 'rgba(3,7,20,0.8)';
        ctx.fillRect(0, 0, rect.width, rect.height);
      }
      // ---- 按地图投影把贴图一块块仿射贴上去 ----
      // 平面图:世界坐标 → 屏幕是线性的(平移 + 缩放),整张贴图一次贴上(左右接缝多贴一份),不切三角(切三角每次九千多下,拖地图很卡)
      const W = world.width,
        H = world.height;
      const c0 = tc(W * 0.5, H * 0.5),
        cX = tc(W * 0.5 + 1, H * 0.5),
        cY = tc(W * 0.5, H * 0.5 + 1);
      let affine: { ox: number; oy: number; kx: number; ky: number } | null = null;
      if (c0 && cX && cY && Math.abs(cX[1] - c0[1]) < 1e-3 && Math.abs(cY[0] - c0[0]) < 1e-3) {
        const kx = cX[0] - c0[0],
          ky = cY[1] - c0[1];
        const ox = c0[0] - rect.left - kx * W * 0.5,
          oy = c0[1] - rect.top - ky * H * 0.5;
        // 再拿两点核对(弯边投影就对不上)
        const t1 = tc(W * 0.3, H * 0.2),
          t2 = tc(W * 0.7, H * 0.85);
        const ok = (q: [number, number] | null, wx: number, wy: number) => {
          if (!q) return true;
          const ex = ox + kx * wx,
            ey = oy + ky * wy;
          const dx = q[0] - rect.left - ex,
            dy = q[1] - rect.top - ey;
          const dxw = Math.abs(dx) % Math.abs(kx * W);
          return Math.abs(dy) < 1.5 && (dxw < 1.5 || Math.abs(dxw - Math.abs(kx * W)) < 1.5);
        };
        if (kx > 0 && ky > 0 && ok(t1, W * 0.3, H * 0.2) && ok(t2, W * 0.7, H * 0.85)) affine = { ox, oy, kx, ky };
      }
      const GX = 64,
        GY = 32;
      const pts: ([number, number] | null)[] = [];
      for (let j = 0; j <= GY; j++)
        for (let i = 0; i <= GX; i++) {
          const q = tc(Math.min(world.width * 0.99999, (i / GX) * world.width), (j / GY) * world.height);
          pts.push(q ? [q[0] - rect.left, q[1] - rect.top] : null);
        }
      /** 图上三点 → 屏上三点的仿射,贴一个三角(稍微外扩半像素,拼缝看不出) */
      const tri = (img: HTMLCanvasElement, a: [number, number], b: [number, number], cc: [number, number], ua: [number, number], ub: [number, number], uc: [number, number], smooth: boolean, g2: CanvasRenderingContext2D = ctx) => {
        const sw = img.width,
          sh = img.height;
        const x0 = ua[0] * sw,
          y0 = ua[1] * sh,
          x1 = ub[0] * sw,
          y1 = ub[1] * sh,
          x2 = uc[0] * sw,
          y2 = uc[1] * sh;
        const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (Math.abs(den) < 1e-9) return;
        // 解 [a b c] = M · [x y 1]
        const m11 = ((b[0] - a[0]) * (y2 - y0) - (cc[0] - a[0]) * (y1 - y0)) / den;
        const m12 = ((cc[0] - a[0]) * (x1 - x0) - (b[0] - a[0]) * (x2 - x0)) / den;
        const m21 = ((b[1] - a[1]) * (y2 - y0) - (cc[1] - a[1]) * (y1 - y0)) / den;
        const m22 = ((cc[1] - a[1]) * (x1 - x0) - (b[1] - a[1]) * (x2 - x0)) / den;
        const dx = a[0] - m11 * x0 - m12 * y0,
          dy = a[1] - m21 * x0 - m22 * y0;
        const cxm = (a[0] + b[0] + cc[0]) / 3,
          cym = (a[1] + b[1] + cc[1]) / 3;
        const grow = (p: [number, number]): [number, number] => {
          const ex = p[0] - cxm,
            ey = p[1] - cym,
            l = Math.hypot(ex, ey) || 1;
          return [p[0] + (ex / l) * 0.6, p[1] + (ey / l) * 0.6];
        };
        const A = grow(a),
          B = grow(b),
          Cc = grow(cc);
        g2.save();
        g2.beginPath();
        g2.moveTo(A[0], A[1]);
        g2.lineTo(B[0], B[1]);
        g2.lineTo(Cc[0], Cc[1]);
        g2.closePath();
        g2.clip();
        g2.transform(m11, m21, m12, m22, dx, dy);
        g2.imageSmoothingEnabled = smooth;
        g2.drawImage(img, 0, 0);
        g2.restore();
      };
      const draw = (img: HTMLCanvasElement, smooth: boolean, g2: CanvasRenderingContext2D = ctx) => {
        if (affine) {
          const { ox, oy, kx, ky } = affine;
          const ww = kx * W;
          g2.imageSmoothingEnabled = smooth;
          for (let k = -2; k <= 2; k++) {
            const x0 = ox + k * ww;
            if (x0 > rect.width || x0 + ww < 0) continue;
            g2.drawImage(img, x0, oy, ww, ky * H);
          }
          return;
        }
        for (let j = 0; j < GY; j++)
          for (let i = 0; i < GX; i++) {
            const p00 = pts[j * (GX + 1) + i],
              p10 = pts[j * (GX + 1) + i + 1],
              p01 = pts[(j + 1) * (GX + 1) + i],
              p11 = pts[(j + 1) * (GX + 1) + i + 1];
            if (!p00 || !p10 || !p01 || !p11) continue;
            const mnx = Math.min(p00[0], p10[0], p01[0], p11[0]),
              mxx = Math.max(p00[0], p10[0], p01[0], p11[0]);
            const mny = Math.min(p00[1], p10[1], p01[1], p11[1]),
              mxy = Math.max(p00[1], p10[1], p01[1], p11[1]);
            // 跨接缝的(一格横跨半个屏)、整格在屏外的跳过
            if (mxx - mnx > rect.width / 2 || mxx < 0 || mnx > rect.width || mxy < 0 || mny > rect.height) continue;
            const u0 = i / GX,
              u1 = (i + 1) / GX,
              v0 = j / GY,
              v1 = (j + 1) / GY;
            tri(img, p00, p10, p01, [u0, v0], [u1, v0], [u0, v1], smooth, g2);
            tri(img, p10, p11, p01, [u1, v0], [u1, v1], [u0, v1], smooth, g2);
          }
      };
      if (night && !globe) {
        ctx.globalCompositeOperation = 'lighter';
        // 光晕越放大越淡(近看要的是一粒粒的灯,不是一团光)
        const a0 = pts[(GY >> 1) * (GX + 1) + (GX >> 1)],
          a1 = pts[(GY >> 1) * (GX + 1) + (GX >> 1) + 1];
        const texelPx = a0 && a1 ? Math.abs(a1[0] - a0[0]) / (TW / GX) : 1;
        ctx.globalAlpha = 0.35 * Math.max(0.08, Math.min(1, 1.2 / Math.max(0.01, texelPx)));
        draw(glow, true);
        ctx.globalAlpha = 1;
      }
      // 白天的城区是平滑色块:放大时插值(不出台阶);夜里的灯不插值(一粒粒)
      // 第七十二轮:白天 —— ccanvas 按 soft-light 调明暗(加细颗粒),tcanvas 按 color 换色相饱和度;都不盖住底图
      {
        const cc = ccanvas.current,
          tcv = tcanvas.current;
        const cctx = cc?.getContext('2d'),
          tctx = tcv?.getContext('2d');
        if (cc && cctx && tcv && tctx) {
          for (const c2 of [cc, tcv])
            if (c2.width !== cv.width || c2.height !== cv.height) {
              c2.width = cv.width;
              c2.height = cv.height;
            }
          for (const g2 of [cctx, tctx]) {
            g2.setTransform(dpr, 0, 0, dpr, 0, 0);
            g2.clearRect(0, 0, rect.width, rect.height);
          }
          if (!night && !globe) {
            const mt2 = maskedTex();
            draw(mt2, true, tctx);
            draw(ltex, true, cctx);
            // 颗粒:只在城、田上(按颜色贴图的不透明度),图案跟着地图平移
            if (!gcv) gcv = document.createElement('canvas');
            if (gcv.width !== cv.width || gcv.height !== cv.height) {
              gcv.width = cv.width;
              gcv.height = cv.height;
            }
            const gx = gcv.getContext('2d')!;
            gx.setTransform(1, 0, 0, 1, 0, 0);
            gx.globalCompositeOperation = 'source-over';
            gx.clearRect(0, 0, gcv.width, gcv.height);
            const pat = gx.createPattern(grain, 'repeat');
            if (pat) {
              const ox = affine ? Math.round(affine.ox * dpr) : 0,
                oy = affine ? Math.round(affine.oy * dpr) : 0;
              gx.save();
              gx.translate(ox % 128, oy % 128);
              gx.fillStyle = pat;
              gx.fillRect(-128, -128, gcv.width + 256, gcv.height + 256);
              gx.restore();
              gx.setTransform(dpr, 0, 0, dpr, 0, 0);
              gx.globalCompositeOperation = 'destination-in';
              draw(mt2, true, gx);
              gx.setTransform(1, 0, 0, 1, 0, 0);
              cctx.save();
              cctx.setTransform(1, 0, 0, 1, 0, 0);
              cctx.globalCompositeOperation = 'soft-light';
              cctx.globalAlpha = 0.5;
              cctx.drawImage(gcv, 0, 0);
              cctx.restore();
            }
          }
        }
      }
      if (!globe && night) draw(tex, false);
      // 第六十二轮:河画在城区上面(好比城区插在地形和河之间)—— 平面图上按地图当前的视口、缩放(window.__wfView.k),
      // 用卫星底图同一个画河的函数(放大后连小溪)重画一遍,只留落在城区上的那部分;河宽、条数、河岸、河口都和底图一样
      // 第七十二轮:城区不再盖住底图,原来"城区上面重画河"那一步去掉了(底图的河本来就在)
      // ---- 放大以后:城里的街道(从城心、进城的路长出来;夜里灯沿街排,白天淡淡的街道线)----
      const q0 = tc(world.width * 0.5, world.height * 0.5),
        q1 = tc(world.width * 0.5 + sp, world.height * 0.5);
      const cellPx = q0 && q1 ? Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) : 0;
      if (cellPx > 10) {
        const fade = Math.min(1, (cellPx - 10) / 16);
        const L = (wx: number, wy: number): [number, number] | null => {
          const q = tc(wx, wy);
          return q ? [q[0] - rect.left, q[1] - rect.top] : null;
        };
        // 夜里的街灯分档攒起来最后一起画:城区密度 4 档 × 亮度 10 档,每档一种颜色、一条路径
        const lamps = new Map<number, number[]>();
        const RW = rect.width,
          RH = rect.height;
        c.settlements.forEach((st, si) => {
          const pop = popsNow[si] ?? 0;
          if (pop < 60) return;
          const [wx, wy] = cityPos(world, raster, st.cell);
          const q = L(wx, wy);
          const reachPx = cellPx * 4;
          if (!q || q[0] < -reachPx || q[1] < -reachPx || q[0] > rect.width + reachPx || q[1] > rect.height + reachPx) return;
          const band = Math.round(Math.log2(pop / 30));
          let sc = streetCache.get(si);
          if (!sc || sc.band !== band) {
            const dirs = [cityAng[si], cityAng[si] + Math.PI / 2 + (ph(si, 3) - 0.5) * 0.5];
            // 城的半径(世界单位):人口一百万约 0.6 个地块间距,一千万约 1.2 个
            const radius = sp * Math.max(0.35, 0.6 * Math.sqrt(pop / 1000));
            const lines = cityStreets([wx, wy], dirs, urbanAt, T, sp / 7, Math.round(40 + 60 * Math.log10(pop / 30)), si * 977 + 13, radius);
            streetCache.set(si, (sc = { band, lines }));
          }
          // 城附近一两格的范围里投影近似线性:城心 + 往东 / 往南一格各投一次,街道点按这个换算
          const qx = L(wx + sp, wy),
            qy = L(wx, wy + sp);
          const lin = qx && qy && Math.abs(qx[0] - q[0]) < rect.width / 3 && Math.abs(qy[0] - q[0]) < rect.width / 3;
          const ax = lin ? (qx![0] - q[0]) / sp : 0,
            ay = lin ? (qx![1] - q[1]) / sp : 0;
          const bx = lin ? (qy![0] - q[0]) / sp : 0,
            by = lin ? (qy![1] - q[1]) / sp : 0;
          const Lc = (x: number, y: number): [number, number] | null => (lin ? [q[0] + (x - wx) * ax + (y - wy) * bx, q[1] + (x - wx) * ay + (y - wy) * by] : L(x, y));
          for (const ln of sc.lines) {
            const pts: ([number, number] | null)[] = [];
            for (let k = 0; k < ln.length / 2; k++) pts.push(Lc(ln[k * 2], ln[k * 2 + 1]));
            if (night) {
              // 沿街每隔 3 像素一盏,城心亮
              for (let k = 1; k < pts.length; k++) {
                const A = pts[k - 1],
                  B = pts[k];
                if (!A || !B) continue;
                const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
                if (len > rect.width / 3) continue;
                // 整段在画面外:跳过
                if ((A[0] < -2 && B[0] < -2) || (A[1] < -2 && B[1] < -2) || (A[0] > RW + 2 && B[0] > RW + 2) || (A[1] > RH + 2 && B[1] > RH + 2)) continue;
                const u = urbanAt(ln[k * 2], ln[k * 2 + 1]);
                const ui = Math.max(0, Math.min(3, Math.round(u * 3)));
                const n = Math.max(1, Math.floor(len / 3));
                for (let j = 0; j < n; j++) {
                  const t = j / n;
                  const x = A[0] + (B[0] - A[0]) * t,
                    y = A[1] + (B[1] - A[1]) * t;
                  if (x < -1 || y < -1 || x > RW + 1 || y > RH + 1) continue;
                  const al = fade * (0.35 + 0.6 * u) * (0.6 + 0.4 * ph(Math.round(x), Math.round(y)));
                  const ai = Math.max(1, Math.min(10, Math.round(al * 10)));
                  const key = ui * 16 + ai;
                  let arr = lamps.get(key);
                  if (!arr) lamps.set(key, (arr = []));
                  arr.push(x, y);
                }
              }
            } else {
              ctx.strokeStyle = `rgba(78,75,70,${(fade * 0.35).toFixed(3)})`;
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              let on = false;
              for (let k = 0; k < pts.length; k++) {
                const P = pts[k];
                if (!P) {
                  on = false;
                  continue;
                }
                if (on) ctx.lineTo(P[0], P[1]);
                else ctx.moveTo(P[0], P[1]);
                on = true;
              }
              ctx.stroke();
            }
          }
        });
        for (const [key, arr] of lamps) {
          const u = (key >> 4) / 3,
            al = (key & 15) / 10;
          ctx.fillStyle = `rgba(255,${Math.round(190 + 50 * u)},${Math.round(100 + 110 * u)},${al.toFixed(2)})`;
          ctx.beginPath();
          for (let i = 0; i < arr.length; i += 2) ctx.rect(arr[i] - 0.7, arr[i + 1] - 0.7, 1.4, 1.4);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(rvTimer);
      if (globe) setGlobeCity(null, 0);
    };
  }, [show, data, world, raster, toClient, urban, night, globe]);
  if (!show) return null;
  return (
    <>
      <canvas ref={ccanvas} className="wonder-layer" aria-hidden="true" style={!globe && !night ? { mixBlendMode: 'soft-light' } : undefined} />
      <canvas ref={tcanvas} className="wonder-layer" aria-hidden="true" style={!globe && !night ? { mixBlendMode: 'color' } : undefined} />
      <canvas ref={canvas} className="wonder-layer" aria-hidden="true" />
    </>
  );
}
