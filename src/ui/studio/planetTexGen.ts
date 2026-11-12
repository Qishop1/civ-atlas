/**
 * 本地分支 modern-pace:行星贴图的纯计算(主线程、后台线程 planetTex.worker.ts 都能用;不碰 document)。
 *   banded   气态巨行星 / 冰巨星 / 迷你海王星:纬度彩色条带 + 湍流(+ 风暴斑)+ 雾
 *   cratered 岩质 / 矮行星 / 卫星:月球生成器的环形山地貌按颜色染色
 *   worldPx  有大气的岩质行星:世界生成器长一颗星球 → 写实贴图;不宜居的陆地植被色褪成行星自己的颜色(水、冰不动)
 */
import { generateMoon, moonRgba, type MoonOpts } from '../../gen/moon';
import { generateWorld } from '../../gen/world';
import type { WorldParams } from '../../gen/params';
import { rasterize } from '../../gen/raster';
import { renderRealistic } from '../../render/realistic';

export interface Tex {
  px: Uint8ClampedArray;
  w: number;
  h: number;
  /** 自己发的光(熔岩、活火山),一像素一个值 0–255;画球时不受光照,夜面也看得见 */
  glow?: Uint8ClampedArray;
}
export type RGB = [number, number, number];

function noise1(seed: number) {
  const h = (i: number) => {
    let n = (Math.imul(i, 374761393) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number) => {
    const i = Math.floor(x), f = x - i;
    const s = f * f * (3 - 2 * f);
    return h(i) * (1 - s) + h(i + 1) * s;
  };
}

/** 三维值噪声(0…1):按球面上的点取,极点和别处一样,不会把一圈经度拧到一个点上 */
function noise3(seed: number) {
  const h = (x: number, y: number, z: number) => {
    let n = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177) + seed) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const sm = (f: number) => f * f * (3 - 2 * f);
  return (x: number, y: number, z: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = sm(x - xi), v = sm(y - yi), w = sm(z - zi);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    return l(
      l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
      w,
    );
  };
}

