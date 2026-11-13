/**
 * 本地分支 modern-pace 第二十七轮:奇观叠加层 —— 太空电梯(gen/civ/story/spaceText.ts 的 spaceTowers)。
 *
 * 时间轴到了动工那一年,缆绳从赤道附近那座城往天上长,按工期长到顶;建成以后顶上一座配重站,缆绳上一个升降舱慢慢上下。
 *   - 地球仪(正射投影):缆绳沿那一点的法线伸出球面(按半径的 0.75 倍画到为止,往上渐隐),转到背面被球挡住的那一段不画 ——
 *     转到边上能看见它直直地戳出星球的轮廓;
 *   - 平面图、各种投影(俯视,第三十轮):缆绳正对着看的人,画成一个发光的锚点 + 慢慢往外扩的光环,旁边写名字;
 *     还在建的,外面一圈进度弧(建了几成)。
 * 第三十六轮:同步轨道环(spaceText.ts 的 orbitalRing):地球仪上在缆绳顶那么高画一圈绕赤道的环(转到球后面的被挡住),各座电梯顶有一根细线接到环上;
 *   平面图、各种投影(俯视):赤道上一条发光的线。在建的段从两头的电梯往中间长,接通的是蓝白色、在建的是橙色;合龙以后写环名。
 * 和事件标签一样铺在地图上(不接鼠标),位置每帧按 App 给的换算(世界坐标 / 地球仪的经纬度 + 高度)。只读编年史,不改推演。
 */
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import { orbitalRing, spaceTowers, type SpaceTower } from '../gen/civ/story/spaceText';
import { DEBRIS_N, blockadesOf, debrisDensity, debrisPoint, debrisSpread, satCounts, satOrbit, satPathPoint, satPoint, towerSevered, type SatOrbit, type SatYears } from '../gen/civ/orbit';
import { INVENTIONS } from '../gen/civ/inventions';
import { worldToLonLat } from '../render/globe';
import { getCivTime } from './civView';
import type { WorldToClient } from './EventPins';
import type { GlobeApi } from './Globe';
import './timeline.css';

type XY = [number, number];
const R2D = 180 / Math.PI;
/** 地球仪上缆绳画多高(离地几个球半径):同步轨道 35786 km / 6371 km(第三十六轮起照真的画;缩小地球仪看得到全貌) */
const GLOBE_TOP = 35786 / 6371;
/** 平面图上光柱多高(像素) */
const FLAT_TOP = 72;
/** 第八十七轮:轨道线一圈取几个点、近地散布的卫星画前几颗的轨道 */
const ORBIT_STEPS = 72;
const ORBIT_LEO = 40;

export interface WonderLayerProps {
  civ: Civ | null;
  world: World;
  toClient: MutableRefObject<WorldToClient | null>;
  globe?: MutableRefObject<GlobeApi | null> | null;
  hidden?: boolean;
}

interface Site {
  /** spaceTowers 里的下标(轨道环按它认支点) */
  i: number;
  t: SpaceTower;
  wx: number;
  wy: number;
  lon: number;
  lat: number;
}

