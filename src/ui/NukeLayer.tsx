/**
 * 本地分支 modern-pace 第二十四轮:核战叠加层。
 *
 * 推演里一次核交换是同一刻的事(wars.ts:先手一轮、对方报复一轮);这里把那一刻在画面上展开成几十秒:
 *   - 时间轴播放经过一次核交换(或在编年史里点了一条核打击)时开演;正常播放的(没开导播)先停在那一刻,演完接着放。
 *   - 发射点(第二十五轮):战略核约七成从本国各州的发射井起飞(每一发各挑一州)、三成从本国海岸外的潜艇起飞;战术核从挨着目标的本国那州起飞。
 *     按史事编号挑,同一场每次重播一样。
 *   - 弹道按投影画:每一发沿球面上发射点 → 目标的大圆走,弹道高度按射程(远的飞得高);
 *     平面图(等距圆柱、弯边投影)上每个采样点按当前投影换算,画出来就是那种投影下的大圆弧,跨左右接缝的断开、从另一边接上;
 *     地球仪(正射)上带着高度换算,弹道真的离开球面再落下,飞到球背面的那一段被球挡住。
 *   - 被拦下的在半路炸成一团白光(一道青色的拦截弹从目标那边迎上去);命中的:闪光、冲击波圈、火球、蘑菇云,演完以前落点留一点暗红的余烬。
 *     蘑菇云沿当地的"上"长:地球仪边缘看是侧面,正对着看是从头顶往下看;冲击波圈按透视压扁(平面图是俯视,画正圆)。
 *   - 镜头:每一波开始时飞到看得见那一波第一发的起点和落点(和导播同一条路,见 directorStore.ts 的 requestMapFly),
 *     第一发的弹头套一个圈。
 *   - 顶上一条作战时钟:哪两国、T+ 时分秒(画面 1 秒 = 1 分钟;一场两波约 40 秒)、已发射 / 命中 / 拦下几发,和一个"跳过"。
 * 画在铺满窗口的一张画布上(不接鼠标),盖在所有面板上面 —— 开着哪个面板、平面图还是地球仪都看得见。只读史事,不改推演。
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { capitalAt, polityName } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/engine/timeline';
import { nearX, wrapOf } from '../render/common';
import { lonLatToWorld, worldToLonLat } from '../render/globe';
import { getCivTime, setCivTime, subscribeCivTime, useChroniclePick } from './civView';
import { getDirector, requestMapFly } from './directorStore';
import { pointsFocus } from './flyTo';
import type { WorldToClient } from './EventPins';
import type { GlobeApi } from './Globe';
import './timeline.css';

type XY = [number, number];
type V3 = [number, number, number];

interface Shot {
  /** 世界坐标(镜头用) */
  from: XY;
  to: XY;
  /** 球面上的单位向量、两点间的圆心角、弹道最高处离地几个球半径 */
  v0: V3;
  v1: V3;
  om: number;
  apex: number;
  /** 落点经纬度(度) */
  toLon: number;
  toLat: number;
  stopped: boolean;
  kt: number;
  /** 第几波(发射国换了就是下一波) */
  wave: number;
  /** 这一波的第一发 */
  first: boolean;
  /** 起飞(开演后几秒)、飞几秒;被拦下的在弹道上哪一处炸(0–1) */
  launch: number;
  flight: number;
  cut: number;
}

interface Salvo {
  year: number;
  ids: number[];
  shots: Shot[];
  /** 演多久(秒) */
  dur: number;
  a: number;
  b: number;
  /** 打了核弹的国家有几个(连同挨打的那一方) */
  sides: number;
}