export function banded(seed: number, color: RGB, strength: number, storm: boolean, haze: number, w = 1024, teq = -150, spots = true): Tex {
  const h = w / 2;
  const px = new Uint8ClampedArray(w * h * 4);
  const nb = noise1(seed), nt = noise3(seed ^ 0x5bd1e995), ns = noise1(seed ^ 0x3c6ef372);
  let rs = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const r = () => {
    rs = (rs + 0x6d2b79f5) >>> 0;
    let t = rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // ---- 长相:温度定云色,种子定风格 ----
  // 云按平衡温度分档(Sudarsky 的气态巨行星分类):I 氨云(< −120°C,木星、土星那样的米黄橙褐)、II 水云(−120…80,发白)、
  // III 无云(80…630,瑞利散射偏蓝)、IV 碱金属吸收(630…1130,很暗)、V 硅酸盐云(> 1130,灰褐);越往后条带对比越弱、风暴越少
  const cls = teq < -120 ? 0 : teq < 80 ? 1 : teq < 630 ? 2 : teq < 1130 ? 3 : 4;
  const CLS_COL: (RGB | null)[] = [null, [232, 230, 222], [95, 125, 175], [62, 55, 62], [165, 140, 125]];
  const CLS_MIX = [0, 0.6, 0.85, 0.9, 0.75];
  const CLS_CON = [1, 0.6, 0.35, 0.3, 0.55];
  const CLS_STORM = [1, 0.8, 0.3, 0.2, 0.6];
  const cc = CLS_COL[cls];
  const base: RGB = cc ? [color[0] + (cc[0] - color[0]) * CLS_MIX[cls], color[1] + (cc[1] - color[1]) * CLS_MIX[cls], color[2] + (cc[2] - color[2]) * CLS_MIX[cls]] : color;
  // 风格(只给气态巨行星):0 = 类木(高对比、条带宽、湍流猛、风暴多),1 = 类土(有雾、低对比、条带细密、风暴少)
  const sty = storm ? r() : 0;
  const lerp = (a0: number, a1: number, t: number) => a0 + (a1 - a0) * t;
  strength *= (storm ? lerp(1.15, 0.5, sty) : 0.6 + 0.9 * r()) * CLS_CON[cls];
  haze = Math.min(0.6, haze + (storm ? 0.25 * sty : 0.12 * r()));
  const bandW = storm ? lerp(1.1, 0.6, sty) : 0.8 + 0.5 * r();
  const turbK = storm ? lerp(1.1, 0.55, sty) : 0.6 + 0.5 * r();
  const stormF = storm ? lerp(1, 0.35, sty) * CLS_STORM[cls] : 0;
  // 分带:从南极到北极一条条排,赤道附近的宽一点;亮带(zone)暗带(belt)大致交替,每条有自己的明暗、色调
  const cuts: number[] = [-Math.PI / 2];
  const val: number[] = [], tint: number[] = [];
  let sign = r() < 0.5 ? 1 : -1;
  while (cuts[cuts.length - 1] < Math.PI / 2) {
    const c = cuts[cuts.length - 1];
    const wdt = (0.07 + 0.2 * r()) * (1 + 0.6 * Math.cos(c)) * bandW;
    cuts.push(Math.min(Math.PI / 2, c + wdt));
    val.push(sign * (0.35 + 0.65 * r()));
    tint.push(r() * 2 - 1);
    sign = r() < 0.85 ? -sign : sign;
  }
  const nbands = val.length;
  const bandAt = (x: number) => {
    let lo = 0, hi = nbands - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (cuts[m] <= x) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  const e = Math.PI / h; // 一个像素的纬度宽:分界只留这么宽的过渡(抗锯齿),别的都是陡边
  // 大红斑:找一条离 sLat0 最近的中低纬带分界,贴在分界靠赤道一侧;半宽 0.24–0.34 rad(经向)、扁 0.38
  const sLat0 = (nb(3.3) - 0.5) * 0.9, sLon = nb(7.7) * Math.PI * 2;
  const grsEdge = cuts.slice(1, -1).filter((c) => Math.abs(c) < 0.9).sort((x, y) => Math.abs(x - sLat0) - Math.abs(y - sLat0))[0] ?? sLat0;
  // 有没有大斑、什么颜色:气态巨行星按风格和温度档的概率,氨云档多半是红的,别的档白或暗;冰巨星 45% 出一个暗斑(像海王星的大暗斑)
  const hasSpot = (storm ? r() < 0.75 * stormF + 0.05 : r() < 0.45) && spots;
  const spotType: 'red' | 'white' | 'dark' = !storm ? 'dark' : cls === 0 ? (r() < 0.75 ? 'red' : r() < 0.6 ? 'white' : 'dark') : r() < 0.5 ? 'white' : 'dark';
  const grsA = storm ? 0.24 + 0.1 * nb(5.5) : 0.16 + 0.08 * nb(5.5), grsB = grsA * (storm ? 0.38 : 0.55);
  const sLat = grsEdge - Math.sign(grsEdge || 1) * grsB * 0.35;
  const grs = { lat: sLat, lon: sLon, a: grsA, b: grsB, s: (sLat > 0 ? -1 : 1) * 2.6, tail: nb(9.1) < 0.5 ? 1 : -1 };
  // 白卵(零散的小白椭圆风暴,用户要留着)
  // 白卵(像木星的 Oval BA 和那串"珍珠"):贴在中低纬的带分界上,高压涡(南北半球转向相反);
  // 数量 3–7,有时两三个挨着排;尾迹拖向下游(随机定东西)
  const ovalEdges = cuts.slice(1, -1).filter((c) => Math.abs(c) < 1.1);
  const ovals: { lat: number; lon: number; a: number; b: number; s: number; tail: number }[] = [];
  if (storm && ovalEdges.length) {
    const n = Math.floor(r() * 8 * stormF);
    while (ovals.length < n) {
      const at = ovalEdges[Math.floor(r() * ovalEdges.length)];
      const a = 0.055 + 0.05 * r(), b = a * (0.55 + 0.15 * r());
      const lon0 = r() * Math.PI * 2;
      const grp = Math.min(n - ovals.length, r() < 0.4 ? 2 + Math.floor(r() * 2) : 1);
      const tail = r() < 0.5 ? 1 : -1;
      for (let k = 0; k < grp; k++) {
        const la0 = at + (r() - 0.5) * b * 0.8;
        ovals.push({ lat: la0, lon: lon0 + k * a * (3 + 1.5 * r()), a: a * (0.8 + 0.4 * r()), b, s: (la0 > 0 ? -1 : 1) * (3 + 1.5 * r()), tail });
      }
    }
  }
  // 成串的涡旋(只给气态巨行星):挑 1–3 条中低纬的带分界,每条排一串 5–10 个,沿经度占一段弧;
  // 同一串转向一致;有的串涡心是半透明的奶白(白卵),有的只卷不带白心
  const vort: { lat: number; lon: number; a: number; b: number; s: number; white: number }[] = [];
  if (storm) {
    const edges = cuts.slice(1, -1).filter((c) => Math.abs(c) < 1.05);
    const nch = Math.min(edges.length, 3, Math.floor(r() * 4 * stormF));
    for (let c = 0; c < nch; c++) {
      const at = edges.splice(Math.floor(r() * edges.length), 1)[0];
      const n = 5 + Math.floor(r() * 6);
      const a = 0.07 + 0.06 * r(), b = a * (0.5 + 0.2 * r());
      const lon0 = r() * Math.PI * 2, gap = a * (2.6 + 1.6 * r());
      const spin = (r() < 0.5 ? 1 : -1) * (3 + 1.5 * r());
      const white = r() < 0.6 ? 0.35 + 0.3 * r() : 0;
      const side = (r() - 0.5) * b * 0.8;
      for (let k = 0; k < n; k++) {
        vort.push({ lat: at + side + (r() - 0.5) * b * 0.5, lon: lon0 + k * gap * (0.85 + 0.3 * r()), a: a * (0.75 + 0.5 * r()), b, s: spin * (0.8 + 0.4 * r()), white: white * (0.7 + 0.6 * r()) });
      }
    }
  }
  const ss = (a0: number, a1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a0) / (a1 - a0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;

    // 极区(纬度 60° 往上)条带渐渐淡掉、偏暗偏灰,像木星两极那样乱成一片
    const pol = Math.min(1, Math.max(0, (Math.abs(lat) - (Math.PI / 180) * 60) / ((Math.PI / 180) * 25)));
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      // 涡旋:取样点绕涡心转(越靠中心转得越多),周围的带被卷成螺旋;之后再被湍流扭
      // 白卵:离最近那个多远(按它的长短半轴归一;1 = 边缘)、尾迹(下游、同纬度的一长条)
      let ovR = 9, wake = 0, ovPhi = 0, ovS = 1;
      for (const o of ovals) {
        const dl = (lat - o.lat) / o.b;
        if (dl > 4 || dl < -4) continue;
        const dn = (Math.atan2(Math.sin(lon - o.lon), Math.cos(lon - o.lon)) * Math.cos(o.lat)) / o.a;
        const rd = Math.hypot(dn, dl);
        if (rd < ovR) {
          ovR = rd;
          ovPhi = Math.atan2(dl, dn);
          ovS = Math.sign(o.s);
        }
        const down = dn * o.tail;
        if (down > 0.8 && down < 9) wake = Math.max(wake, Math.exp(-dl * dl * 0.5) * (1 - down / 9));
      }
      let grsR = 9, grsPhi = 0;
      if (hasSpot) {
        const dl = (lat - grs.lat) / grs.b;
        if (dl < 5 && dl > -5) {
          const dn = (Math.atan2(Math.sin(lon - grs.lon), Math.cos(lon - grs.lon)) * Math.cos(grs.lat)) / grs.a;
          grsR = Math.hypot(dn, dl);
          grsPhi = Math.atan2(dl, dn);
          const down = dn * grs.tail;
          if (down > 0.9 && down < 5) wake = Math.max(wake, Math.exp(-dl * dl * 0.35) * (1 - down / 5));
        }
      }
      let sl = lat, sn = lon, core = 0;
      for (const vt of hasSpot || ovals.length ? [...vort, ...ovals.map((o) => ({ ...o, white: 0 })), ...(hasSpot ? [{ ...grs, white: 0 }] : [])] : vort) {
        const dl = (sl - vt.lat) / vt.b;
        if (dl > 2.6 || dl < -2.6) continue;
        const dn = (Math.atan2(Math.sin(sn - vt.lon), Math.cos(sn - vt.lon)) * Math.cos(vt.lat)) / vt.a;
        const r2 = dn * dn + dl * dl;
        if (r2 > 6.8) continue;
        const th = vt.s * Math.exp(-r2 * 0.9);
        const c = Math.cos(th), sn2 = Math.sin(th);
        const nu = dn * c - dl * sn2, nv = dn * sn2 + dl * c;
        sn = vt.lon + (nu * vt.a) / Math.cos(vt.lat);
        sl = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, vt.lat + nv * vt.b));
        core = Math.max(core, vt.white * Math.exp(-r2 * 2.2));
      }
      const cl = Math.cos(sl), Z = Math.sin(sl);
      const X = cl * Math.cos(sn), Y = cl * Math.sin(sn);
      const f = (sc: number, o: number) => nt(X * sc + o, Y * sc + o, Z * sc * 2.5 + o) - 0.5;
      const n3 = (x0: number, y0: number, z0: number, o: number) => nt(x0 + o, y0 + o, z0 + o) - 0.5;
      // 湍流:取样点先按大尺度噪声卷一次,再按卷过的位置用细尺度噪声卷第二次;经纬两个方向一起卷,相邻带的颜色被卷进对方。
      // 纬向(z)频率高、幅度小 = 横向拉长,像被风拉开
      const w1x = n3(X * 3, Y * 3, Z * 7, 11) + 0.5 * n3(X * 6, Y * 6, Z * 14, 21);
      const w1y = n3(X * 3, Y * 3, Z * 7, 31) + 0.5 * n3(X * 6, Y * 6, Z * 14, 41);
      const w1z = n3(X * 3, Y * 3, Z * 7, 51) + 0.5 * n3(X * 6, Y * 6, Z * 14, 61);
      let qx = X + w1x * 0.14 * turbK, qy = Y + w1y * 0.14 * turbK, qz = Z + w1z * 0.05 * turbK;
      const la1 = Math.asin(Math.max(-1, Math.min(1, qz / Math.hypot(qx, qy, qz))));
      // 靠近带分界的地方细尺度卷得更狠(分界上的剪切涡旋)
      const b1 = bandAt(Math.max(-Math.PI / 2, Math.min(Math.PI / 2 - 1e-9, la1)));
      const prox = Math.exp(-Math.max(0, Math.min(la1 - cuts[b1], cuts[b1 + 1] - la1)) / 0.035);
      const a2 = (0.025 + 0.065 * Math.max(prox, wake)) * turbK;
      const w2x = n3(qx * 10, qy * 10, qz * 22, 71) + 0.5 * n3(qx * 22, qy * 22, qz * 48, 81);
      const w2y = n3(qx * 10, qy * 10, qz * 22, 91) + 0.5 * n3(qx * 22, qy * 22, qz * 48, 101);
      const w2z = n3(qx * 10, qy * 10, qz * 22, 111) + 0.5 * n3(qx * 22, qy * 22, qz * 48, 121);
      qx += w2x * a2;
      qy += w2y * a2;
      qz += w2z * a2 * 0.45;
      const ql = Math.hypot(qx, qy, qz);
      const la = Math.max(-Math.PI / 2, Math.min(Math.PI / 2 - 1e-9, Math.asin(Math.max(-1, Math.min(1, qz / ql))) + f(40, 170) * 0.003));
      const lo = bandAt(la);
      // 分界的过渡宽 2–8 像素,随噪声变:有的地方清楚,有的地方晕开
      const ew = e * (2 + 6 * Math.max(0, Math.min(1, n3(qx * 5, qy * 5, qz * 5, 141) * 1.6 + 0.5)));
      let v = val[lo], tn = tint[lo];
      const d0 = la - cuts[lo], d1 = cuts[lo + 1] - la;
      if (d0 < ew && lo > 0) {
        const q = 0.5 * (1 - ss(0, 1, d0 / ew));
        v += (val[lo - 1] - v) * q;
        tn += (tint[lo - 1] - tn) * q;
      } else if (d1 < ew && lo < nbands - 1) {
        const q = 0.5 * (1 - ss(0, 1, d1 / ew));
        v += (val[lo + 1] - v) * q;
        tn += (tint[lo + 1] - tn) * q;
      }
      // 带里的云纹:沿经度拉长、会断开(纬向频率高、经向低),也跟着湍流走
      const cloud = n3(qx * 9, qy * 9, qz * 55, 161) * 0.7 + n3(qx * 24, qy * 24, qz * 130, 171) * 0.35;
      const streak = cloud * 0.55;
      const mott = f(5, 200) * 0.5;
      const k = 1 + ((v * 0.8 + streak) * (1 - 0.75 * pol) + mott * pol) * strength;
      const tk = tn * strength * 0.35;
      let rr = base[0] * k * (1 + tk), gg = base[1] * k, bb = base[2] * k * (1 - tk);
      // 大红斑本体:砖红(中心偏淡橙)、半透明,里面跟着取样点转出来的云纹 + 两条往里卷的旋臂;边缘晕开;
      // 外面一圈发白的空当("红斑凹")
      if (hasSpot && grsR < 1.8) {
        // 旋臂:三条,往里卷;加上一层细一点的,里面一道道深浅
        const spiral = 0.5 + 0.5 * Math.sin(grsPhi * 3 + Math.sign(grs.s) * 9 * grsR + cloud * 3);
        const fineArm = 0.5 + 0.5 * Math.sin(grsPhi * 5 + Math.sign(grs.s) * 16 * grsR + cloud * 5);
        const body = 1 - ss(0.68, 1.02, grsR);
        const m = Math.min(0.9, body * (0.5 + 0.45 * cloud + 0.3 * spiral));
        const c0 = Math.min(1, grsR * 1.3);
        const arm = spiral * 0.65 + fineArm * 0.35;
        const [tr, tg, tb] =
          spotType === 'red'
            ? [226 - 28 * c0 - 34 * arm, 148 - 42 * c0 - 38 * arm, 112 - 30 * c0 - 26 * arm]
            : spotType === 'white'
              ? [246 - 10 * c0 - 22 * arm, 240 - 12 * c0 - 22 * arm, 228 - 12 * c0 - 18 * arm]
              : [base[0] * (0.42 + 0.1 * c0 - 0.06 * arm), base[1] * (0.45 + 0.1 * c0 - 0.06 * arm), base[2] * (0.55 + 0.1 * c0 - 0.05 * arm)];
        rr += (tr - rr) * m;
        gg += (tg - gg) * m;
        bb += (tb - bb) * m;
        const hollow = spotType === 'dark' ? 0 : Math.max(0, 1 - Math.abs(grsR - 1.22) / 0.32) * 0.32 * (0.7 + 0.6 * cloud);
        rr += (238 - rr) * hollow;
        gg += (228 - gg) * hollow;
        bb += (212 - bb) * hollow;
      }
      if (hasSpot && spotType === 'dark') {
        const dl = (la - grs.lat) / grs.b - Math.sign(grs.lat || 1) * 1.35;
        const dn = (Math.atan2(Math.sin(lon - grs.lon), Math.cos(lon - grs.lon)) * Math.cos(grs.lat)) / grs.a - 0.25;
        const comp = Math.exp(-(dn * dn) / 0.35 - (dl * dl) / 0.08) * (0.55 + 0.6 * cloud);
        if (comp > 0.01) {
          const m = Math.min(0.9, comp);
          rr += (248 - rr) * m;
          gg += (250 - gg) * m;
          bb += (252 - bb) * m;
        }
      }
      // 白卵本体:奶白、半透明(透出一点底下的带色),里面跟着取样点转出来的云纹 = 螺旋纹;边缘晕开;外面一圈稍暗的环
      if (ovR < 1.6) {
        // 螺旋纹:两条旋臂,往里卷(转向跟着涡)
        const spiral = 0.5 + 0.5 * Math.sin(ovPhi * 2 + ovS * 7 * ovR);
        const body = 1 - ss(0.4, 1.1, ovR);
        const m = Math.min(0.85, body * (0.5 + 0.35 * cloud + 0.25 * spiral));
        rr += (240 - rr) * m;
        gg += (233 - gg) * m;
        bb += (220 - bb) * m;
        const ring = Math.max(0, 1 - Math.abs(ovR - 1.25) / 0.3) * 0.1;
        rr *= 1 - ring;
        gg *= 1 - ring;
        bb *= 1 - ring * 0.7;
      }
      // 尾迹:下游一长条被搅乱、略发白的云
      if (wake > 0.02) {
        const m = wake * 0.18 * (0.5 + cloud);
        rr += (235 - rr) * m;
        gg += (226 - gg) * m;
        bb += (210 - bb) * m;
      }
      // 涡心:半透明的奶白,透出底下的带色
      if (core > 0.01) {
        const m = Math.min(0.7, core);
        rr += (236 - rr) * m;
        gg += (226 - gg) * m;
        bb += (208 - bb) * m;
      }
      if (pol > 0) {
        const gy = (rr + gg + bb) / 3, ds = 0.35 * pol;
        rr += (gy - rr) * ds;
        gg += (gy - gg) * ds;
        bb += (gy - bb) * ds;
      }
      const kp = 1 - 0.25 * Math.pow(Math.abs(lat) / (Math.PI / 2), 3);
      const i = (y * w + x) * 4;
      px[i] = (rr * (1 - haze) + 235 * haze) * kp;
      px[i + 1] = (gg * (1 - haze) + 240 * haze) * kp;
      px[i + 2] = (bb * (1 - haze) + 245 * haze) * kp;
      px[i + 3] = 255;
    }
  }
  return { px, w, h };
}

