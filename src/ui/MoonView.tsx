/**
 * 本地分支 modern-pace:月球视图(右下角「月球」开 / 关;第一次绕月探测以后才有这个按钮)。主图换成月面图,两种画法
 * (右下角"球形 / 平面"切换,月球视图开着时那个按钮切的是月球):
 *   平面  等距圆柱,经度 0 正对地球,±90° 虚线以外是月背;拖动平移(东西绕圈)、滚轮缩放 1–6 倍
 *   球形  正射投影的球,一开始正对月球正面中心(从地球上看的样子);拖动转、滚轮缩放 0.6–8 倍;±90° 经线画虚线
 * 跟着时间轴:着陆点、基地到那一年才标上。
 *   标注  月海、大环形山的名字(屏上够大的才写;压住别的就不写:着陆点、基地 > 正背面 > 月海 > 环形山);
 *         着陆点圆点、月球基地方块、作者指定的着陆点红十字
 *   点选  点一下(没拖动)选一点:左下写地名、经纬度,月背的提示中继卫星;「设为下一次登月的着陆点」= 干预 moonsite(from = 这一年)
 * Esc 回到地球。时间轴拨到第一次绕月探测以前,自动回到地球。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { spaceRace } from '../gen/civ/story/spaceText';
import { colonies, colonyName, colonyOwner, colonyPop, headText } from '../gen/civ/story/colonies';
import { farSide, moonAtlas, moonCoordText, moonPlaceName } from '../gen/civ/story/moonAtlas';
import { MOON_R, generateMoon, moonRgba } from '../gen/moon';
import { useYear } from './WorldOverviewMarks';
import { addIntervention } from './editsStore';
import { setMoonView, useSpaceUi, useUnlocks } from './spaceStore';
import './space.css';

/** 1024 宽的月面底图(按种子缓存;生成要一秒上下):画平面用的 canvas、画球用的像素 */
interface Big {
  canvas: HTMLCanvasElement;
  px: Uint8ClampedArray;
  w: number;
  h: number;
}
const bigMoons = new Map<number, Big>();
function bigMoon(seed: number): Big {
  let b = bigMoons.get(seed);
  if (b) return b;
  const m = generateMoon(seed, 1024);
  const px = moonRgba(m);
  const c = document.createElement('canvas');
  c.width = m.w;
  c.height = m.h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(m.w, m.h);
  img.data.set(px);
  ctx.putImageData(img, 0, 0);
  b = { canvas: c, px, w: m.w, h: m.h };
  if (bigMoons.size > 4) bigMoons.clear();
  bigMoons.set(seed, b);
  return b;
}

export function MoonView({ civ }: { civ: Civ | null }) {
  const { moon } = useSpaceUi();
  const unl = useUnlocks(civ);
  const on = moon && !!civ && civ.viable && unl.moon;
  useEffect(() => {
    if (moon && !on) setMoonView(false);
  }, [moon, on]);
  if (!on) return null;
  return <MoonBody civ={civ!} />;
}

interface Pt {
  lon: number;
  lat: number;
}

const RAD = Math.PI / 180;
const r1 = (v: number) => Math.round(v * 10) / 10;

/** 球的朝向:正对 (lon0, lat0) 那一点;东、北、朝外三个方向 */
function frame(lon0: number, lat0: number) {
  const a = lon0 * RAD, b = lat0 * RAD;
  const c = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
  const e = [-Math.sin(a), Math.cos(a), 0];
  const n = [-Math.sin(b) * Math.cos(a), -Math.sin(b) * Math.sin(a), Math.cos(b)];
  return { c, e, n };
}