/** 两波相隔几秒(对方发现来袭、下令报复);一波里各发在几秒里陆续起飞;命中后蘑菇云几秒 */
const WAVE_GAP = 13;
/** 一波在几秒内打完(第六十八轮:8 → 3,成波齐射) */
const SPREAD = 3;
/** 一枚导弹至多带几个弹头(同一阵地、目标相近的编在一起) */
const MIRV = 4;
const CLOUD = 8;
/** 画面 1 秒 = 作战时钟几秒 */
const CLOCK = 60;
/** 一帧里年份往前跳得比这多(年)就不算"播放经过" */
const JUMP_YEARS = 60;
/** 一条弹道采样几段 */
const SEG = 40;
const R2D = 180 / Math.PI;

const hash = (i: number, k: number) => {
  const v = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return v - Math.floor(v);
};

const vecOf = (lon: number, lat: number): V3 => [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];

/** 大圆上 u 处的经纬度(弧度) */
function slerpLL(s: Shot, u: number): [number, number] {
  let x: number;
  let y: number;
  let z: number;
  if (s.om < 1e-6) {
    x = s.v0[0];
    y = s.v0[1];
    z = s.v0[2];
  } else {
    const so = Math.sin(s.om);
    const a = Math.sin((1 - u) * s.om) / so;
    const b = Math.sin(u * s.om) / so;
    x = a * s.v0[0] + b * s.v1[0];
    y = a * s.v0[1] + b * s.v1[1];
    z = a * s.v0[2] + b * s.v1[2];
  }
  return [Math.atan2(y, x), Math.asin(Math.max(-1, Math.min(1, z)))];
}