export function cratered(seed: number, color: RGB, size: number): Tex {
  const m = generateMoon(seed, size);
  const px = moonRgba(m);
  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] / 170;
    px[i] = Math.min(255, color[0] * v);
    px[i + 1] = Math.min(255, color[1] * v);
    px[i + 2] = Math.min(255, color[2] * v);
  }
  return { px, w: m.w, h: m.h };
}

export function worldPx(params: WorldParams, habitable: boolean, color: RGB, width = 1024): Tex {
  const w = generateWorld(params);
  const r = rasterize(w, width / w.width);
  const c: HTMLCanvasElement | OffscreenCanvas = typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: r.w, height: r.h }) : new OffscreenCanvas(r.w, r.h);
  const g = c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  renderRealistic(g, w, r, 'classic');
  const px = g.getImageData(0, 0, r.w, r.h).data;
  // 本地分支 modern-pace 第四十七轮:地表超过 100°C(气温参数 = 地表 − 15)的海、湖早就蒸干了 —— 画成干涸的盆地:
  // 原来浅的地方发白(盐壳、蒸发岩),深的地方暗(玄武岩盆底),原来的岸线还看得出来
  if (params.temperature + 15 > 100) {
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      if (!r.water[j]) continue;
      const lum = (0.3 * px[i] + 0.59 * px[i + 1] + 0.11 * px[i + 2]) / 255;
      const deep = Math.max(0, Math.min(1, 1 - lum * 2.2));
      px[i] = 222 + (92 - 222) * deep;
      px[i + 1] = 212 + (82 - 212) * deep;
      px[i + 2] = 192 + (74 - 192) * deep;
    }
  }
  if (!habitable) {
    const [cr, cg, cb] = color;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      if (r.water[j] && params.temperature + 15 <= 100) continue;
      const R0 = px[i], G0 = px[i + 1], B0 = px[i + 2];
      const lum = (0.3 * R0 + 0.59 * G0 + 0.11 * B0) / 255;
      if (lum > 0.82 && Math.abs(R0 - B0) < 25) continue;
      const k = lum * 1.35;
      px[i] = Math.min(255, 0.3 * R0 + 0.7 * cr * k);
      px[i + 1] = Math.min(255, 0.3 * G0 * 0.8 + 0.7 * cg * k);
      px[i + 2] = Math.min(255, 0.3 * B0 + 0.7 * cb * k);
    }
  }
  return { px, w: r.w, h: r.h };
}