export function WonderLayer({ civ, world, toClient, globe, hidden }: WonderLayerProps) {
  const has = !!civ && civ.viable && civ.cultures.length > 0;
  const sites = useMemo<Site[]>(() => {
    if (!has) return [];
    const c = civ!.history ?? civ!;
    const out: Site[] = [];
    for (const [i, t] of spaceTowers(c).entries()) {
      const cell = t.region >= 0 ? c.regions.seat[t.region] : -1;
      if (cell < 0 || cell >= world.mesh.n) continue;
      // 第三十六轮:锚台在那城同一经度的赤道上(电梯只能建在赤道上)
      const wx = world.mesh.x[cell];
      const wy = world.height / 2;
      const [lon] = worldToLonLat(wx, wy, world.width, world.height);
      out.push({ i, t, wx, wy, lon: lon * R2D, lat: 0 });
    }
    return out;
  }, [civ, world, has]);
  const ring = useMemo(() => (has ? orbitalRing(civ!.history ?? civ!) : null), [civ, has]);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const globeRef = useRef(globe);
  globeRef.current = globe;
  // 第六十六轮:凯斯勒碎片壳(轨道封锁期间)
  const blocks = useMemo(() => (has ? blockadesOf((civ!.history ?? civ!).annals) : []), [civ, has]);
  // 第八十七轮:平时轨道上的卫星 —— 世上第一次有这几样发明的年份
  const satYears = useMemo<SatYears>(() => {
    const dev = has ? (civ!.history ?? civ!).development : undefined;
    if (!dev) return {};
    const first = new Map<string, number>();
    for (const e of dev.events as { kind: string; year: number; invention?: number }[]) {
      if (e.kind !== 'invent' || e.invention === undefined) continue;
      const n = INVENTIONS[e.invention]?.name;
      if (n && !(first.get(n)! <= e.year)) first.set(n, e.year);
    }
    return { sat: first.get('人造卫星'), comm: first.get('通信卫星'), nav: first.get('卫星导航'), mega: first.get('可回收火箭') };
  }, [civ, has]);
  const show = !hidden && (sites.length > 0 || blocks.length > 0 || satYears.sat !== undefined);

  useEffect(() => {
    if (!show || !civ) return;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const cv = canvas.current;
      const ctx = cv?.getContext('2d');
      if (!cv || !ctx) return;
      const rect = cv.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(rect.width * dpr) || cv.height !== Math.round(rect.height * dpr)) {
        cv.width = Math.round(rect.width * dpr);
        cv.height = Math.round(rect.height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const year = getCivTime().year ?? civ.endYear;
      const G = globeRef.current?.current ?? null;
      const tc = toClient.current;
      const now = performance.now() / 1000;
      // ---- 第八十七轮:平时轨道上的卫星(不闪的白、青点,偶尔反光一下;近地、同步、导航、大星座四类) ----
      if (G && satYears.sat !== undefined) {
        const cnt = satCounts(satYears, blocks, year);
        const col = ['236,242,250', '255,236,190', '170,230,255', '214,236,255'];
        // 轨道线(半透明;被球挡住的段不画):同步轨道一圈、导航 6 个面、大星座每层三分之一的面、近地散布的前 ORBIT_LEO 颗
        const path = (o: SatOrbit, rgba: string, w: number) => {
          ctx.strokeStyle = rgba;
          ctx.lineWidth = w;
          ctx.beginPath();
          let pen = false;
          for (let k = 0; k <= ORBIT_STEPS; k++) {
            const p = satPathPoint(o, (k / ORBIT_STEPS) * Math.PI * 2);
            const q = G.lonLatAltToClient(p.lon, p.lat, p.h);
            if (!q) {
              pen = false;
              continue;
            }
            if (pen) ctx.lineTo(q[0] - rect.left, q[1] - rect.top);
            else ctx.moveTo(q[0] - rect.left, q[1] - rect.top);
            pen = true;
          }
          ctx.stroke();
        };
        if (cnt[1] > 0) path(satOrbit(1, 0), `rgba(${col[1]},0.22)`, 1);
        for (let pl = 0; pl < Math.min(6, cnt[2]); pl++) path(satOrbit(2, pl), `rgba(${col[2]},0.16)`, 0.8);
        for (let i = 0; i < Math.min(90, cnt[3]); i++) if (Math.floor(i / 3) % 3 === 0) path(satOrbit(3, i), `rgba(${col[3]},0.07)`, 0.6);
        for (let i = 0; i < Math.min(ORBIT_LEO, cnt[0]); i++) path(satOrbit(0, i), `rgba(${col[0]},0.06)`, 0.6);
        for (let kind = 0; kind < 4; kind++) {
          for (let i = 0; i < cnt[kind]; i++) {
            const p = satPoint(kind, i, now);
            const q = G.lonLatAltToClient(p.lon, p.lat, p.h);
            if (!q) continue;
            const glint = (i * 7 + kind * 13 + Math.floor(now * 0.6)) % 173 === 0;
            ctx.fillStyle = `rgba(${col[kind]},${glint ? 1 : kind === 3 ? 0.55 : 0.75})`;
            const sz = glint ? 2.4 : kind === 1 ? 1.5 : kind === 3 ? 0.9 : 1.2;
            ctx.fillRect(q[0] - rect.left - sz / 2, q[1] - rect.top - sz / 2, sz, sz);
          }
        }
      }
      // ---- 凯斯勒碎片壳:地球仪上离地 300–2000 km 一层闪烁的灰白点(被球挡住的不画);越清理越稀 ----
      // 第八十七轮:封锁头几年先是被打碎的那个轨道面上的一道环,再散成整层壳
      const dd = G ? debrisDensity(blocks, year) : 0;
      if (dd > 0) {
        const n = Math.floor(DEBRIS_N * Math.pow(dd, 0.6));
        const spread = debrisSpread(blocks, year);
        for (let i = 0; i < n; i++) {
          const p = debrisPoint(i, now, spread);
          const q = G!.lonLatAltToClient(p.lon, p.lat, p.h);
          if (!q) continue;
          const tw = 0.55 + 0.45 * Math.sin(now * (2 + (i % 7)) + i);
          ctx.fillStyle = `rgba(${i % 5 === 0 ? '255,214,170' : '226,230,236'},${(0.25 + 0.5 * dd) * tw})`;
          const sz = i % 11 === 0 ? 1.8 : 1.1;
          ctx.fillRect(q[0] - rect.left - sz / 2, q[1] - rect.top - sz / 2, sz, sz);
        }
      }
      sites.forEach((s, idx) => {
        if (year < s.t.start) return;
        // 第六十六轮:被碎片打断、还没重建的不画
        if (towerSevered((civ.history ?? civ).annals, s.t.region, year)) return;
        const prog = Math.min(1, (year - s.t.start) / Math.max(1, s.t.build));
        const done = prog >= 1;
        const local = (q: XY | null): XY | null => (q ? [q[0] - rect.left, q[1] - rect.top] : null);
        // 平面图、各种投影:俯视
        if (!G) {
          const b = local(tc?.(s.wx, s.wy) ?? null);
          if (!b || b[0] < -40 || b[1] < -40 || b[0] > rect.width + 40 || b[1] > rect.height + 40) return;
          const glow = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], 14);
          glow.addColorStop(0, done ? 'rgba(235,250,255,1)' : 'rgba(255,225,160,0.95)');
          glow.addColorStop(0.35, done ? 'rgba(150,220,255,0.6)' : 'rgba(255,190,110,0.5)');
          glow.addColorStop(1, 'rgba(120,200,255,0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(b[0], b[1], 14, 0, Math.PI * 2);
          ctx.fill();
          if (done) {
            // 慢慢往外扩、渐隐的两圈光环
            for (let q = 0; q < 2; q++) {
              const ph = (now * 0.25 + q * 0.5 + idx * 0.13) % 1;
              ctx.strokeStyle = `rgba(160,225,255,${0.7 * (1 - ph)})`;
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              ctx.arc(b[0], b[1], 5 + 16 * ph, 0, Math.PI * 2);
              ctx.stroke();
            }
          } else {
            // 进度弧:从正上方顺时针,建了几成画几成
            ctx.strokeStyle = 'rgba(255,200,120,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(b[0], b[1], 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
            ctx.stroke();
          }
          ctx.font = '12px "Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
          ctx.fillStyle = 'rgba(235,250,255,0.95)';
          ctx.strokeStyle = 'rgba(10,30,50,0.75)';
          ctx.lineWidth = 3;
          const label = done ? s.t.name : `${s.t.name}(在建)`;
          ctx.strokeText(label, b[0] + 13, b[1] + 4);
          ctx.fillText(label, b[0] + 13, b[1] + 4);
          return;
        }
        // 缆绳上 u(0 地面 – 1 顶)处在屏幕上哪;被挡住 = null
        let at: (u: number) => XY | null;
        if (G) {
          const H = GLOBE_TOP * prog;
          at = (u) => local(G.lonLatAltToClient(s.lon, s.lat, H * u));
        } else {
          const b = local(tc?.(s.wx, s.wy) ?? null);
          at = (u) => (b ? [b[0], b[1] - FLAT_TOP * prog * u] : null);
        }
        // 缆绳:往上渐隐
        ctx.lineCap = 'round';
        let prev: XY | null = null;
        const N = 28;
        for (let k = 0; k <= N; k++) {
          const q = at(k / N);
          if (q && prev) {
            const a = done ? 0.95 - 0.55 * (k / N) : 0.8;
            ctx.strokeStyle = `rgba(200,240,255,${a})`;
            ctx.lineWidth = 1.6;
            ctx.shadowColor = 'rgba(120,210,255,0.9)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(q[0], q[1]);
            ctx.stroke();
          }
          prev = q;
        }
        ctx.shadowBlur = 0;
        // 地面锚台
        const base = at(0);
        if (base) {
          ctx.fillStyle = 'rgba(220,245,255,0.95)';
          ctx.beginPath();
          ctx.ellipse(base[0], base[1], 5, 2.5, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        const top = at(1);
        if (top) {
          if (done) {
            // 配重站:一个亮的菱形 + 一圈
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.beginPath();
            ctx.moveTo(top[0], top[1] - 5);
            ctx.lineTo(top[0] + 4, top[1]);
            ctx.lineTo(top[0], top[1] + 5);
            ctx.lineTo(top[0] - 4, top[1]);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = 'rgba(150,220,255,0.7)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(top[0], top[1], 8, 0, Math.PI * 2);
            ctx.stroke();
            ctx.font = '12px "Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = 'rgba(235,250,255,0.95)';
            ctx.strokeStyle = 'rgba(10,30,50,0.75)';
            ctx.lineWidth = 3;
            ctx.strokeText(s.t.name, top[0] + 11, top[1] + 4);
            ctx.fillText(s.t.name, top[0] + 11, top[1] + 4);
          } else {
            // 还在建:顶上一点一闪一闪
            ctx.fillStyle = `rgba(255,210,120,${0.5 + 0.5 * Math.sin(now * 5)})`;
            ctx.beginPath();
            ctx.arc(top[0], top[1], 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        // 升降舱:建成以后在缆绳上慢慢上下
        if (done) {
          const ph = (now * 0.07 + idx * 0.37) % 2;
          const u = ph < 1 ? ph : 2 - ph;
          const c = at(0.04 + 0.92 * u);
          if (c) {
            ctx.fillStyle = 'rgba(255,240,180,1)';
            ctx.beginPath();
            ctx.arc(c[0], c[1], 2.4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });

      // ---- 同步轨道环 ----
      if (ring && year >= ring.start) {
        const byI = new Map(sites.map((s) => [s.i, s]));
        const local = (q: XY | null): XY | null => (q ? [q[0] - rect.left, q[1] - rect.top] : null);
        const ringAt = (lon: number): XY | null => {
          if (G) return local(G.lonLatAltToClient(lon, 0, GLOBE_TOP));
          const x = ((((lon + 180) % 360) + 360) % 360) / 360 * world.width;
          return local(tc?.(x, world.height / 2) ?? null);
        };
        // 从经度 l0 往东画到 l1(度);被挡住、绕到另一边(平面图上一下跳过半屏)就断开
        const arc = (l0: number, l1: number, color: string, width: number) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.shadowColor = 'rgba(120,210,255,0.9)';
          ctx.shadowBlur = 6;
          ctx.beginPath();
          let prev: XY | null = null;
          const n = Math.max(2, Math.ceil((l1 - l0) / 2));
          for (let k = 0; k <= n; k++) {
            const q = ringAt(l0 + ((l1 - l0) * k) / n);
            if (q && prev && Math.abs(q[0] - prev[0]) < rect.width / 2) ctx.lineTo(q[0], q[1]);
            else if (q) ctx.moveTo(q[0], q[1]);
            prev = q;
          }
          ctx.stroke();
          ctx.shadowBlur = 0;
        };
        let closed = true;
        let label: { lon: number; span: number } | null = null;
        for (const sg of ring.segs) {
          const A = byI.get(sg.a);
          const B = byI.get(sg.b);
          if (!A || !B) continue;
          const span = ((B.lon - A.lon + 360) % 360) || 360;
          const f = Math.min(1, (year - ring.start) / Math.max(1, sg.done - ring.start));
          if (f >= 1) arc(A.lon, A.lon + span, 'rgba(185,235,255,0.9)', 2);
          else {
            closed = false;
            arc(A.lon, A.lon + (span * f) / 2, 'rgba(255,205,130,0.9)', 1.6);
            arc(B.lon - (span * f) / 2, B.lon, 'rgba(255,205,130,0.9)', 1.6);
            // 施工的两个头一闪一闪
            for (const lon of [A.lon + (span * f) / 2, B.lon - (span * f) / 2]) {
              const q = ringAt(lon);
              if (!q) continue;
              ctx.fillStyle = `rgba(255,225,150,${0.5 + 0.5 * Math.sin(now * 5 + lon)})`;
              ctx.beginPath();
              ctx.arc(q[0], q[1], 2.6, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          if (!label || span > label.span) label = { lon: A.lon + span / 2, span };
        }
        // 支点:电梯顶的同步站就在环上
        for (const i of ring.towers) {
          const s = byI.get(i);
          if (!s) continue;
          const q = ringAt(s.lon);
          if (!q) continue;
          ctx.fillStyle = 'rgba(235,250,255,0.95)';
          ctx.beginPath();
          ctx.arc(q[0], q[1], 3, 0, Math.PI * 2);
          ctx.fill();
        }
        if (label) {
          const q = ringAt(label.lon);
          if (q) {
            const t = closed ? ring.name : `${ring.name}(在建)`;
            ctx.font = '12px "Noto Sans SC", -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
            ctx.fillStyle = 'rgba(235,250,255,0.95)';
            ctx.strokeStyle = 'rgba(10,30,50,0.75)';
            ctx.lineWidth = 3;
            ctx.strokeText(t, q[0] + 6, q[1] - 8);
            ctx.fillText(t, q[0] + 6, q[1] - 8);
          }
        }
      }
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      const cv = canvas.current;
      cv?.getContext('2d')?.clearRect(0, 0, cv.width, cv.height);
    };
  }, [show, sites, civ, toClient, ring, world]);

  if (!show) return null;
  return <canvas ref={canvas} className="wonder-layer" />;
}
