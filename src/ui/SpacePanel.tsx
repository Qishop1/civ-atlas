/**
 * 本地分支 modern-pace:「航天」面板(顶栏填色按钮"思潮"后面的「航天」开 / 关;第一颗人造卫星上天那年起才有这个按钮)。
 * 跟着时间轴,只列到这一年为止的:
 *   太空竞赛  一国一行(按最早办成的那件排),列 = 人造卫星、绕月探测、载人航天……;格子写年份,世上头一个的高亮;"领先:某国(N 项世界第一)"
 *   太空大事  spaceText.ts 写的那些条目(不进编年史,只在这里),新的在上
 *   月球      第一次绕月探测以后:「到月球视图里看」(右下角的「月球」一样)
 */
import { useMemo } from 'react';
import type { Civ } from '../gen/civ/types';
import { polityName } from '../gen/civ/growth';
import { SPACE_MILES, spaceEntries, spaceRace, type SpaceMile } from '../gen/civ/story/spaceText';
import { bodyName, colonies, colonyEntries, colonyName, colonyOwner, colonyPop, colonyState, headText } from '../gen/civ/story/colonies';
import { useYear } from './WorldOverviewMarks';
import { closeSpacePanel, setMoonView, useSpaceUi, useUnlocks } from './spaceStore';
import './space.css';

const entryCache = new WeakMap<Civ, ReturnType<typeof spaceEntries>>();
function entriesOf(civ: Civ) {
  let e = entryCache.get(civ);
  if (!e) {
    const a = spaceEntries(civ, 0);
    e = [...a, ...colonyEntries(civ, a.length)].sort((x, y) => x.year - y.year);
    entryCache.set(civ, e);
  }
  return e;
}

export function SpacePanel({ civ }: { civ: Civ | null }) {
  const { panel } = useSpaceUi();
  const unl = useUnlocks(civ);
  if (!panel || !civ || !civ.viable || !unl.space) return null;
  return <SpaceBody civ={civ} moon={unl.moon} />;
}

function SpaceBody({ civ, moon }: { civ: Civ; moon: boolean }) {
  const year = useYear(civ);
  const race = useMemo(() => spaceRace(civ), [civ]);
  const rows = useMemo(() => {
    const out: { pid: number; first: number; cells: Map<SpaceMile, number> }[] = [];
    for (const [pid, m] of race.done) {
      const cells = new Map<SpaceMile, number>();
      for (const [k, y] of m) if (y <= year) cells.set(k, Math.floor(y));
      if (cells.size) out.push({ pid, first: Math.min(...cells.values()), cells });
    }
    return out.sort((a, b) => a.first - b.first || a.pid - b.pid);
  }, [race, year]);
  const firstHere = (k: SpaceMile, pid: number) => {
    const f = race.firstOf.get(k);
    return !!f && f.p === pid && f.y <= year;
  };
  const leader = useMemo(() => {
    const n = new Map<number, number>();
    for (const [, f] of race.firstOf) if (f.y <= year) n.set(f.p, (n.get(f.p) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  }, [race, year]);
  const news = useMemo(() => entriesOf(civ).filter((e) => e.year <= year + 0.999).reverse(), [civ, year]);
  const pn = (pid: number) => polityName(civ.polities[pid], year);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div className="sp-panel glass" role="dialog" aria-label="航天" onPointerDown={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="sp-head">
        <strong>航天</strong>
        <span className="sp-note">第 {year} 年</span>
        {moon && (
          <button type="button" className="sp-link" onClick={() => { setMoonView(true); closeSpacePanel(); }}>
            到月球视图里看 ›
          </button>
        )}
        <button type="button" className="sp-x" aria-label="关闭" onClick={closeSpacePanel}>
          ×
        </button>
      </div>
      <div className="sp-body">
        <h3 className="sp-h">太空竞赛</h3>
        {!rows.length ? (
          <p className="sp-note">还没有国家进入太空</p>
        ) : (
          <>
            {leader && <p className="sp-lead">领先:{pn(leader[0])}({leader[1]} 项世界第一)</p>}
            <div className="sp-scroll">
              <table className="sp-table">
                <thead>
                  <tr>
                    <th>国家</th>
                    {SPACE_MILES.map((m) => (
                      <th key={m.key}>{m.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.pid}>
                      <td className="sp-who">{pn(r.pid)}</td>
                      {SPACE_MILES.map((m) => {
                        const y = r.cells.get(m.key);
                        const first = y !== undefined && firstHere(m.key, r.pid);
                        return (
                          <td key={m.key} className={y === undefined ? 'sp-none' : first ? 'sp-first' : ''} title={first ? '世界第一' : undefined}>
                            {y ?? '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <ColonyTable civ={civ} year={year} />
        <h3 className="sp-h">太空大事</h3>
        <ol className="sp-news">
          {news.map((e) => (
            <li key={e.id} className={e.importance >= 3 ? 'big' : ''}>
              <span className="sp-y">{Math.floor(e.year)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** 第三十七轮:殖民地(colonies.ts):这一年已经建立的,名字、在哪、归谁、人口、状态 */
function ColonyTable({ civ, year }: { civ: Civ; year: number }) {
  const list = useMemo(() => colonies(civ), [civ]);
  const rows = list.filter((c) => c.founded <= year).sort((a, b) => colonyPop(b, year) - colonyPop(a, year));
  if (!rows.length) return null;
  return (
    <>
      <h3 className="sp-h">殖民地</h3>
      <div className="sp-scroll">
        <table className="sp-table sp-col">
          <thead>
            <tr>
              <th>名称</th>
              <th>所在</th>
              <th>归属</th>
              <th>人口</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const o = colonyOwner(c, year);
              return (
                <tr key={c.id}>
                  <td className="sp-who">{colonyName(c, year)}</td>
                  <td>{bodyName(civ, c.body)}</td>
                  <td>{o >= 0 ? polityName(civ.polities[o], year) : '—'}</td>
                  <td>{headText(colonyPop(c, year)).replace(/^约 /, '')}</td>
                  <td>{colonyState(c, year)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