/** 后台线程的一件活 */
export type TexJob =
  | { kind: 'band'; seed: number; color: RGB; strength: number; storm: boolean; haze: number; w: number; teq: number }
  | { kind: 'crater'; seed: number; color: RGB; size: number }
  | { kind: 'world'; params: WorldParams; habitable: boolean; color: RGB; w: number }
  | { kind: 'airless'; seed: number; type: AirlessType; color: RGB; size: number; teq: number }
  | { kind: 'luna'; seed: number; size: number }
  | { kind: 'sky'; seed: number; w: number };

export function runJob(j: TexJob): Tex {
  if (j.kind === 'band') return banded(j.seed, j.color, j.strength, j.storm, j.haze, j.w, j.teq);
  if (j.kind === 'crater') return cratered(j.seed, j.color, j.size);
  if (j.kind === 'airless') return airlessTex(j.seed, j.type, j.color, j.size, j.teq);
  if (j.kind === 'sky') return skyTex(j.seed, j.w);
  if (j.kind === 'luna') {
    const m = generateMoon(j.seed, j.size);
    return { px: moonRgba(m), w: m.w, h: m.h };
  }
  return worldPx(j.params, j.habitable, j.color, j.w);
}

/**
 * 环的径向疏密(按种子):inner / outer = 行星半径的几倍;op = 每一格的不透明度(N 格,从内到外),col = 颜色;
 * sum = op 的前缀和(远看时按像素宽度取平均,细环不闪)。
 *   气态巨行星:宽亮的环,3–5 段疏密不同的环区,夹 1–3 道空隙,细纹叠在上面;米白到浅褐,略带行星的颜色
 *   冰巨星 / 迷你海王星:像天王星、海王星,几条很窄的暗灰细环 + 一层很淡的尘埃
 */
