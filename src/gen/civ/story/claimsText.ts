/**
 * 本地分支 modern-pace 第七十五轮:近现代瓜分无主地的编年史(只读 claims.ts 的认领,不改推演;标签"疆")。
 *   一片地头一回被两国以上分掉:"甲、乙签订《某城条约》,以东经 X° 为界瓜分某某荒漠"(分界近南北向写经线、近东西向写纬线,别的写一条直线);
 *   一大片地(≥ BIG_ZONE 州)头一回被一国单独拿下:"甲宣布某某为本国领土";
 *   地名用地图上的荒漠 / 山脉 / 岛屿名;没有的按冰原 / 荒原叫。每个世界至多 MAX_ENTRIES 条。
 * 要有登记过的世界(claims.ts 的 rememberWorld;App 拿到世界就登记);没有就不写。
 */
import type { Civ, Year } from '../types';
import { polityName, capitalAt } from '../growth';
import { ICE_SHEET_T } from '../../world';
import { CLAIM_STEP, claimsAt, knownWorld } from './claims';
import { cityNameAt } from './cityNames';
import type { ChronicleEntry } from './chronicle';

const BIG_ZONE = 8;
const MAX_ENTRIES = 40;

export function claimEntries(civ: Civ, idBase: number): ChronicleEntry[] {
  const world = knownWorld(civ);
  if (!world || !civ.viable) return [];
  let first = Infinity;
  for (const P of civ.polities) first = Math.min(first, P.modern?.[0] ?? Infinity, P.modernName ?? Infinity);
  if (!Number.isFinite(first)) return [];
  const R = civ.regions;
  const W = world.width;
  // 州 → 地图上的地名(荒漠、山脉、岛;取重要的)
  const placeOf = new Map<number, { name: string; rank: number; kind: string }>();
  for (const pl of civ.places) {
    if ((pl.kind !== 'desert' && pl.kind !== 'mountains' && pl.kind !== 'island') || pl.cell === undefined) continue;
    const r = R.of[pl.cell];
    if (r < 0) continue;
    const o = placeOf.get(r);
    if (!o || pl.rank > o.rank) placeOf.set(r, { name: pl.name, rank: pl.rank, kind: pl.kind });
  }
  const pn = (p: number, y: Year) => (civ.polities[p] ? polityName(civ.polities[p], y) : '');
  const seen = new Set<string>();
  /** 分过一回的地名(再分 = 重新划分) */
  const parted = new Set<string>();
  /** 一国一年单独宣布的几处(合成一条) */
  const solo = new Map<string, { y: Year; p: number; names: string[]; regions: number[] }>();
  const cand: { y: Year; text: string; ps: number[]; imp: 1 | 2; regions: number[] }[] = [];
  for (let y = Math.ceil(first / CLAIM_STEP) * CLAIM_STEP; y <= civ.endYear; y += CLAIM_STEP) {
    const c = claimsAt(civ, world, y);
    c.zones.forEach((zone) => {
      const got = new Map<number, number>();
      for (const r of zone.regions) if (c.owner[r] >= 0) got.set(c.owner[r], (got.get(c.owner[r]) ?? 0) + 1);
      if (!got.size) return;
      const ps = [...got.keys()].sort((a, b) => (got.get(b)! - got.get(a)!) || a - b);
      if (ps.length < 2 && zone.regions.length < BIG_ZONE) return;
      // 名字:这片地里地图上标了的荒漠 / 山脉 / 岛
      let place: { name: string; rank: number; kind: string } | undefined;
      for (const r of zone.regions) {
        const o = placeOf.get(r);
        if (o && (!place || o.rank > place.rank)) place = o;
      }
      let icy = 0;
      for (const r of zone.regions) if (world.temperature[R.seat[r]] < ICE_SHEET_T) icy++;
      const name = place?.name ?? (icy * 2 > zone.regions.length ? '一片冰原' : '一片无主的荒原');
      const key = `${ps.join(',')}|${place?.name ?? zone.regions[0]}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (ps.length >= 2) {
        // 头两家的分界:近南北向写经线、近东西向写纬线
        const A = zone.anchors.find((q) => q.p === ps[0]),
          B0 = zone.anchors.find((q) => q.p === ps[1]);
        let line = '以一条直线为界';
        if (A && B0) {
          const bx = B0.x - Math.round((B0.x - A.x) / W) * W;
          const nx = bx - A.x,
            ny = B0.y - A.y;
          const dx = -ny,
            dy = nx;
          const len = Math.hypot(dx, dy) || 1;
          // 分界线上离两锚点中点最近的那一点
          const nn = nx * nx + ny * ny;
          const cc = (bx * bx + B0.y * B0.y - A.x * A.x - A.y * A.y - B0.w + A.w) / 2;
          const mx = (A.x + bx) / 2,
            my = (A.y + B0.y) / 2;
          const t = nn > 0 ? (nx * mx + ny * my - cc) / nn : 0;
          const qx = mx - t * nx,
            qy = my - t * ny;
          if (Math.abs(dx) / len < 0.25) {
            const lon = (((((qx % W) + W) % W) / W) * 360 - 180);
            line = `以${lon >= 0 ? '东经' : '西经'} ${Math.abs(Math.round(lon))}° 为界`;
          } else if (Math.abs(dy) / len < 0.25) {
            const lat = 90 - (180 * qy) / world.height;
            line = `以${lat >= 0 ? '北纬' : '南纬'} ${Math.abs(Math.round(lat))}° 为界`;
          }
        }
        const cap = capitalAt(civ.polities[ps[0]], y);
        const city = cap >= 0 ? cityNameAt(civ, cap, y) : '';
        const treaty = city ? `签订《${city}条约》,` : '签约,';
        const again = parted.has(name) && place !== undefined;
        parted.add(name);
        cand.push({ y, text: `${ps.slice(0, 3).map((p) => pn(p, y)).join('、')}${treaty}${line}${again ? '重新划分' : '瓜分'}${name}`, ps: ps.slice(0, 3), imp: 2, regions: zone.regions.slice(0, 1) });
      } else {
        const p = ps[0];
        const k = `${y}|${p}`;
        const o = solo.get(k) ?? { y, p, names: [], regions: [] };
        o.names.push(name);
        o.regions.push(zone.regions[0]);
        solo.set(k, o);
      }
    });
  }
  for (const o of solo.values()) {
    const ns = [...new Set(o.names)];
    const list = ns.length > 3 ? `${ns.slice(0, 3).join('、')}等 ${ns.length} 处` : ns.join('、');
    cand.push({ y: o.y, text: `${pn(o.p, o.y)}宣布${list}为本国领土`, ps: [o.p], imp: 1, regions: o.regions.slice(0, 1) });
  }
  // 至多 MAX_ENTRIES 条:瓜分的先留,再按年份
  cand.sort((a, b) => b.imp - a.imp || a.y - b.y);
  const keep = cand.slice(0, MAX_ENTRIES).sort((a, b) => a.y - b.y);
  let id = idBase;
  return keep.map((c) => ({ id: id++, kind: 'partition', year: c.y, end: c.y, text: c.text, tag: '疆', importance: c.imp, polities: c.ps, regions: c.regions, settlement: -1 }));
}