function MoonBody({ civ }: { civ: Civ }) {
  const year = useYear(civ);
  const { moonGlobe } = useSpaceUi();
  const race = useMemo(() => spaceRace(civ), [civ]);
  const atlas = useMemo(() => moonAtlas(civ), [civ]);
  const [base, setBase] = useState<Big | null>(() => bigMoons.get(civ.seed) ?? null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  /** 平面:缩放(1 = 宽度铺满)、平移(像素;x 绕圈) */
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  /** 球:正对哪一点、缩放 */
  const [orb, setOrb] = useState({ lon: 0, lat: 0, z: 1 });
  const [hover, setHover] = useState<Pt | null>(null);
  const [pick, setPick] = useState<Pt | null>(null);
  const [sent, setSent] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const work = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; lon: number; lat: number; moved: boolean } | null>(null);

  useEffect(() => {
    if (base) return;
    const h = setTimeout(() => setBase(bigMoon(civ.seed)), 30);
    return () => clearTimeout(h);
  }, [base, civ.seed]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoonView(false);
    document.addEventListener('keydown', onKey);
    return () => {
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // ---- 平面的几何 ----
  const mw = size.w * view.s;
  const mh = mw / 2;
  const clampY = (y: number) => (mh <= size.h ? (size.h - mh) / 2 : Math.min(0, Math.max(size.h - mh, y)));
  const oy = clampY(view.y);
  const ox = mw ? ((view.x % mw) + mw) % mw : 0;
  // ---- 球的几何 ----
  // 球放在顶栏(约 64 px)和时间轴(约 96 px)之间
  const avail = Math.max(200, size.h - 160);
  const R = Math.min(size.w * 0.42, avail * 0.48) * orb.z;
  const gcx = size.w / 2, gcy = 64 + avail / 2;
  const fr = useMemo(() => frame(orb.lon, orb.lat), [orb.lon, orb.lat]);

  /** 屏上一点 → 经纬度(球上点到球外 = null) */
  const toLL = (cx: number, cy: number): Pt | null => {
    if (moonGlobe) {
      const x = (cx - gcx) / R, y = (gcy - cy) / R;
      const q = x * x + y * y;
      if (q > 1) return null;
      const z = Math.sqrt(1 - q);
      const { c, e, n } = fr;
      const P = [x * e[0] + y * n[0] + z * c[0], x * e[1] + y * n[1] + z * c[1], x * e[2] + y * n[2] + z * c[2]];
      return { lon: r1(Math.atan2(P[1], P[0]) / RAD), lat: r1(Math.asin(Math.max(-1, Math.min(1, P[2]))) / RAD) };
    }
    const u = (((cx - ox) % mw) + mw) % mw;
    const lat = 90 - ((cy - oy) / mh) * 180;
    return { lon: r1((u / mw) * 360 - 180), lat: r1(Math.max(-90, Math.min(90, lat))) };
  };

  const sites = useMemo(() => {
    const out: { lon: number; lat: number; label: string; kind: 'land' | 'base' | 'iv' }[] = [];
    for (const [pid, s] of race.landings) if (s.year <= year) out.push({ lon: s.lon, lat: s.lat, label: `${polityName(civ.polities[pid], s.year)} ${Math.floor(s.year)}`, kind: 'land' });
    // 第三十七轮:月球基地长成的殖民地城市(名字、人口;独立了的写成独立)
    for (const c of colonies(civ)) {
      if (c.body !== 'moon' || c.founded > year || c.lon === undefined || c.lat === undefined) continue;
      const o = colonyOwner(c, year);
      out.push({ lon: c.lon, lat: c.lat, label: `${colonyName(c, year)} ${headText(colonyPop(c, year)).replace(/^约 /, '')}${o >= 0 ? '' : '(独立)'}`, kind: 'base' });
    }
    for (const v of civ.interventions ?? []) if (v.kind === 'moonsite') out.push({ lon: v.lon, lat: v.lat, label: `指定(${v.from} 年起)`, kind: 'iv' });
    return out;
  }, [race, civ, year]);

  useEffect(() => {
    const c = cv.current;
    const { w, h } = size;
    if (!c || !w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#07080b';
    g.fillRect(0, 0, w, h);

    /** 经纬度 → 屏上 (x, y);球的背面 = null */
    let P: (lon: number, lat: number) => [number, number] | null;
    if (moonGlobe) {
      const { c: C, e: E, n: N } = fr;
      P = (lon, lat) => {
        const a = lon * RAD, b = lat * RAD;
        const v = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
        const z = v[0] * C[0] + v[1] * C[1] + v[2] * C[2];
        if (z < 0.02) return null;
        return [gcx + (v[0] * E[0] + v[1] * E[1] + v[2] * E[2]) * R, gcy - (v[0] * N[0] + v[1] * N[1] + v[2] * N[2]) * R];
      };
      // 球面:逐像素反投影,取 1024 宽底图的像素(按 CSS 像素算一份,再拉到屏上)
      if (base) {
        const x0 = Math.max(0, Math.floor(gcx - R)), x1 = Math.min(w, Math.ceil(gcx + R));
        const y0 = Math.max(0, Math.floor(gcy - R)), y1 = Math.min(h, Math.ceil(gcy + R));
        const bw = x1 - x0, bh = y1 - y0;
        if (bw > 0 && bh > 0) {
          const wk = (work.current ??= document.createElement('canvas'));
          wk.width = bw;
          wk.height = bh;
          const wg = wk.getContext('2d')!;
          const img = wg.createImageData(bw, bh);
          const d = img.data, src = base.px, SW = base.w, SH = base.h;
          for (let py = 0; py < bh; py++) {
            const y = (gcy - (py + y0 + 0.5)) / R;
            for (let px = 0; px < bw; px++) {
              const x = (px + x0 + 0.5 - gcx) / R;
              const q = x * x + y * y;
              if (q > 1) continue;
              const z = Math.sqrt(1 - q);
              const X = x * E[0] + y * N[0] + z * C[0], Y = x * E[1] + y * N[1] + z * C[1], Z = x * E[2] + y * N[2] + z * C[2];
              const u = Math.min(SW - 1, Math.max(0, Math.floor(((Math.atan2(Y, X) / Math.PI + 1) / 2) * SW)));
              const v = Math.min(SH - 1, Math.max(0, Math.floor((0.5 - Math.asin(Math.max(-1, Math.min(1, Z))) / Math.PI) * SH)));
              const si = (v * SW + u) * 4, di = (py * bw + px) * 4;
              // 边缘略暗(临边昏暗)
              const k = 0.72 + 0.28 * z;
              d[di] = src[si] * k;
              d[di + 1] = src[si + 1] * k;
              d[di + 2] = src[si + 2] * k;
              d[di + 3] = 255;
            }
          }
          wg.putImageData(img, 0, 0);
          g.drawImage(wk, x0, y0);
        }
      }
      // ±90° 经线(正背面分界)、赤道
      const curve = (pts: [number, number][], dash: number[], color: string) => {
        g.setLineDash(dash);
        g.strokeStyle = color;
        g.lineWidth = 1;
        g.beginPath();
        let on = false;
        for (const [lo, la] of pts) {
          const p = P(lo, la);
          if (!p) { on = false; continue; }
          if (on) g.lineTo(p[0], p[1]);
          else g.moveTo(p[0], p[1]);
          on = true;
        }
        g.stroke();
        g.setLineDash([]);
      };
      for (const lo of [-90, 90]) curve(Array.from({ length: 91 }, (_, i) => [lo, -90 + i * 2] as [number, number]), [6, 5], 'rgba(255,230,160,0.6)');
      curve(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, 0] as [number, number]), [], 'rgba(255,255,255,0.12)');
    } else {
      g.imageSmoothingQuality = 'high';
      if (base) for (const k of [-1, 0, 1]) if (ox + k * mw < w && ox + (k + 1) * mw > 0) g.drawImage(base.canvas, ox + k * mw, oy, mw, mh);
      const X = (lon: number) => {
        let x = ox + ((lon + 180) / 360) * mw;
        while (x > w) x -= mw;
        while (x < 0) x += mw;
        return x;
      };
      const Y = (lat: number) => oy + ((90 - lat) / 180) * mh;
      P = (lon, lat) => [X(lon), Y(lat)];
      g.lineWidth = 1;
      for (let lon = -150; lon <= 180; lon += 30) {
        const far = Math.abs(lon) === 90;
        g.setLineDash(far ? [6, 5] : []);
        g.strokeStyle = far ? 'rgba(255,230,160,0.6)' : 'rgba(255,255,255,0.1)';
        g.beginPath();
        g.moveTo(X(lon), oy);
        g.lineTo(X(lon), oy + mh);
        g.stroke();
      }
      g.setLineDash([]);
      g.strokeStyle = 'rgba(255,255,255,0.1)';
      for (let lat = -60; lat <= 60; lat += 30) {
        g.beginPath();
        g.moveTo(0, Y(lat));
        g.lineTo(w, Y(lat));
        g.stroke();
      }
    }

    const fs = 13;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const boxes: [number, number, number, number][] = [];
    const label = (t: string, x: number, y: number, sz: number, color: string) => {
      if (x < -60 || x > w + 60 || y < -20 || y > h + 20) return;
      g.font = `${sz}px sans-serif`;
      const tw = g.measureText(t).width / 2 + 2, th = sz / 2 + 1;
      if (boxes.some(([a, b, c2, d]) => x - tw < c2 && x + tw > a && y - th < d && y + th > b)) return;
      boxes.push([x - tw, y - th, x + tw, y + th]);
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(t, x, y);
      g.fillStyle = color;
      g.fillText(t, x, y);
    };
    for (const s of sites) {
      const p = P(s.lon, s.lat);
      if (!p) continue;
      const [x, y] = p;
      g.lineWidth = 2;
      g.strokeStyle = '#000';
      if (s.kind === 'land') {
        g.fillStyle = '#ffb347';
        g.beginPath();
        g.arc(x, y, 5, 0, Math.PI * 2);
        g.fill();
        g.stroke();
      } else if (s.kind === 'base') {
        g.fillStyle = '#7fd6ff';
        g.fillRect(x - 5, y - 5, 10, 10);
        g.strokeRect(x - 5, y - 5, 10, 10);
      } else {
        g.strokeStyle = '#ff6b6b';
        g.beginPath();
        g.moveTo(x - 8, y);
        g.lineTo(x + 8, y);
        g.moveTo(x, y - 8);
        g.lineTo(x, y + 8);
        g.stroke();
      }
      label(s.label, x, y - 14, fs, s.kind === 'iv' ? '#ffb0b0' : s.kind === 'base' ? '#bde9ff' : '#ffd9a0');
    }
    if (moonGlobe) {
      label(Math.abs(orb.lon) <= 90 ? '月球正面' : '月球背面', gcx, Math.max(14, gcy - R - 14), fs + 1, 'rgba(255,230,160,0.95)');
    } else {
      const top = oy + 14;
      const a = P(0, 0), b = P(180, 0);
      if (a) label('月球正面', a[0], top, fs + 1, 'rgba(255,230,160,0.95)');
      if (b) label('月球背面', b[0], top, fs + 1, 'rgba(255,230,160,0.95)');
    }
    for (const m of atlas.maria) {
      const p = P(m.lon, m.lat);
      if (p) label(m.name, p[0], p[1], fs + (m.kind === 'ocean' ? 3 : 1), '#e8eefc');
    }
    // 环形山:屏上半径够大的才写(球上按到中心的远近估缩短)
    const kmPx = moonGlobe ? MOON_R / R : (Math.PI * MOON_R) / mh;
    for (const c0 of atlas.craters) {
      if (c0.r / kmPx <= 11) continue;
      const p = P(c0.lon, c0.lat);
      if (p) label(c0.name, p[0], p[1], fs - 1, 'rgba(255,255,255,0.78)');
    }
    if (pick) {
      const p = P(pick.lon, pick.lat);
      if (p) {
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(p[0], p[1], 9, 0, Math.PI * 2);
        g.stroke();
      }
    }
    if (!base) label('月面图生成中…', w / 2, h / 2, 16, '#fff');
  }, [size, base, atlas, sites, pick, ox, oy, mw, mh, moonGlobe, fr, R, gcx, gcy, orb.lon]);

  const info = pick ?? hover;
  const nextLand = [...race.landings.values()].filter((s) => s.year >= year).sort((a, b) => a.year - b.year)[0];
  const zoomAt = (cx: number, cy: number, f: number) => {
    if (moonGlobe) return setOrb((o) => ({ ...o, z: Math.max(0.6, Math.min(8, o.z * f)) }));
    setView((v) => {
      const s = Math.max(1, Math.min(6, v.s * f));
      const k = s / v.s;
      return { s, x: cx - (cx - v.x) * k, y: cy - (cy - clampY(v.y)) * k };
    });
  };

  return (
    <div ref={box} className="moon-view" onDoubleClick={(e) => e.stopPropagation()}>
      <canvas
        ref={cv}
        className="moon-cv"
        style={{ width: size.w, height: size.h }}
        onWheel={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: oy, lon: orb.lon, lat: orb.lat, moved: false };
        }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const d = drag.current;
          if (d) {
            const dx = e.clientX - d.x, dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) {
              if (moonGlobe) {
                // 拖着球转:往右拖 = 看西边(正对的经度减小);上下同理,纬度夹在 ±85°
                const lon = d.lon - (dx / R) / RAD;
                setOrb((o) => ({ ...o, lon: ((((lon + 180) % 360) + 360) % 360) - 180, lat: Math.max(-85, Math.min(85, d.lat + (dy / R) / RAD)) }));
              } else setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
            }
          }
          setHover(toLL(e.clientX - r.left, e.clientY - r.top));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) {
            const r = e.currentTarget.getBoundingClientRect();
            const p = toLL(e.clientX - r.left, e.clientY - r.top);
            if (p) {
              setPick(p);
              setSent('');
            }
          }
        }}
        onPointerLeave={() => setHover(null)}
      />
      <div className="moon-card glass">
        <div className="moon-title">
          <strong>月球</strong>
          {moonGlobe && (
            <button type="button" className="sp-link" onClick={() => setOrb({ lon: 0, lat: 0, z: 1 })}>
              正对正面
            </button>
          )}
          <button type="button" className="sp-link" onClick={() => setMoonView(false)}>
            回到地球
          </button>
        </div>
        {info ? (
          <div className="moon-info">
            <span className="sp-place">{moonPlaceName(atlas, info.lon, info.lat)}</span>
            <span className="sp-coord">{moonCoordText(info.lon, info.lat)}</span>
            {farSide(info.lon) && <span className="sp-note">月背:那国登月前一年会先发射中继卫星</span>}
          </div>
        ) : (
          <div className="sp-note">点一下月面选着陆点;拖动{moonGlobe ? '转动' : '平移'},滚轮缩放</div>
        )}
        {pick && (
          <div className="moon-act">
            <button
              type="button"
              className="moon-btn"
              onClick={() => {
                const ok = addIntervention({ kind: 'moonsite', from: year, lon: pick.lon, lat: pick.lat });
                setSent(ok ? `已设为第 ${year} 年以后头一次载人登月的着陆点,重推历史后改写` : '没有收下(可能已有一样的一条)');
              }}
            >
              设为下一次登月的着陆点
            </button>
            <span className="sp-note">{sent || (nextLand ? `按现在的历史,下一次登月在第 ${Math.floor(nextLand.year)} 年` : '按现在的历史,此后没有登月')}</span>
          </div>
        )}
        <div className="sp-legend">
          <span className="sp-k sp-k-land" />着陆点 <span className="sp-k sp-k-base" />殖民城市 <span className="sp-k sp-k-iv" />作者指定
        </div>
      </div>
    </div>
  );
}