export interface RingProfile {
  inner: number;
  outer: number;
  op: Float32Array;
  sum: Float64Array;
  col: Float32Array;
}
export function ringProfile(seed: number, kind: string, color: RGB, N = 4096): RingProfile {
  let a = (seed ^ 0x2545f491) >>> 0 || 1;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const fine = noise1(seed ^ 0x7f4a7c15), fine2 = noise1(seed ^ 0x1b873593);
  const op = new Float32Array(N), col = new Float32Array(N * 3);
  const gas = kind === 'gas';
  const inner = gas ? 1.2 + 0.25 * r() : 1.5 + 0.2 * r();
  const outer = gas ? inner + 0.6 + 0.7 * r() : inner + 0.35 + 0.3 * r();
  const span = outer - inner;
  if (gas) {
    // 环区:分界点、各自的基础不透明度和明暗
    const nz = 3 + Math.floor(r() * 3);
    const cuts = [0, ...Array.from({ length: nz - 1 }, () => r()).sort((x, y) => x - y), 1];
    const zop = Array.from({ length: nz }, () => 0.2 + 0.55 * r() + (r() < 0.5 ? 0.3 : 0));
    const zsh = Array.from({ length: nz }, () => 0.75 + 0.45 * r());
    const gaps = Array.from({ length: 1 + Math.floor(r() * 3) }, () => ({ c: 0.15 + 0.75 * r(), w: 0.006 + 0.03 * r() }));
    const base: RGB = [215 * 0.8 + color[0] * 0.2, 200 * 0.8 + color[1] * 0.2, 172 * 0.8 + color[2] * 0.2];
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      let z = 0;
      while (z < nz - 1 && u > cuts[z + 1]) z++;
      // 环区之间 0.02 的过渡,别一刀切
      const zb = Math.min(nz - 1, z + 1);
      const tz = Math.max(0, Math.min(1, (u - cuts[z + 1] + 1 / N) / (2 / N)));
      let o = zop[z] * (1 - tz) + zop[zb] * tz;
      const sh = zsh[z] * (1 - tz) + zsh[zb] * tz;
      o *= 0.55 + 0.7 * fine(u * 160) + 0.4 * (fine2(u * 700) - 0.5);
      for (const g of gaps) {
        const d = Math.abs(u - g.c) - g.w / span / 2;
        if (d < 1 / N) o *= 0.04 + 0.96 * Math.max(0, Math.min(1, (d + 1 / N) / (2 / N)));
      }
      o *= Math.min(1, u / 0.03) * Math.min(1, (1 - u) * N);
      op[i] = Math.max(0, Math.min(0.97, o));
      col[i * 3] = base[0] * sh;
      col[i * 3 + 1] = base[1] * sh;
      col[i * 3 + 2] = base[2] * sh;
    }
  } else {
    const n = 3 + Math.floor(r() * 7);
    const lets = Array.from({ length: n }, () => {
      const wide = r() < 0.2;
      return { c: 0.05 + 0.9 * r(), w: (wide ? 0.025 + 0.03 * r() : 0.005 + 0.012 * r()) / span, o: wide ? 0.15 + 0.12 * r() : 0.55 + 0.35 * r() };
    });
    const base: RGB = [158 * 0.9 + color[0] * 0.1, 160 * 0.9 + color[1] * 0.1, 166 * 0.9 + color[2] * 0.1];
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N;
      let o = 0.02 * (0.5 + fine(u * 60));
      for (const l of lets) {
        const d = Math.abs(u - l.c) - l.w / 2;
        if (d < 1 / N) o += l.o * Math.max(0, Math.min(1, (1 / N - d) / (2 / N)));
      }
      op[i] = Math.min(0.9, o);
      col[i * 3] = base[0];
      col[i * 3 + 1] = base[1];
      col[i * 3 + 2] = base[2];
    }
  }
  const sum = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) sum[i + 1] = sum[i] + op[i];
  return { inner, outer, op, sum, col };
}