function salvosOf(civ: Civ, world: World): { list: Salvo[]; byAnnal: Map<number, Salvo> } {
  const W = wrapOf(world);
  const { x, y, n } = world.mesh;
  const cellXY = (c: number): XY | null => (c >= 0 && c < n ? [x[c], y[c]] : null);
  const capXY = (p: number, yr: number): XY | null => {
    const P = civ.polities[p];
    const s = P ? civ.settlements[capitalAt(P, yr)] : undefined;
    return s ? cellXY(s.cell) : null;
  };
  const R = civ.regions;
  const mesh = world.mesh;
  const elev = world.elevation;
  /** 州 r 外海上的一点(从州里挨着海的地块往海里走几步;不靠海 = -1) */
  const offshore = new Map<number, number>();
  const seaOf = (r: number): number => {
    const hit = offshore.get(r);
    if (hit !== undefined) return hit;
    let start = -1;
    for (let q = R.cellStart[r]; q < R.cellStart[r + 1] && start < 0; q++) {
      const c = R.cells[q];
      for (let e = mesh.adjStart[c]; e < mesh.adjStart[c + 1]; e++) {
        const d = mesh.adj[e];
        if (R.of[d] < 0 && elev[d] < 0) {
          start = d;
          break;
        }
      }
    }
    let out = -1;
    if (start >= 0) {
      const seen = new Set<number>([start]);
      let ring = [start];
      for (let k = 0; k < 6 && ring.length; k++) {
        const nx: number[] = [];
        for (const c of ring)
          for (let e = mesh.adjStart[c]; e < mesh.adjStart[c + 1]; e++) {
            const d = mesh.adj[e];
            if (!seen.has(d) && R.of[d] < 0 && elev[d] < 0) {
              seen.add(d);
              nx.push(d);
            }
          }
        if (nx.length) ring = nx;
        else break;
      }
      out = ring[0];
    }
    offshore.set(r, out);
    return out;
  };
  const groups = new Map<number, number[]>();
  civ.annals.forEach((e, i) => {
    if (e.kind !== 'nuke' || !(e.n === 1 || e.n === 2)) return;
    const k = Math.round(e.year * 256);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(i);
  });
  const list: Salvo[] = [];
  const byAnnal = new Map<number, Salvo>();
  for (const ids of groups.values()) {
    const own = ownersAt(civ, civ.annals[ids[0]].year).polity;
    const landsOf = new Map<number, number[]>();
    const lands = (p: number) => {
      let l = landsOf.get(p);
      if (!l) {
        l = [];
        for (let r = 0; r < own.length; r++) if (own[r] === p) l.push(r);
        landsOf.set(p, l);
      }
      return l;
    };
    const perWave: number[] = [];
    let lastA = -2;
    for (const i of ids) {
      const e = civ.annals[i];
      if (e.a !== lastA) {
        perWave.push(0);
        lastA = e.a;
      }
      perWave[perWave.length - 1]++;
    }
    // 第六十八轮:每国的发射阵地(这一场里固定):内陆州里按锚点地块哈希挑 3–6 处发射井群;靠海的州外 1–3 片潜艇海域
    const sitesMemo = new Map<number, { silos: number[]; subs: number[] }>();
    const sitesOf = (p: number, mine: number[]) => {
      let v = sitesMemo.get(p);
      if (v) return v;
      const rank = (r: number, k: number) => hash(R.seat[r] * 7 + k, 77);
      const inland = mine.filter((r) => seaOf(r) < 0);
      const silosFrom = (inland.length >= 3 ? inland : mine).slice().sort((a, b) => rank(a, 1) - rank(b, 1));
      const nSilo = Math.max(1, Math.min(silosFrom.length, 3 + Math.floor(hash(p, 91) * 4)));
      const coast = mine.filter((r) => seaOf(r) >= 0).sort((a, b) => rank(a, 2) - rank(b, 2));
      const nSub = Math.min(coast.length, 1 + Math.floor(hash(p, 92) * 3));
      v = { silos: silosFrom.slice(0, nSilo).map((r) => R.seat[r]), subs: coast.slice(0, nSub).map((r) => seaOf(r)) };
      sitesMemo.set(p, v);
      return v;
    };
    /** 多弹头:同一波、同一阵地的,按到达目标的远近分组,每 MIRV 发一枚导弹 —— 记住每枚导弹的起飞时刻、飞多久 */
    const bus = new Map<string, { n: number; launch: number; flight: number }>();
    const shots: Shot[] = [];
    let wave = -1;
    lastA = -2;
    let j = 0;
    for (const i of ids) {
      const e = civ.annals[i];
      if (e.a !== lastA) {
        wave++;
        lastA = e.a;
        j = 0;
      }
      const st = e.settlement >= 0 ? civ.settlements[e.settlement] : undefined;
      const to = st ? cellXY(st.cell) : e.region >= 0 ? cellXY(civ.regions.seat[e.region]) : null;
      if (!to) continue;
      const tactical = e.n === 1;
      // 发射点:战术核 = 挨着目标那州的本国州;战略核 = 本国各州的发射井(七成)/ 海岸外的潜艇(三成);找不到 = 国都
      let from: XY | null = null;
      let site = -1;
      const mine = lands(e.a);
      if (tactical && e.region >= 0) {
        for (let q = R.adjStart[e.region]; q < R.adjStart[e.region + 1] && !from; q++) if (own[R.adj[q]] === e.a) from = cellXY(R.seat[R.adj[q]]);
      } else if (!tactical && mine.length) {
        // 第六十八轮:固定的发射阵地 —— 内陆几处发射井群 + 海岸外几片潜艇海域;七成从井、三成从潜艇
        const ss = sitesOf(e.a, mine);
        const pool = hash(i, 5) < 0.3 && ss.subs.length ? ss.subs : ss.silos;
        if (pool.length) {
          site = pool[Math.floor(hash(i, 4) * pool.length)];
          from = cellXY(site);
        }
      }
      from ??= capXY(e.a, e.year) ?? [to[0] - 40, to[1] - 20];
      from = [nearX(from[0], to[0], W), from[1]];
      const [l0, b0] = worldToLonLat(from[0], from[1], world.width, world.height);
      const [l1, b1] = worldToLonLat(to[0], to[1], world.width, world.height);
      const v0 = vecOf(l0, b0);
      const v1 = vecOf(l1, b1);
      const om = Math.acos(Math.max(-1, Math.min(1, v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2])));
      const m = perWave[wave];
      // 第六十八轮:同一波、同一阵地、目标落在同一格(约 8 个世界单位)的编进同一枚导弹,至多 MIRV 发
      let launch = wave * WAVE_GAP + (m > 1 ? (j / (m - 1)) * SPREAD : 0) * (0.7 + 0.3 * hash(i, 1));
      let flight = tactical ? 3 : 8 + 2.5 * hash(i, 2);
      if (!tactical && site >= 0) {
        const key = `${wave}|${site}|${Math.floor(to[0] / 8)}|${Math.floor(to[1] / 8)}`;
        const b = bus.get(key);
        if (b && b.n < MIRV) {
          b.n++;
          launch = b.launch;
          flight = b.flight;
        } else bus.set(key, { n: 1, launch, flight });
      }
      shots.push({
        from,
        to,
        v0,
        v1,
        om,
        apex: tactical ? 0.006 : 0.03 + 0.2 * (om / Math.PI),
        toLon: l1 * R2D,
        toLat: b1 * R2D,
        stopped: tactical ? false : (e.oob?.[2] ?? 0) === 1,
        kt: tactical ? (e.oob?.[0] ?? 20) : (e.oob?.[0] ?? 1000),
        wave,
        first: j === 0,
        launch,
        flight,
        cut: 0.5 + 0.35 * hash(i, 3),
      });
      j++;
    }
    if (!shots.length) continue;
    const dur = Math.max(...shots.map((s) => s.launch + s.flight)) + CLOUD + 1;
    const e0 = civ.annals[ids[0]];
    const sides = new Set<number>([e0.a, e0.b]);
    for (const i of ids) sides.add(civ.annals[i].a);
    const s: Salvo = { year: e0.year, ids, shots, dur, a: e0.a, b: e0.b, sides: sides.size };
    list.push(s);
    for (const i of ids) byAnnal.set(i, s);
  }
  list.sort((p, q) => p.year - q.year);
  return { list, byAnnal };
}

