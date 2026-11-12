/**
 * 本地分支 modern-pace 第四十四轮:核打击留下的痕迹(NukeLayer 只演那一刻,这里管之后几十上百年)。只读史事 nuke,不改推演。
 *
 * 第六十七轮(用户"核爆的污染有点卡通"):整层正片叠底(只让底图变暗、变褐);焦土是噪声起伏的不规则一块(中心炭黑、外圈灰烬),
 *   落尘画成下风方向弯曲的植被枯死带(不再是黄椭圆),头一年加一条顺风的烟带,弹坑放大到看得出才画,
 *   核冬天是一团团的烟尘云(先在打核战的纬度带,几年里扩到全球、往东飘)。年份、视角变了才重画。以下是原来的说明:
 *   - 弹坑:每一发命中的(战术核 n = 1、战略核 n = 2 且没被拦下)在那州的治所留一块焦黑的坑,中心玻璃化;
 *     大小按当量(oob[0] kt,战术核按 10 kt)的立方根;头三十年很黑,之后慢慢淡,两百年以后只剩一点疤。
 *   - 烧焦带:坑外一圈褐色,十五年里长回去。
 *   - 落尘区:顺着当地的盛行风拖一条长椭圆(中纬度西风往东、低纬和高纬的东风往西),长短按当量;
 *     头几年最浓,按"七倍时间、十分之一剂量"那样衰减,剩下的低剂量禁区留五十年,一百年淡完。
 *   - 核冬天(n = 4,oob[0] = 持续几年):整张图罩一层灰褐的尘幕,头一年最浓,到期前后淡掉。
 * 公里换世界坐标按母星半径 6371 km(世界宽 = 赤道周长)。平面图、地球仪都用 App 给的世界坐标 → 屏幕换算(地球仪上转到背面的不画)。
 * 小于两像素的坑照两像素画,缩小看也找得到落点。
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { cityPos } from '../render/civ/cityPos';
import { populationAt } from '../gen/civ/growth';
import { worldToLonLat } from '../render/globe';
import { getCivTime } from './civView';
import type { WorldToClient } from './EventPins';
import type { GlobeApi } from './Globe';
import { setGlobeScar } from './globeCity';
import './timeline.css';

const R_KM = 6371;

interface Scar {
  year: number;
  wx: number;
  wy: number;
  /** 弹坑、烧焦带半径,落尘区长、宽(公里) */
  crater: number;
  burn: number;
  fallL: number;
  fallW: number;
  /** 落尘往哪吹(世界坐标里的单位向量,x 向东) */
  dx: number;
  /** 第几发(噪声的相位);哪场战争 */
  k: number;
  war: number;
}

interface Winter {
  from: number;
  to: number;
  /** 打核战的纬度(度,各发命中的平均) */
  lat: number;
}

export interface NukeScarLayerProps {
  civ: Civ | null;
  world: World;
  toClient: MutableRefObject<WorldToClient | null>;
  globe?: MutableRefObject<GlobeApi | null> | null;
  hidden?: boolean;
  /** 第六十七轮:底图的水陆图(焦土、枯死带只留在陆地上) */
  raster?: Raster;
}