// ---------------------------------------------------------------- 没有大气的天体(岩质小行星、矮行星、卫星)

/**
 * 地表类型:
 *   old       老坑地:坑多、没有月海、没有正面低地(水星、木卫四、谷神星)
 *   mare      有月海的(月球那样)
 *   lava      熔岩世界:坑很少、暗色玄武岩、发光的裂缝和熔岩湖(贴着恒星的)
 *   ice       冰壳:亮白、坑很少、一道道红褐色的裂纹(木卫二)
 *   plains    冰原 + 暗斑:一大片光滑的亮冰原、赤道一带红褐的暗区、别处中等坑(冥王星)
 *   volcanic  火山卫星:硫磺黄、白斑、红橙晕、黑色火山口,没有坑,几处在冒岩浆(木卫一)
 *   haze      雾霭卫星:厚大气,只看得到橙色的雾和很淡的条带(土卫六)
 */
export type AirlessType = 'old' | 'mare' | 'lava' | 'ice' | 'plains' | 'volcanic' | 'haze';

const MOON_OPTS: Record<Exclude<AirlessType, 'haze'>, MoonOpts> = {
  old: { craters: 1.6, maria: false, lowland: false },
  mare: {},
  lava: { craters: 0.08, maria: false, lowland: false },
  ice: { craters: 0.06, maria: false, lowland: false },
  plains: { craters: 0.6, maria: false, lowland: false },
  volcanic: { craters: 0, maria: false, lowland: false },
};