/** 屏幕上的"往上"和朝向:ux / uy = 往上的方向,f = 往上在屏幕上剩几成(侧面看 1,正对着看 0),d = 冲击波圈压成几成 */
interface Up {
  ux: number;
  uy: number;
  f: number;
  d: number;
}
/**
 * 第三十轮:平面图、各种投影都是从正上方往下看 —— 蘑菇云画俯视(f = 0:没有柱子,帽子是一圈正圆的烟环),冲击波圈是正圆;
 * 大小按公里换算成像素(km = 这一处一公里几个像素;地球仪不传,照原来的画法)
 */
const FLAT_UP: Up = { ux: 0, uy: -1, f: 0, d: 1 };

/** 命中那一处的样子:闪光、冲击波圈、火球、蘑菇云,最后一点余烬。age = 命中后几秒 */
function drawBlast(ctx: CanvasRenderingContext2D, p: XY, age: number, kt: number, up: Up, km?: number) {
  // 平面图(km 给了):按实际公里 —— 1 Mt 闪光约 30 公里、冲击波约 20 公里、蘑菇云帽子约 10 公里(当量的立方根缩放),夹在看得见的像素范围里
  const mt = Math.cbrt(Math.max(1, kt) / 1000);
  const z = km !== undefined ? km * mt : 0;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const s = km !== undefined ? clamp((30 * z - 60) / 140, 0.02, 2.2) : Math.max(0.55, Math.min(2.2, Math.cbrt(kt / 800)));
  // 火球、蘑菇云只是中间的点缀(第二十九轮缩到六成)
  const sm = km !== undefined ? clamp((10 * z) / 15, 0.25, 3) : s * 0.6;
  const ring = km !== undefined ? clamp(20 * z, 6, 220) : 10 + 95 * s;
  const [x, y] = p;
  // 横着那一边(冲击波圈、帽子的长轴)
  const px = -up.uy;
  const py = up.ux;
  const rot = Math.atan2(py, px);
  // 本地分支 modern-pace 第二十九轮:闪光是主角 —— 一团很大的过曝白光(按当量,大当量的盖住一片城市群),叠加混合,几团叠在一起越叠越白;
  // 0.15 秒亮到顶,两秒里慢慢退,再留一层淡淡的暖光到第四秒
  if (age < 4) {
    const R = km !== undefined ? clamp(30 * z, 8, 320) : 60 + 140 * s;
    const peak = age < 0.15 ? age / 0.15 : Math.exp(-(age - 0.15) * 1.6);
    const warm = age < 4 ? 0.22 * Math.max(0, 1 - age / 4) : 0;
    const a = Math.min(1, 0.95 * peak + warm);
    const r = R * (0.55 + 0.45 * Math.min(1, age / 0.5));
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(0.18, `rgba(255,252,240,${0.85 * a})`);
    g.addColorStop(0.45, `rgba(255,236,200,${0.45 * a})`);
    g.addColorStop(1, 'rgba(255,210,160,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = prev;
  }
  if (age < 2.4) {
    const k = age / 2.4;
    const r = km !== undefined ? 3 + (ring - 3) * k : 10 + 95 * s * k;
    ctx.strokeStyle = `rgba(255,250,235,${0.65 * (1 - k)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y, r, Math.max(1, r * up.d), rot, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (age < 1.8) {
    const k = Math.min(1, age / 0.6);
    const r = 5 * sm + 9 * sm * k;
    const cx = x + up.ux * r * 0.3 * up.f;
    const cy = y + up.uy * r * 0.3 * up.f;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,250,210,${1 - age / 1.8})`);
    g.addColorStop(0.5, `rgba(255,150,40,${0.9 * (1 - age / 1.8)})`);
    g.addColorStop(1, 'rgba(180,40,10,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (age > 0.3) {
    const k = Math.min(1, (age - 0.3) / 2.6);
    const e = 1 - (1 - k) * (1 - k);
    const a = age < 6 ? 0.95 : Math.max(0, 0.95 * (1 - (age - 6) / 2.5));
    if (a > 0) {
      // 柱子顶在屏幕上离地多远(正对着看时缩成一点,只看得见帽子)
      const H = 36 * sm * e * up.f;
      const tx = x + up.ux * H;
      const ty = y + up.uy * H;
      if (up.f > 0.08) {
        ctx.fillStyle = `rgba(150,105,75,${a * 0.85})`;
        ctx.beginPath();
        ctx.moveTo(x - px * 4 * sm, y - py * 4 * sm);
        ctx.lineTo(tx - px * 2.4 * sm + up.ux * -4 * sm * up.f, ty - py * 2.4 * sm + up.uy * -4 * sm * up.f);
        ctx.lineTo(tx + px * 2.4 * sm + up.ux * -4 * sm * up.f, ty + py * 2.4 * sm + up.uy * -4 * sm * up.f);
        ctx.lineTo(x + px * 4 * sm, y + py * 4 * sm);
        ctx.closePath();
        ctx.fill();
        // 柱子中间那一圈裙边
        const mx = x + up.ux * H * 0.45;
        const my = y + up.uy * H * 0.45;
        ctx.fillStyle = `rgba(170,130,100,${a * 0.6})`;
        ctx.beginPath();
        ctx.ellipse(mx, my, 6 * sm * (0.5 + 0.5 * e), 2.2 * sm + (6 * sm * (0.5 + 0.5 * e) - 2.2 * sm) * (1 - up.f), rot, 0, Math.PI * 2);
        ctx.fill();
      }
      // 帽子:侧面看扁,正对着看圆
      const rx = 15 * sm * (0.55 + 0.45 * e);
      const ryFlat = 8.5 * sm * (0.55 + 0.45 * e);
      const ry = ryFlat * up.f + rx * (1 - up.f);
      const heat = Math.max(0, 1 - age / 4);
      const mix = (h: number, c: number) => Math.round(h * heat + c * (1 - heat));
      const g = ctx.createRadialGradient(tx, ty, 0, tx, ty, rx);
      g.addColorStop(0, `rgba(${mix(255, 140)},${mix(170, 125)},${mix(70, 115)},${a})`);
      g.addColorStop(0.7, `rgba(${mix(200, 110)},${mix(90, 100)},${mix(40, 95)},${a * 0.9})`);
      g.addColorStop(1, 'rgba(90,85,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(tx, ty, rx, ry, rot, 0, Math.PI * 2);
      ctx.fill();
      // 俯视(平面图):帽子是一圈往外翻卷的烟环 —— 中间亮、外圈一道暗环、慢慢转着的几团
      if (up.f < 0.3) {
        // 第六十八轮:不描暗环(小的看着像准星),只留几团软烟
        for (let q = 0; q < 6; q++) {
          const th = (q / 6) * Math.PI * 2 + age * 0.35;
          ctx.fillStyle = `rgba(150,138,128,${a * 0.45})`;
          ctx.beginPath();
          ctx.arc(tx + Math.cos(th) * rx * 0.72, ty + Math.sin(th) * rx * 0.72, rx * 0.22, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }
  // 第六十八轮:去掉第二十九轮的瞄准圈(几百个红圈 + 十字叠在一起像一地准星);只留一点暗红余烬,十秒里淡掉
  const ea = age < 2 ? 0.5 * (age / 2) : Math.max(0, 0.5 * (1 - (age - 2) / 8));
  if (ea > 0.01) {
    const er = Math.max(2, 2.2 * s);
    const g2 = ctx.createRadialGradient(x, y, 0, x, y, er * 2);
    g2.addColorStop(0, `rgba(230,70,30,${ea})`);
    g2.addColorStop(1, 'rgba(120,20,10,0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x, y, er * 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

export interface NukeLayerProps {
  civ: Civ | null;
  world: World;
  toClient: MutableRefObject<WorldToClient | null>;
  /** 地球仪开着时给它的接口(按正射投影带高度画);平面图 = null */
  globe?: MutableRefObject<GlobeApi | null> | null;
  hidden?: boolean;
}

interface Run {
  s: Salvo;
  t0: number;
  /** 演完要不要接着放(开演时是我们停下的) */
  resume: boolean;
}

export function NukeLayer({ civ, world, toClient, globe, hidden }: NukeLayerProps) {
  const has = !!civ && civ.viable && civ.cultures.length > 0;
  const { list, byAnnal } = useMemo(() => (has ? salvosOf(civ!, world) : { list: [] as Salvo[], byAnnal: new Map<number, Salvo>() }), [civ, world, has]);
  const [run, setRun] = useState<Run | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const globeRef = useRef(globe);
  globeRef.current = globe;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const clock = useRef<HTMLDivElement | null>(null);
  const pick = useChroniclePick();
  const end = civ?.endYear ?? 0;

  // 播放经过一次核交换:开演(正常播放的先停在那一刻);跳到很远的年份:收掉
  useEffect(() => {
    setRun(null);
    if (!list.length) return;
    const t0 = getCivTime();
    let prevYear = t0.year ?? end;
    let prevPlaying = t0.playing;
    const off = subscribeCivTime((t) => {
      const y = t.year ?? end;
      const cur = runRef.current;
      if (t.playing && prevPlaying && y > prevYear && y - prevYear <= JUMP_YEARS && !cur) {
        const s = list.find((v) => v.year > prevYear && v.year <= y);
        if (s) {
          const pause = !getDirector().on;
          prevYear = s.year;
          prevPlaying = !pause;
          setRun({ s, t0: performance.now(), resume: pause });
          if (pause) setCivTime({ playing: false, year: s.year });
          return;
        }
      } else if (cur && Math.abs(y - cur.s.year) > JUMP_YEARS) setRun(null);
      prevYear = y;
      prevPlaying = t.playing;
    });
    return off;
  }, [list, end]);

  // 编年史里点了一条核打击:演那一次(不动时间轴)
  const seenPick = useRef(pick.stamp);
  useEffect(() => {
    if (pick.stamp === seenPick.current) return;
    seenPick.current = pick.stamp;
    const s = pick.entry && pick.entry.tag === '核' ? byAnnal.get(pick.entry.id) : undefined;
    if (s) setRun({ s, t0: performance.now(), resume: false });
  }, [pick.stamp, pick.entry, byAnnal]);

  // 演:每帧画
  const show = !hidden && has;
  useEffect(() => {
    if (!run || !show) return;
    const { s } = run;
    const flown = new Set<number>();
    let raf = 0;
    const finish = () => {
      setRun((r) => (r === run ? null : r));
      const t = getCivTime();
      if (run.resume && !t.playing && t.year === s.year) setCivTime({ playing: true });
    };
    const frame = () => {
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const t = (performance.now() - run.t0) / 1000;
      if (t > s.dur) {
        finish();
        return;
      }
      // 第六十八轮:只画在地图上 —— 挖掉侧栏(aside.sidebar)、时间轴(.bottom-row)那几块(浮在地图上的面板)
      ctx.save();
      {
        ctx.beginPath();
        ctx.rect(0, 0, w, h);
        for (const el of document.querySelectorAll('aside.sidebar, .bottom-row .civ-timeline')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) ctx.rect(r.right, r.top, -r.width, r.height);
        }
        ctx.clip('nonzero');
      }
      const tc = toClient.current;
      const G = globeRef.current?.current ?? null;
      const W = world.width;
      const Hh = world.height;
      /** 弹道上 u 处(带高度)在屏幕上的位置;被球挡住 / 换算不出 = null。平面图:x 跟着上一个点展开,跨接缝的由调用方断开 */
      const at = (sh: Shot, u: number, prevX: number): [number, number, number] | null => {
        const [lon, lat] = slerpLL(sh, u);
        if (G) {
          const q = G.lonLatAltToClient(lon * R2D, lat * R2D, sh.apex * Math.sin(Math.PI * u));
          return q ? [q[0], q[1], 0] : null;
        }
        const [wx0, wy] = lonLatToWorld(lon, lat, W, Hh);
        const wx = Number.isFinite(prevX) ? nearX(wx0, prevX, W) : wx0;
        const q = tc?.(wx, wy) ?? null;
        return q ? [q[0], q[1], wx] : null;
      };
      /** 画 u0 → u1 这一段(跨接缝、被挡住的地方断开);alpha(k) = 第 k 段的透明度 */
      const path = (sh: Shot, u0: number, u1: number, n: number, style: (k: number) => void) => {
        let prev: [number, number, number] | null = null;
        let px = NaN;
        for (let k = 0; k <= n; k++) {
          const q = at(sh, u0 + ((u1 - u0) * k) / n, px);
          if (q && prev && Math.abs(q[0] - prev[0]) < w * 0.4) {
            style(k);
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(q[0], q[1]);
            ctx.stroke();
          }
          prev = q;
          if (q) px = q[2];
        }
      };
      let fired = 0;
      let hit = 0;
      let stopped = 0;
      const fade = t > s.dur - 2 ? Math.max(0, (s.dur - t) / 2) : 1;
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      for (const sh of s.shots) {
        const u = (t - sh.launch) / sh.flight;
        if (u < 0) continue;
        fired++;
        // 镜头:每一波第一发起飞时飞过去看全它的起点和落点
        if (sh.first && !flown.has(sh.wave)) {
          flown.add(sh.wave);
          requestMapFly(pointsFocus(world, [sh.from, sh.to]));
        }
        const endU = sh.stopped ? sh.cut : 1;
        if (u >= endU) {
          if (sh.stopped) stopped++;
          else hit++;
        }
        const color = sh.wave % 2 === 0 ? [255, 92, 54] : [255, 214, 70];
        const uu = Math.min(u, endU);
        void uu;
        if (u < endU) {
          // 第六十八轮:只画彗尾(弹头后面一截渐隐的亮尾,不留整条弹道)
          const tail = Math.max(0, u - 0.3);
          path(sh, tail, u, 12, (k) => {
            ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${(0.85 * Math.pow(k / 12, 1.6)).toFixed(3)})`;
            ctx.lineWidth = 0.6 + 2.2 * (k / 12);
          });
          const hd = at(sh, u, NaN);
          if (hd) {
            const g = ctx.createRadialGradient(hd[0], hd[1], 0, hd[0], hd[1], 7);
            g.addColorStop(0, 'rgba(255,255,240,1)');
            g.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(hd[0], hd[1], 7, 0, Math.PI * 2);
            ctx.fill();
            if (sh.first) {
              ctx.strokeStyle = 'rgba(255,255,255,0.9)';
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.arc(hd[0], hd[1], 13 + 2 * Math.sin(t * 8), 0, Math.PI * 2);
              ctx.stroke();
            }
            // 拦截弹:被拦下的那一发,最后一截从目标那边迎上去一道青线
            if (sh.stopped && u > sh.cut - 0.22) {
              const v = (u - (sh.cut - 0.22)) / 0.22;
              const p1 = at(sh, 1, NaN);
              const c = at(sh, sh.cut, NaN);
              if (p1 && c) {
                ctx.strokeStyle = 'rgba(120,230,255,0.85)';
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(p1[0], p1[1]);
                ctx.lineTo(p1[0] + (c[0] - p1[0]) * v, p1[1] + (c[1] - p1[1]) * v);
                ctx.stroke();
              }
            }
          }
        } else if (sh.stopped) {
          const age = (u - sh.cut) * sh.flight;
          const c = age < 0.9 ? at(sh, sh.cut, NaN) : null;
          if (c) {
            ctx.fillStyle = `rgba(230,250,255,${1 - age / 0.9})`;
            ctx.beginPath();
            ctx.arc(c[0], c[1], 3 + 13 * (age / 0.9), 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const p1 = at(sh, 1, NaN);
          if (!p1) continue;
          let up = FLAT_UP;
          let km: number | undefined;
          if (G) {
            const g = G.upAt(sh.toLon, sh.toLat);
            if (!g) continue;
            up = { ux: g.ux, uy: g.uy, f: Math.sqrt(Math.max(0, 1 - g.d * g.d)), d: g.d };
          } else {
            const q = tc?.(p1[2], sh.to[1] - Hh / 180) ?? null;
            km = q ? Math.hypot(q[0] - p1[0], q[1] - p1[1]) / 111 : 0.5;
          }
          drawBlast(ctx, [p1[0], p1[1]], (u - 1) * sh.flight, sh.kt, up, km);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      const el = clock.current;
      if (el && civ) {
        const sec = Math.floor(t * CLOCK);
        const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
        const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
        const ss = String(sec % 60).padStart(2, '0');
        const A = civ.polities[s.a] ? polityName(civ.polities[s.a], s.year) : '';
        const B = civ.polities[s.b] ? polityName(civ.polities[s.b], s.year) : '';
        const more = s.sides > 2 ? ` 等 ${s.sides} 国` : '';
        el.firstElementChild!.textContent = `核战 · ${A} — ${B}${more} · 第 ${Math.floor(s.year)} 年 · T+${hh}:${mm}:${ss}`;
        el.children[1].textContent = `已发射 ${fired} · 命中 ${hit} · 拦下 ${stopped}`;
        el.style.opacity = String(fade);
      }
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      const cv = canvas.current;
      cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
    };
  }, [run, show, world, toClient, civ]);

  if (!show || !run) return null;
  return (
    <>
      <canvas ref={canvas} className="nuke-layer" />
      <div ref={clock} className="nuke-clock">
        <b />
        <span />
        <button
          type="button"
          onClick={() => {
            const r = runRef.current;
            setRun(null);
            const t = getCivTime();
            if (r?.resume && !t.playing && t.year === r.s.year) setCivTime({ playing: true });
          }}
        >
          跳过
        </button>
      </div>
    </>
  );
}