export function NukeScarLayer({ civ, world, toClient, hidden, raster, globe }: NukeScarLayerProps) {
  /** 第七十四轮:地球仪上 —— 画到经纬度贴图,交给球的着色器 */
  const onGlobe = !!globe;
  const data = useMemo(() => {
    const scars: Scar[] = [];
    const winters: Winter[] = [];
    if (!civ || !civ.viable) return { scars, winters };
    const c = civ.history ?? civ;
    for (const a of c.annals) {
      if (a.kind !== 'nuke') continue;
      if (a.n === 4) {
        const dur = Math.max(1, a.oob?.[0] ?? 3);
        let sl = 0,
          sn = 0;
        for (const q of scars) if (q.war === a.war) (sl += (90 - (180 * q.wy) / world.height)), sn++;
        winters.push({ from: a.year, to: a.year + dur, lat: sn ? sl / sn : 35 });
        continue;
      }
      if (a.n !== 1 && a.n !== 2) continue;
      if (a.n === 2 && a.oob?.[2]) continue; // 被拦下了
      // 第六十七轮:打城的(战略核 wave 2)画在那座城上;打州的(军事目标、前线、战术核)画在那州境内按这一发定的一块地上
      // (原来一律画在州的治所 —— 治所正好是座废城的,废城平白又挨一发)
      const wave = a.n === 2 ? (a.oob?.[3] ?? 2) : 1;
      let cell = -1;
      if (a.n === 2 && wave === 2 && a.settlement >= 0 && c.settlements[a.settlement]) cell = c.settlements[a.settlement].cell;
      else if (a.region >= 0) {
        const n0 = c.regions.cellStart[a.region],
          n1 = c.regions.cellStart[a.region + 1];
        const hv = Math.sin(a.year * 12.9898 + scars.length * 78.233) * 43758.5453;
        cell = n1 > n0 ? c.regions.cells[n0 + Math.floor((hv - Math.floor(hv)) * (n1 - n0))] : c.regions.seat[a.region];
      }
      if (cell < 0 || cell >= world.mesh.n) continue;
      const kt = a.n === 2 ? Math.max(1, a.oob?.[0] ?? 300) : 10;
      const cube = Math.cbrt(kt);
      // 第六十七轮:和城镇符号同一个位置(地块中心落在底图的水里就挪到最近的陆地上)
      const [wx, wy] = cityPos(world, raster, cell);
      const lat = (worldToLonLat(wx, wy, world.width, world.height)[1] * 180) / Math.PI;
      // 盛行风:中纬度(30°–60°)西风往东吹;低纬信风、高纬极地东风往西吹
      const west = Math.abs(lat) >= 30 && Math.abs(lat) < 60;
      // 第六十八轮:打城的,焦土至少盖住整座城(和城区层同一口径:人口 × 300 m² × 27 倍放大)
      let burn = 4 * cube;
      if (a.n === 2 && wave === 2 && a.settlement >= 0 && c.settlements[a.settlement]) {
        const pop = populationAt(c.settlements[a.settlement], a.year - 0.01);
        burn = Math.max(burn, 0.85 * Math.sqrt((pop * 0.3 * 27) / Math.PI));
      }
      scars.push({ year: a.year, wx, wy, crater: 0.9 * cube, burn, fallL: 25 * Math.pow(kt, 0.45), fallW: 25 * Math.pow(kt, 0.45) * 0.18, dx: west ? 1 : -1, k: scars.length, war: a.war });
    }
    return { scars, winters };
  }, [civ, world, raster]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const show = !hidden && (data.scars.length > 0 || data.winters.length > 0);

  useEffect(() => {
    if (!show) return;
    let raf = 0;
    let sig = '';
    // 陆地蒙版(主图栅格大小,陆地不透明);第一次要用时画;ms = 屏幕大小的拼好的蒙版
    let land: HTMLCanvasElement | null = null;
    let ms: HTMLCanvasElement | null = null;
    const landMask = () => {
      if (land || !raster) return land;
      land = document.createElement('canvas');
      land.width = raster.w;
      land.height = raster.h;
      const lg = land.getContext('2d')!;
      const im = lg.createImageData(raster.w, raster.h);
      for (let i = 0; i < raster.w * raster.h; i++) if (!raster.water[i]) im.data[i * 4 + 3] = 255;
      lg.putImageData(im, 0, 0);
      return land;
    };
    const isWater = (wx: number, wy: number) => {
      if (!raster) return false;
      const ix = Math.floor(((((wx % world.width) + world.width) % world.width) * raster.w) / world.width);
      const iy = Math.min(raster.h - 1, Math.max(0, Math.floor((wy * raster.h) / world.height)));
      return raster.water[iy * raster.w + Math.min(raster.w - 1, ix)] !== 0;
    };
    const kmW = world.width / (2 * Math.PI * R_KM);
    // 第七十四轮:地球仪 —— 经纬度贴图(4096 × 2048),接缝左右各补画一份(shift = −1 / 0 / 1)
    const GW = 4096,
      GH = 2048;
    let gt: HTMLCanvasElement | null = null;
    let shift = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const year = getCivTime().year ?? civ?.endYear ?? 0;
      let cv: HTMLCanvasElement,
        ctx: CanvasRenderingContext2D,
        rect: { left: number; top: number; width: number; height: number },
        dpr: number,
        L: (wx: number, wy: number) => [number, number] | null;
      const tc = toClient.current;
      if (onGlobe) {
        // 年份变了才重画(播放时按 0.25 年,停着按 0.05 年);和视角无关
        const sg = `${Math.round(year * (getCivTime().playing ? 4 : 20))}`;
        if (sg === sig) return;
        sig = sg;
        if (!gt) {
          gt = document.createElement('canvas');
          gt.width = GW;
          gt.height = GH;
        }
        cv = gt;
        ctx = gt.getContext('2d')!;
        rect = { left: 0, top: 0, width: GW, height: GH };
        dpr = 1;
        L = (wx, wy) => [(wx / world.width + shift) * GW, (wy / world.height) * GH];
      } else {
        const cv0 = canvas.current;
        const ctx0 = cv0?.getContext('2d');
        if (!cv0 || !ctx0 || !tc) return;
        cv = cv0;
        ctx = ctx0;
        rect = cv.getBoundingClientRect();
        dpr = Math.min(2, window.devicePixelRatio || 1);
        if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
          cv.width = Math.round(rect.width * dpr);
          cv.height = Math.round(rect.height * dpr);
        }
        // 年份(播放时按 0.05 年)、视角变了才重画
        const p0 = tc(world.width * 0.25, world.height * 0.5),
          p1 = tc(world.width * 0.75, world.height * 0.3);
        const sg = `${Math.round(year * 20)}|${p0?.map((v) => v.toFixed(1))}|${p1?.map((v) => v.toFixed(1))}|${rect.width}x${rect.height}`;
        if (sg === sig) return;
        sig = sg;
        const r0 = rect;
        L = (wx, wy) => {
          const q = tc(wx, wy);
          return q ? [q[0] - r0.left, q[1] - r0.top] : null;
        };
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const h = (k: number, u: number) => {
        const v = Math.sin(k * 12.9898 + u * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      /** 以 (wx, wy) 为心、沿风向偏 (ex, ey) 公里那一点 */
      const at = (sc: Scar, ex: number, ey: number) => {
        const coslat = Math.max(0.15, Math.sin((Math.PI * sc.wy) / world.height));
        return L(sc.wx + (ex * kmW) / coslat, sc.wy + ey * kmW);
      };
      /** 公里 → 屏幕像素(那一点附近) */
      const pxPerKm = (sc: Scar) => {
        const c0 = L(sc.wx, sc.wy),
          c1 = L(sc.wx + kmW, sc.wy);
        return c0 && c1 ? Math.hypot(c1[0] - c0[0], c1[1] - c0[1]) : 0;
      };
      const blob = (x: number, y: number, r: number, rgb: string, al: number) => {
        if (r < 0.4 || al < 0.004) return;
        const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, `rgba(${rgb},${al.toFixed(3)})`);
        gr.addColorStop(0.6, `rgba(${rgb},${(al * 0.6).toFixed(3)})`);
        gr.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = gr;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      };
      for (const sh of onGlobe ? [-1, 0, 1] : [0])
      for (const sc of data.scars) {
        shift = sh;
        const age = year - sc.year;
        if (age < 0) continue;
        const c0 = L(sc.wx, sc.wy);
        if (!c0 || c0[0] < -300 || c0[1] < -300 || c0[0] > rect.width + 300 || c0[1] > rect.height + 300) continue;
        const kpx = pxPerKm(sc);
        if (!(kpx > 0)) continue;
        // ---- 烟柱:头一年顺风飘散的灰黑烟带(越往下风越宽、越淡)----
        if (age < 1) {
          const L1 = sc.fallL * 2.2;
          for (let j = 0; j < 14; j++) {
            const f = j / 13;
            const lat = Math.sin(f * 5 + sc.k) * sc.fallW * 0.8 * f;
            const q = at(sc, f * L1 * sc.dx, lat);
            if (q) blob(q[0], q[1], Math.max(2, (sc.burn * 0.8 + f * sc.fallW * 2.2) * kpx), '70,70,74', 0.55 * (1 - age) * (1 - 0.7 * f));
          }
        }
        // ---- 落尘:下风方向一条弯弯曲曲的植被枯死带(褐),头几年明显、二十五年淡完 ----
        const fall = age < 25 ? Math.pow(1 - age / 25, 1.5) : 0;
        if (fall > 0.01) {
          for (let j = 0; j < 18; j++) {
            const f = (j + 0.5) / 18;
            const lat = (Math.sin(f * 4.2 + sc.k * 1.7) * 0.7 + (h(sc.k, j) - 0.5) * 0.5) * sc.fallW * (0.4 + f);
            const q = at(sc, f * sc.fallL * sc.dx, lat);
            if (q) blob(q[0], q[1], Math.max(1.5, sc.fallW * (1.1 - 0.6 * f) * kpx * (0.8 + 0.4 * h(sc.k, j + 50))), '200,168,120', 0.55 * fall * (1 - 0.5 * f));
          }
        }
        // ---- 焦土:不规则的一块,中心炭黑、外圈灰烬;头几年黑,二三十年后只剩一块略深的疤,八十年没了 ----
        const burnA = age < 80 && !isWater(sc.wx, sc.wy) ? 0.8 * Math.exp(-age / 12) + 0.12 * (1 - age / 80) : 0;
        if (burnA > 0.01) {
          const r = Math.max(1.5, sc.burn * kpx);
          const pts: [number, number][] = [];
          for (let j = 0; j < 30; j++) {
            const t = (j / 30) * Math.PI * 2;
            const rr = r * (0.72 + 0.18 * Math.sin(3 * t + sc.k) + 0.12 * Math.sin(7 * t + 2 * sc.k) + 0.1 * (h(sc.k, j + 100) - 0.5));
            pts.push([c0[0] + Math.cos(t) * rr, c0[1] + Math.sin(t) * rr]);
          }
          // 外圈灰烬
          ctx.fillStyle = `rgba(178,172,162,${(burnA * 0.8).toFixed(3)})`;
          ctx.beginPath();
          pts.forEach((p, i) => {
            const x = c0[0] + (p[0] - c0[0]) * 1.18,
              y = c0[1] + (p[1] - c0[1]) * 1.18;
            if (i) ctx.lineTo(x, y);
            else ctx.moveTo(x, y);
          });
          ctx.closePath();
          ctx.fill();
          // 焦黑:中心最深
          const gr = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], r);
          gr.addColorStop(0, `rgba(38,32,28,${burnA.toFixed(3)})`);
          gr.addColorStop(1, `rgba(92,80,70,${(burnA * 0.85).toFixed(3)})`);
          ctx.fillStyle = gr;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.closePath();
          ctx.fill();
        }
        // ---- 弹坑:放大到看得出(半径 ≥ 1.5 像素)才画 ----
        const cr = sc.crater * kpx;
        if (cr >= 1.5) {
          const ca = age < 30 ? 0.9 : Math.max(0.2, 0.9 - ((age - 30) / 170) * 0.7);
          ctx.fillStyle = `rgba(30,26,24,${ca.toFixed(3)})`;
          ctx.beginPath();
          ctx.arc(c0[0], c0[1], cr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      shift = 0;
      // 第七十四轮:地球仪贴图 —— 蒙版直接按贴图大小贴
      const lmG = onGlobe ? landMask() : null;
      if (lmG) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(lmG, 0, 0, GW, GH);
        ctx.restore();
      }
      // ---- 平面图:焦土、枯死带、烟带只留在陆地上(按底图的水陆图裁;核冬天的烟尘云在这之后画,海上也有)----
      if (!onGlobe && tc) {
        const W = world.width,
          H = world.height;
        const c0 = tc(W * 0.5, H * 0.5),
          cX = tc(W * 0.5 + 1, H * 0.5),
          cY = tc(W * 0.5, H * 0.5 + 1);
        const lm = landMask();
        if (lm && c0 && cX && cY && Math.abs(cX[1] - c0[1]) < 1e-3 && Math.abs(cY[0] - c0[0]) < 1e-3) {
          const kx = cX[0] - c0[0],
            ky = cY[1] - c0[1];
          const ox = c0[0] - rect.left - kx * W * 0.5,
            oy = c0[1] - rect.top - ky * H * 0.5;
          const ww = kx * W;
          // 平面图左右相连:几份蒙版先拼到一张屏幕大小的画布上,再一次 destination-in(连着贴几次的话后一次会把前一份清掉)
          if (!ms) ms = document.createElement('canvas');
          if (ms.width !== cv.width || ms.height !== cv.height) {
            ms.width = cv.width;
            ms.height = cv.height;
          }
          const mg = ms.getContext('2d')!;
          mg.setTransform(dpr, 0, 0, dpr, 0, 0);
          mg.clearRect(0, 0, rect.width, rect.height);
          mg.imageSmoothingEnabled = true;
          for (let k = -2; k <= 2; k++) {
            const x0 = ox + k * ww;
            if (x0 > rect.width || x0 + ww < 0) continue;
            mg.drawImage(lm, x0, oy, ww, ky * H);
          }
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'destination-in';
          ctx.drawImage(ms, 0, 0);
          ctx.restore();
        }
      }
      // ---- 核冬天:一团团的烟尘云 —— 先在打核战的纬度带,几年里扩到全球、往东飘、变稀 ----
      for (const sh of onGlobe ? [-1, 0, 1] : [0])
      for (const wi of data.winters) {
        shift = sh;
        if (year < wi.from || year > wi.to + 2) continue;
        const dur = Math.max(1, wi.to - wi.from);
        const f = Math.min(1, (year - wi.from) / dur);
        const up = Math.min(1, (year - wi.from) / 0.3);
        const down = year > wi.to ? 1 - (year - wi.to) / 2 : 1;
        const strength = 0.55 * up * down * (1 - 0.4 * f);
        const spread = 12 + 70 * Math.min(1, (year - wi.from) / Math.min(3, dur));
        for (let j = 0; j < 140; j++) {
          const g = Math.sqrt(-2 * Math.log(Math.max(1e-6, h(j, 1)))) * Math.cos(2 * Math.PI * h(j, 2));
          const lat = Math.max(-85, Math.min(85, wi.lat + g * spread));
          const lon = h(j, 3) * 360 - 180 + 40 * (year - wi.from) * (0.6 + 0.8 * h(j, 4));
          const wx = ((((lon + 180) / 360) % 1) + 1) % 1 * world.width;
          const wy = ((90 - lat) / 180) * world.height;
          const q = L(wx, wy);
          if (!q) continue;
          const e = L(wx + 1500 * (0.5 + h(j, 5)) * kmW, wy);
          const rr = e ? Math.hypot(e[0] - q[0], e[1] - q[1]) : 60;
          if (rr > rect.width) continue;
          blob(q[0], q[1], rr, j % 3 ? '120,112,104' : '96,90,86', strength * (0.5 + 0.5 * h(j, 6)));
        }
      }
      shift = 0;
      if (onGlobe && gt) setGlobeScar(gt);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      if (onGlobe) setGlobeScar(null);
    };
  }, [show, data, world, toClient, civ, onGlobe]);
  if (!show || onGlobe) return null;
  // 正片叠底:只让底图变暗、变褐(地面本身烧焦、枯死、被烟尘遮暗),不是盖一层颜色
  return <canvas ref={canvas} className="wonder-layer" aria-hidden="true" style={{ mixBlendMode: 'multiply' }} />;
}