function rng32(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 球面上随机一个方向 */
function randDir(r: () => number): [number, number, number] {
  const z = r() * 2 - 1, a = r() * Math.PI * 2, c = Math.sqrt(1 - z * z);
  return [c * Math.cos(a), c * Math.sin(a), z];
}

export function airlessTex(seed: number, type: AirlessType, color: RGB, size: number, teq = -150): Tex {
  if (type === 'haze') return banded(seed, [215, 150, 72], 0.035, false, 0.4, size, teq, false);
  const m = generateMoon(seed, size, MOON_OPTS[type]);
  const px = moonRgba(m);
  const w = m.w, h = m.h;
  const r = rng32(seed ^ 0x51ed270b);
  const nt = noise3(seed ^ 0x2f6b2b1d);
  const fbm = (x: number, y: number, z: number, f: number) => nt(x * f, y * f, z * f) * 0.6 + nt(x * f * 2.3 + 7, y * f * 2.3 + 7, z * f * 2.3 + 7) * 0.3 + nt(x * f * 5.1 + 13, y * f * 5.1 + 13, z * f * 5.1 + 13) * 0.1;
  const glow = type === 'lava' || type === 'volcanic' ? new Uint8ClampedArray(w * h) : undefined;
  const ss = (a0: number, a1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a0) / (a1 - a0)));
    return t * t * (3 - 2 * t);
  };
  // 每种类型要的东西:冰壳的裂纹(大圆上的一段)、冥王星的冰原中心、火山口
  const lineae = type === 'ice' ? Array.from({ length: 25 + Math.floor(r() * 35) }, () => ({ pole: randDir(r), mid: randDir(r), reach: Math.cos(0.4 + 1.1 * r()), wd: 0.004 + 0.009 * r(), dark: 0.4 + 0.5 * r() })) : [];
  const plain = randDir(r), plainR = 0.6 + 0.3 * r();
  const darkLon = r() * Math.PI * 2, darkSpan = 1.2 + 1.6 * r();
  const HALOS: RGB[] = [[200, 85, 40], [215, 140, 60], [235, 225, 190], [90, 70, 50], [190, 60, 35]];
  const calderas = type === 'volcanic' ? Array.from({ length: 18 + Math.floor(r() * 22) }, () => ({ c: randDir(r), rad: 0.006 + 0.03 * r() * r(), halo: 0.02 + 0.15 * r() * r(), hot: r() < 0.3, hc: HALOS[Math.floor(r() * HALOS.length)], ha: 0.25 + 0.5 * r(), sq: 0.6 + 0.8 * r() })) : [];
  const mix = (o: number, c: RGB, k: number) => {
    px[o] += (c[0] - px[o]) * k;
    px[o + 1] += (c[1] - px[o + 1]) * k;
    px[o + 2] += (c[2] - px[o + 2]) * k;
  };
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), Z = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const X = cl * Math.cos(lon), Y = cl * Math.sin(lon);
      const o = (y * w + x) * 4;
      const v = px[o] / 170; // 月球生成器的明暗(地形晕渲 + 坑),1 ≈ 平均
      if (type === 'old' || type === 'mare') {
        px[o] = Math.min(255, color[0] * v);
        px[o + 1] = Math.min(255, color[1] * v);
        px[o + 2] = Math.min(255, color[2] * v);
      } else if (type === 'lava') {
        // 暗色玄武岩;裂缝 = 噪声的等值线附近;熔岩湖 = 低处
        const n1 = fbm(X, Y, Z, 3), n2 = fbm(X + 3, Y + 3, Z + 3, 7);
        const crack = 1 - ss(0, 0.02 + 0.015 * n2, Math.abs(n1 - 0.5));
        const lake = ss(0.62, 0.7, n2) * ss(0.35, 0.6, n1);
        const k = 0.75 + 0.5 * (v - 1);
        px[o] = 62 * k;
        px[o + 1] = 52 * k;
        px[o + 2] = 50 * k;
        const g = Math.max(crack * 0.85, lake);
        mix(o, [255, 120, 40], g * 0.85);
        glow![y * w + x] = 255 * g;
      } else if (type === 'ice') {
        // 亮白冰壳 + 淡淡的"混沌地形"斑 + 红褐色裂纹
        const k = 0.9 + 0.25 * (v - 1);
        px[o] = Math.min(255, (228 * 0.8 + color[0] * 0.2) * k);
        px[o + 1] = Math.min(255, (226 * 0.8 + color[1] * 0.2) * k);
        px[o + 2] = Math.min(255, (230 * 0.8 + color[2] * 0.2) * k);
        const chaos = ss(0.55, 0.7, fbm(X, Y, Z, 2.5));
        mix(o, [175, 135, 105], chaos * 0.35);
        for (const L of lineae) {
          if (X * L.mid[0] + Y * L.mid[1] + Z * L.mid[2] < L.reach) continue;
          const d = Math.abs(X * L.pole[0] + Y * L.pole[1] + Z * L.pole[2] + 0.006 * (fbm(X, Y, Z, 12) - 0.5));
          if (d < L.wd * 1.6) mix(o, [150, 92, 66], L.dark * (1 - ss(L.wd * 0.5, L.wd * 1.6, d)));
        }
      } else if (type === 'plains') {
        // 中等坑的米褐底;一大片光滑亮冰原(坑被盖掉);赤道一带红褐暗区
        const k = 0.85 + 0.45 * (v - 1);
        px[o] = Math.min(255, (205 * 0.7 + color[0] * 0.3) * k);
        px[o + 1] = Math.min(255, (178 * 0.7 + color[1] * 0.3) * k);
        px[o + 2] = Math.min(255, (148 * 0.7 + color[2] * 0.3) * k);
        const dp = X * plain[0] + Y * plain[1] + Z * plain[2];
        const pl = ss(Math.cos(plainR) - 0.04, Math.cos(plainR) + 0.04, dp + 0.3 * (fbm(X, Y, Z, 3) - 0.5) + 0.1 * (fbm(X, Y, Z, 9) - 0.5));
        if (pl > 0) mix(o, [242, 236, 226], pl * (0.85 + 0.15 * fbm(X, Y, Z, 14)));
        // 暗区:低纬、只占一段经度,碎成一块块(边上被噪声啃得参差)
        const dLon = Math.abs(Math.atan2(Math.sin(lon - darkLon), Math.cos(lon - darkLon)));
        const zone = (1 - ss(0.25, 0.55, Math.abs(Z) + 0.3 * (fbm(X + 9, Y, Z, 3) - 0.5))) * (1 - ss(darkSpan * 0.6, darkSpan, dLon + 0.6 * (fbm(X, Y + 4, Z, 2) - 0.5)));
        const dark = zone * ss(0.38, 0.52, fbm(X + 2, Y + 2, Z + 2, 5)) * (1 - pl);
        mix(o, [105, 58, 42], dark * 0.85);
      } else if (type === 'volcanic') {
        // 硫磺黄底 + 白斑 + 橙红;两极偏暗褐;火山口黑、外面一圈红橙晕,冒着的发光
        const n1 = fbm(X, Y, Z, 3), n2 = fbm(X + 5, Y + 5, Z + 5, 5);
        px[o] = 222;
        px[o + 1] = 198;
        px[o + 2] = 92;
        mix(o, [236, 230, 200], ss(0.55, 0.7, n1) * 0.7);
        mix(o, [205, 120, 55], ss(0.6, 0.75, n2) * 0.6);
        mix(o, [125, 95, 70], ss(0.55, 0.85, Math.abs(Z)) * 0.7);
        for (const c of calderas) {
          const d = Math.acos(Math.max(-1, Math.min(1, X * c.c[0] + Y * c.c[1] + Z * c.c[2])));
          if (d > c.halo + c.rad) continue;
          const dw = d * (1 + 0.5 * (fbm(X + c.sq, Y, Z, 8) - 0.5));
          mix(o, c.hc, (1 - ss(c.rad, c.rad + c.halo, dw)) * c.ha);
          mix(o, [45, 35, 28], (1 - ss(c.rad * 0.6, c.rad, d)) * 0.9);
          if (c.hot && glow) glow[y * w + x] = Math.max(glow[y * w + x], 255 * (1 - ss(0, c.rad * 0.5, d)));
        }
      }
    }
  }
  return { px, w, h, glow };
}

/** 岩质天体的底色在一个范围里变:常见岩石的几种色调(锈红、赭黄、灰、暗玄武岩、浅棕、橄榄灰、白盐),和给的颜色各一半,再按种子微调明暗 */
const ROCK_TONES: RGB[] = [
  [185, 100, 70],
  [205, 165, 110],
  [150, 148, 145],
  [85, 80, 78],
  [200, 180, 150],
  [140, 145, 115],
  [225, 220, 210],
];
export function rockColor(seed: number, base: RGB): RGB {
  const r = rng32(seed ^ 0x6a09e667);
  const t = ROCK_TONES[Math.floor(r() * ROCK_TONES.length)];
  const k = 0.85 + 0.3 * r();
  return [Math.min(255, (base[0] * 0.5 + t[0] * 0.5) * k), Math.min(255, (base[1] * 0.5 + t[1] * 0.5) * k), Math.min(255, (base[2] * 0.5 + t[2] * 0.5) * k)];
}

// ---------------------------------------------------------------- 银河(第五十轮)

/** 银河所在的大圆:法线 n、圆上两个方向 e1(核球那一侧)、e2(按种子;星空的点和天空贴图共用) */
export function galaxyFrame(seed: number): { n: [number, number, number]; e1: [number, number, number]; e2: [number, number, number] } {
  let a0 = (seed ^ 0x51ed2701) >>> 0 || 1;
  const r = () => {
    a0 = (a0 + 0x6d2b79f5) >>> 0;
    let t = a0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nz = r() * 2 - 1, nt = r() * Math.PI * 2, nc = Math.sqrt(1 - nz * nz);
  const n: [number, number, number] = [nc * Math.cos(nt), nc * Math.sin(nt), nz];
  let e1: [number, number, number] = Math.abs(n[2]) < 0.9 ? [n[1], -n[0], 0] : [0, n[2], -n[1]];
  const l1 = Math.hypot(...e1);
  e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  // 核球转到大圆上随机一个经度
  const ph = r() * Math.PI * 2;
  const e2a: [number, number, number] = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
  const c = Math.cos(ph), s = Math.sin(ph);
  const E1: [number, number, number] = [c * e1[0] + s * e2a[0], c * e1[1] + s * e2a[1], c * e1[2] + s * e2a[2]];
  const E2: [number, number, number] = [n[1] * E1[2] - n[2] * E1[1], n[2] * E1[0] - n[0] * E1[2], n[0] * E1[1] - n[1] * E1[0]];
  return { n, e1: E1, e2: E2 };
}

/**
 * 银河的天空贴图(经纬度展开,和行星贴图同一种坐标:u = 经度、v = 纬度,方向是黄道坐标):
 *   带宽沿着带忽宽忽窄(低频噪声),核球那一侧最宽最亮、偏暖;带上一团团亮星云(中频噪声);
 *   暗尘带:噪声挑出来的几片暗云,偏离中线、断断续续,核球附近最明显;外面一层很淡的光
 * 整体很暗(只当背景)
 */
export function skyTex(seed: number, w = 1024): Tex {
  const h = w / 2;
  const px = new Uint8ClampedArray(w * h * 4);
  const { n, e1, e2 } = galaxyFrame(seed);
  const nA = noise3(seed ^ 0x1234abcd), nB = noise3(seed ^ 0x7e57a11), nC = noise3(seed ^ 0x2468ace);
  const fbm = (f: (x: number, y: number, z: number) => number, x: number, y: number, z: number, k: number) =>
    f(x * k, y * k, z * k) * 0.55 + f(x * k * 2.1 + 5, y * k * 2.1 + 5, z * k * 2.1 + 5) * 0.3 + f(x * k * 4.3 + 9, y * k * 4.3 + 9, z * k * 4.3 + 9) * 0.15;
  const ss = (a0: number, a1: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a0) / (a1 - a0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), Z = Math.sin(lat);
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2 - Math.PI;
      const X = cl * Math.cos(lon), Y = cl * Math.sin(lon);
      const b = Math.asin(Math.max(-1, Math.min(1, X * n[0] + Y * n[1] + Z * n[2])));
      const l = Math.atan2(X * e2[0] + Y * e2[1] + Z * e2[2], X * e1[0] + Y * e1[1] + Z * e1[2]);
      const bulge = Math.exp(-(l * l) / (2 * 0.42 * 0.42));
      // 带宽:沿着带慢慢变 + 核球那边鼓起来
      const cx = Math.cos(l), sx = Math.sin(l);
      const wid = 0.07 * (0.7 + 0.7 * nA(cx * 1.6 + 3, sx * 1.6 + 3, 0.5)) + 0.13 * bulge;
      const core = Math.exp(-((b / wid) * (b / wid)));
      // 光雾很平:只有轻微的浓淡(颗粒感交给沿带的暗星,贴图分辨率画不出一颗颗的星)
      // 核球那段亮得多(人马座方向是全天最亮的一块)
      let I = core * (0.75 + 0.35 * fbm(nB, X, Y, Z, 4)) * (1 + 2.2 * bulge);
      // 暗尘:顺着带拉长的细丝(带坐标里经向拉长取噪声,取"脊线"),中线附近、核球那段最多
      const fil = (k: number, o: number) => 1 - Math.abs(2 * nC(cx * k + o, sx * k + o, (b / wid) * 3.2 + o) - 1);
      const ridge = Math.max(fil(5, 0) * 0.75 + fil(11, 40) * 0.25, fil(7, 80) * 0.6 + fil(16, 120) * 0.4);
      // 尘带的宽度按银盘算(核球鼓起来那部分不跟着变宽):暗隙横穿银芯,两边露出亮的星云
      const laneW = (wid - 0.13 * bulge * 0.7) * 0.7;
      const lane = Math.exp(-(((b - wid * 0.12 * Math.sin(l * 2.3 + 1.1)) / laneW) ** 2));
      // 打碎成一段段(另一层噪声决定哪几段有),不连成一条线
      const patch = ss(0.5, 0.7, fbm(nA, X + 23, Y + 23, Z + 23, 6));
      const dust = ss(0.84, 0.96, ridge) * patch * lane * (0.3 + 0.7 * Math.exp(-(l * l) / (2 * 1.0 * 1.0))) * (1 - 0.45 * bulge);
      I *= 1 - 0.55 * dust;
      // 外面一层很淡的光
      I += 0.05 * Math.exp(-((b / (wid * 3.2)) * (b / (wid * 3.2))));
      // 软压缩(不硬截到 1):银盘中线 ≈ 0.32,银芯 ≈ 0.8
      const k = Math.min(1, (0.368 * I) / (1 + 0.15 * I));
      const warm = Math.min(1, bulge * 1.3);
      const o = (y * w + x) * 4;
      px[o] = 255 * k * (0.82 + 0.18 * warm);
      px[o + 1] = 255 * k * (0.84 + 0.04 * warm);
      px[o + 2] = 255 * k * (1.0 - 0.25 * warm);
      px[o + 3] = 255;
    }
  }
  return { px, w, h };
}
