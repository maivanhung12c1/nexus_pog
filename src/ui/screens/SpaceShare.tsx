// Space Share workspace: a set of POGs (projects, .plnx, PDF, .json), grouped by any product field, measured by
// linear / facings / SKU / area / stock, with a focus manufacturer, scope, baseline, deltas and SKU changes.
// Answers first: "What share does <own maker> hold, and how did it move against the baseline?"
import { useMemo, useState } from 'react';
import { aggregate, DIMS, dimLabel, groupColors, METRICS, positions, rpVal, share, skuChanges, varyingDims, type Metric, type Positions, type Scope } from '../../domain/analysis/spaceShare';
import { fmt, L } from '../../domain/i18n';
import type { Design } from '../../domain/types';
import { uid } from '../../domain/util';
import { usePrefs } from '../../app/prefs';
import { toast, useWorkspace, workspace, type PogEntry } from '../../app/workspace';
import { buildPog, download, importPlnxFile, readPdf, readProjectFile } from '../../app/io';
import { toCSV } from '../../infra/csv';
import { AppFrame } from '../shell/AppFrame';
import { Button, DropZone, Empty, Field, FileButton, Menu, Pill, Segmented, Select } from '../ds';
import { go } from '../router';
import { SpaceShareReport } from './SpaceShareReport';

export interface ShareView { dim: string; metric: Metric; focus: string; scope: Scope | null; baseline: string; active: string; cmpB: string }

export function SpaceShare({ path }: { path: string }) {
  const set = useWorkspace((s) => s.pogSet), projects = useWorkspace((s) => s.projects), own = usePrefs((s) => s.ownMaker), comp = usePrefs((s) => s.competitor);
  usePrefs((s) => s.lang);
  const [v, setV] = useState<ShareView>({ dim: 'maker', metric: 'lin', focus: own.toUpperCase(), scope: null, baseline: '', active: '', cmpB: '' });
  const [report, setReport] = useState(false), [busy, setBusy] = useState('');
  const inc = set.filter((p) => p.include);
  const data = useMemo(() => new Map(set.map((p) => [p.id, positions(p.design)])), [set]);
  const dims = useMemo(() => { const v = varyingDims([...data.values()]); return v.length ? v : DIMS.slice(0, 8); }, [data]); // nothing varies (e.g. one SKU): offer the basic fields
  const dim = dims.find((d) => d[0] === v.dim) ? v.dim : (dims[0]?.[0] || 'maker');
  const tot = new Map<string, number>();
  for (const p of inc) for (const r of aggregate(data.get(p.id)!, dim, null).rows) tot.set(r.key, (tot.get(r.key) || 0) + r.lin);
  const keys = [...tot].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const focus = keys.includes(v.focus) ? v.focus : keys.find((k) => k.includes(own.toUpperCase())) || keys[0] || '';
  const colors = groupColors(keys, focus, comp.toUpperCase());
  const baseline = inc.find((p) => p.id === v.baseline)?.id || inc[0]?.id || '';
  const active = inc.find((p) => p.id === v.active)?.id || baseline;
  const m = v.metric, scope = v.scope && [...data.values()].some((P) => P.pos.some((p) => rpVal(p.k, v.scope!.dim) === v.scope!.val)) ? v.scope : null;
  const agg = (id: string) => aggregate(data.get(id)!, dim, scope);
  const add = async (files: File[]) => {
    for (const f of files) {
      setBusy(L('Đang đọc ', 'Reading ') + f.name);
      try {
        if (/\.(plnx|zip)$/i.test(f.name)) { const r = await importPlnxFile(f); for (const b of r.built) await workspace.addPog(b.design, f.name); }
        else if (/\.pdf$/i.test(f.name)) { const pogs = await readPdf(f); for (const p of pogs) await workspace.addPog(buildPog(p).design, f.name); }
        else { const r = await readProjectFile(f); if (r.kind === 'v6library') throw Error('V6 library'); await workspace.addPog(r.design, f.name); }
      } catch (e) { toast(L('Không mở được ', 'Could not open ') + f.name + ': ' + (e as Error).message, 'danger'); }
    }
    setBusy('');
  };
  const update = (list: PogEntry[]) => workspace.setPogs(list);
  if (report) return <SpaceShareReport set={inc} view={{ ...v, dim, focus, baseline, active, scope }} onClose={() => setReport(false)} />;

  const A = active ? agg(active) : null, B = baseline ? agg(baseline) : null;
  const fShare = A ? share(A, focus, m) : 0, bShare = B ? share(B, focus, m) : 0;
  const scopeVals = [...new Set([...data.values()].flatMap((P) => P.pos.map((p) => rpVal(p.k, v.scope?.dim || 'cat'))))].sort();
  const otherB = inc.find((p) => p.id === v.cmpB && p.id !== baseline) || inc.find((p) => p.id !== baseline);

  return <AppFrame path={path} title="Space Share">
    <div className="page">
      <div className="page-head">
        <div><h1>Space Share</h1><p className="lead">{inc.length ? L(`${focus} chiếm ${fmt(fShare * 100, 1)}% ${METRICS[m].label().toLowerCase()} trên ${set.find((p) => p.id === active)?.name}`, `${focus} holds ${fmt(fShare * 100, 1)}% of ${METRICS[m].label().toLowerCase()} on ${set.find((p) => p.id === active)?.name}`) + (active !== baseline ? ` · ${fmt((fShare - bShare) * 100, 1)} pp ${L('so với mốc', 'vs baseline')}` : '') : L('So sánh share trên kệ giữa các POG: hiện trạng, đề xuất, các store.', 'Compare shelf share across POGs: current, proposal, stores.')}</p></div>
        <div className="actions">
          <Menu label={L('Thêm POG', 'Add POG')} icon="plus" items={[
            { header: L('Từ dự án trên máy', 'From a project') }, ...projects.slice(0, 12).map((p) => ({ label: p.name, onClick: async () => { const d = await workspace.loadDesign(p.id); if (d) await workspace.addPog(d, L('dự án', 'project'), p.name); } })),
          ]} />
          <FileButton accept=".plnx,.zip,.pdf,.json" multiple icon="upload" onFiles={add}>{L('Thêm file', 'Add files')}</FileButton>
          {inc.length > 0 && <Button icon="download" onClick={() => exportCsv(inc, data, dim, m, scope, keys)}>CSV</Button>}
          {inc.length > 0 && <Button variant="primary" icon="print" onClick={() => setReport(true)}>{L('Báo cáo PDF', 'PDF report')}</Button>}
        </div>
      </div>
      {busy && <div className="notice info" style={{ marginBottom: 16 }}>{busy}…</div>}
      {!set.length ? <><Empty>{L('Chưa có POG nào. Thêm từ dự án, hoặc kéo-thả .plnx / PDF / .json vào ô dưới.', 'No POGs yet. Add from a project, or drop .plnx / PDF / .json files below.')}</Empty><div style={{ marginTop: 12 }}><DropZone onFiles={add} accept={/\.(plnx|zip|pdf|json)$/i}>{L('Kéo-thả nhiều file vào đây', 'Drop several files here')}</DropZone></div></> :
        <div className="ss-layout">
          <aside>
            <div className="section-head"><h2>POG</h2><span className="lead">{inc.length}/{set.length}</span></div>
            <div className="pog-list">{set.map((p) => { const P = data.get(p.id)!, G = aggregate(P, 'maker', null); return <div key={p.id} className={'pog-item' + (p.id === active ? ' on' : '')} onClick={() => p.include && setV({ ...v, active: p.id })}>
              <input type="checkbox" checked={p.include} aria-label={L('Đưa vào so sánh', 'Include in comparison')} onClick={(e) => e.stopPropagation()} onChange={(e) => update(set.map((x) => (x.id === p.id ? { ...x, include: e.target.checked } : x)))} />
              <div style={{ minWidth: 0 }}><div className="nm">{p.name}{p.id === baseline && <> <Pill>{L('mốc', 'baseline')}</Pill></>}</div><small>{P.pos.length} {L('vị trí', 'positions')} · {G.T.sku} SKU · {p.src}</small></div>
              <Menu icon="more" variant="ghost" size="sm" items={[
                { label: L('Đặt làm mốc', 'Set as baseline'), onClick: () => setV({ ...v, baseline: p.id }) },
                { label: L('Mở để chỉnh (thành dự án)', 'Open to edit (as a project)'), onClick: async () => { const id = await workspace.createProject(structuredClone(p.design), own, comp); go('/p/' + id); } },
                { label: L('Đổi tên', 'Rename'), onClick: () => { const n = prompt(L('Tên POG', 'POG name'), p.name); if (n) update(set.map((x) => (x.id === p.id ? { ...x, name: n } : x))); } },
                { label: L('Bỏ khỏi danh sách', 'Remove from set'), onClick: () => update(set.filter((x) => x.id !== p.id)) },
              ]} /></div>; })}</div>
            <div style={{ marginTop: 12 }}><DropZone onFiles={add} accept={/\.(plnx|zip|pdf|json)$/i}><span className="small">{L('Kéo-thả thêm .plnx / PDF / .json', 'Drop more .plnx / PDF / .json')}</span></DropZone></div>
          </aside>
          <div style={{ minWidth: 0 }}>
            <div className="controls-row">
              <Field label={L('Nhóm theo', 'Group by')}><Select value={dim} options={dims.map(([k, f]) => [k, f()] as [string, string])} onChange={(d) => setV({ ...v, dim: d })} /></Field>
              <Field label={L('Đo theo', 'Measure')}><Segmented<Metric> value={m} options={(Object.keys(METRICS) as Metric[]).map((k) => [k, METRICS[k].label()])} onChange={(x) => setV({ ...v, metric: x })} /></Field>
              <Field label={L('Nhóm theo dõi', 'Focus group')}><Select value={focus} options={keys.map((k) => [k, k] as [string, string])} onChange={(f) => setV({ ...v, focus: f })} /></Field>
              <Field label={L('Phạm vi', 'Scope')}><div style={{ display: 'flex', gap: 6 }}><Select value={v.scope?.dim || 'cat'} options={dims.map(([k, f]) => [k, f()] as [string, string])} onChange={(d) => setV({ ...v, scope: v.scope ? { dim: d, val: '' } : { dim: d, val: '' } })} />
                <Select style={{ minWidth: 150 }} value={scope?.val || ''} options={[['', L('Toàn bộ kệ', 'Whole shelf')], ...scopeVals.map((x) => [x, x] as [string, string])]} onChange={(val) => setV({ ...v, scope: val ? { dim: v.scope?.dim || 'cat', val } : null })} /></div></Field>
            </div>

            {A && <div className="kpis" style={{ marginBottom: 24 }}>
              <div className="kpi lead"><div className="label">{focus} · {METRICS[m].label()} share{scope ? ' · ' + scope.val : ''}</div><div className="value">{fmt(fShare * 100, 1)}<span className="unit">%</span></div><div className="sub">{active === baseline ? L('đây là mốc so sánh', 'this is the baseline') : <Delta v={fShare - bShare} label={L('so với mốc', 'vs baseline')} />}</div></div>
              <div className="kpi"><div className="label">Linear</div><div className="value">{fmt(A.T.lin, 0)}<span className="unit">cm</span></div></div>
              <div className="kpi"><div className="label">Facings</div><div className="value">{fmt(A.T.fac, 0)}</div></div>
              <div className="kpi"><div className="label">SKU</div><div className="value">{A.T.sku}</div></div>
              <div className="kpi"><div className="label">Stock</div><div className="value">{fmt(A.T.stk, 0)}<span className="unit">{L('đv', 'u')}</span></div></div>
            </div>}

            {inc.length >= 2 && <section style={{ marginBottom: 32 }}>
              <div className="section-head"><h2>{L('So sánh các POG', 'Compare POGs')}</h2><span className="lead">{METRICS[m].label()} share · Δ {L('theo điểm % so với mốc', 'in percentage points vs the baseline')}</span></div>
              <div className="stack-rows">{inc.map((p) => { const G = agg(p.id), s0 = share(G, focus, m), d = s0 - share(B!, focus, m); return <div key={p.id} className="stack-row">
                <span className="nm" title={p.name}>{p.name}{p.id === baseline && <> <Pill>{L('mốc', 'baseline')}</Pill></>}</span>
                <div className="stackbar">{keys.map((k) => { const sv = share(G, k, m); return sv > 0 ? <div key={k} style={{ width: sv * 100 + '%', background: colors.get(k) }} title={`${k} ${fmt(sv * 100, 1)}%`}>{sv > 0.07 ? fmt(sv * 100, 0) + '%' : ''}</div> : null; })}</div>
                <span className="num">{fmt(s0 * 100, 1)}% {p.id !== baseline && <Delta v={d} small />}</span></div>; })}</div>
              <div className="legend" style={{ marginTop: 10 }}>{keys.slice(0, 10).map((k) => <span key={k}><i className="swatch" style={{ background: colors.get(k) }} />{k}</span>)}{keys.length > 10 && <span>+{keys.length - 10}</span>}</div>
            </section>}

            {A && <div className="two-col">
              <section><div className="section-head"><h2>{L('Share theo nhóm', 'Share by group')}</h2><span className="lead">{dimLabel(dim)} · {set.find((p) => p.id === active)?.name}</span></div>
                <div className="table-wrap"><table className="t"><thead><tr><th>{dimLabel(dim)}</th><th className="num">Share</th><th className="num">Δ</th><th className="num">cm</th><th className="num">F</th><th className="num">SKU</th></tr></thead>
                  <tbody>{[...A.rows].sort((a, b) => b[m] - a[m]).map((r) => { const s0 = A.T[m] ? r[m] / A.T[m] : 0, d = s0 - share(B!, r.key, m); return <tr key={r.key} className={r.key === focus ? 'selected' : ''}><td><span className="dot" style={{ background: colors.get(r.key) }} />{r.key}</td><td className="num">{fmt(s0 * 100, 1)}%</td><td className="num">{active === baseline ? <span className="dash">—</span> : <Delta v={d} small neutral={r.key !== focus} />}</td><td className="num">{fmt(r.lin)}</td><td className="num">{fmt(r.fac, 0)}</td><td className="num">{r.sku}</td></tr>; })}</tbody>
                  <tfoot><tr><td>{L('Tổng', 'Total')}</td><td></td><td></td><td className="num">{fmt(A.T.lin)}</td><td className="num">{fmt(A.T.fac, 0)}</td><td className="num">{A.T.sku}</td></tr></tfoot></table></div></section>
              <section><div className="section-head"><h2>{L('Sơ đồ kệ', 'Shelf map')}</h2><span className="lead">{L('mặt trước, tô theo nhóm', 'front, coloured by group')}</span></div>
                <ShareMap P={data.get(active)!} dim={dim} scope={scope} colors={colors} /></section>
            </div>}

            {inc.length >= 2 && otherB && <section className="section">
              <div className="section-head"><h2>{L('Thay đổi SKU', 'SKU changes')}</h2><span className="lead">{L('mốc', 'baseline')}: {set.find((p) => p.id === baseline)?.name} →</span>
                <div className="actions"><Select value={otherB.id} options={inc.filter((p) => p.id !== baseline).map((p) => [p.id, p.name] as [string, string])} onChange={(x) => setV({ ...v, cmpB: x })} /></div></div>
              <SkuChangeTable A={data.get(baseline)!} B={data.get(otherB.id)!} scope={scope} dim={dim} />
            </section>}
          </div>
        </div>}
    </div>
  </AppFrame>;
}

export function Delta({ v, small, label, neutral }: { v: number; small?: boolean; label?: string; neutral?: boolean }) {
  const pp = v * 100, zero = Math.abs(pp) < 0.05;
  return <span className={'delta ' + (zero || neutral ? 'zero' : pp > 0 ? 'up' : 'down')} style={small ? { fontSize: 12 } : undefined}>{zero ? '±0.0' : (pp > 0 ? '+' : '−') + fmt(Math.abs(pp), 1)} pp{label ? ' ' + label : ''}</span>;
}

export function ShareMap({ P, dim, scope, colors, height = 300 }: { P: Positions; dim: string; scope: Scope | null; colors: Map<string, string>; height?: number }) {
  if (!P.pos.length) return <Empty>{L('POG chưa có sản phẩm.', 'This POG has no products.')}</Empty>;
  const all = [...P.pos.map((p) => ({ x0: p.x0, x1: p.x1, y0: p.y0, y1: p.y1 })), ...P.shelves];
  const x0 = Math.min(...all.map((a) => a.x0)), x1 = Math.max(...all.map((a) => a.x1)), y0 = Math.min(0, ...all.map((a) => a.y0)), y1 = Math.max(...all.map((a) => a.y1)), W = x1 - x0, H = y1 - y0, Y = (v: number) => y1 - v;
  return <div className="map-wrap"><svg viewBox={`${x0 - 2} -2 ${W + 4} ${H + 4}`} preserveAspectRatio="xMinYMin meet" style={{ width: '100%', minWidth: Math.min(1800, Math.max(420, W * 2.2)), height: 'auto', maxHeight: height, display: 'block' }} role="img" aria-label={L('Sơ đồ kệ', 'Shelf map')}>
    {P.shelves.map((s, i) => <rect key={'s' + i} x={s.x0} y={Y(s.y1)} width={s.x1 - s.x0} height={Math.max(0.8, s.y1 - s.y0)} style={{ fill: 'var(--faint)' }} />)}
    {P.pos.map((p) => { const key = rpVal(p.k, dim), off = scope && rpVal(p.k, scope.dim) !== scope.val; return <rect key={p.id} x={p.x0} y={Y(p.y1)} width={Math.max(0.3, p.x1 - p.x0)} height={Math.max(0.3, p.y1 - p.y0)} style={{ fill: off ? 'var(--raised)' : colors.get(key) || 'var(--chart-muted)', stroke: 'var(--surface)' }} strokeWidth={0.3}><title>{`${p.k.name}\n${key} · ${fmt(p.lin)} cm · ${p.fac} F · ${p.stk}`}</title></rect>; })}
  </svg></div>;
}

export function SkuChangeTable({ A, B, scope, dim, limit = 300 }: { A: Positions; B: Positions; scope: Scope | null; dim: string; limit?: number }) {
  const rows = skuChanges(A, B, scope);
  const lab = { new: [L('SKU mới', 'New'), 'positive'], del: [L('SKU bỏ', 'Removed'), 'negative'], up: [L('Tăng facing', 'More facings'), 'info'], dn: [L('Giảm facing', 'Fewer facings'), 'warning'] } as const;
  if (!rows.length) return <Empty>{L('Không có SKU nào thay đổi facing giữa hai POG.', 'No SKU changed facings between the two POGs.')}</Empty>;
  return <>
    <p className="muted small" style={{ marginBottom: 8 }}>{(Object.keys(lab) as (keyof typeof lab)[]).map((k) => `${lab[k][0]}: ${rows.filter((r) => r.st === k).length}`).join(' · ')}</p>
    <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>SKU</th><th>{dimLabel(dim)}</th><th></th><th className="num">F {L('mốc', 'base')}</th><th className="num">F</th><th className="num">cm {L('mốc', 'base')}</th><th className="num">cm</th></tr></thead>
      <tbody>{rows.slice(0, limit).map((r) => <tr key={r.code}><td>{r.k.name}<span className="sub mono">{r.code}</span></td><td>{rpVal(r.k, dim)}</td><td><Pill tone={lab[r.st][1]}>{lab[r.st][0]}</Pill></td><td className="num">{r.a ? r.a.fac : <span className="dash">—</span>}</td><td className="num">{r.b ? r.b.fac : <span className="dash">—</span>}</td><td className="num">{r.a ? fmt(r.a.lin) : <span className="dash">—</span>}</td><td className="num">{r.b ? fmt(r.b.lin) : <span className="dash">—</span>}</td></tr>)}</tbody></table></div>
  </>;
}

function exportCsv(inc: PogEntry[], data: Map<string, Positions>, dim: string, m: Metric, scope: Scope | null, keys: string[]) {
  const rows: unknown[][] = [[`Nexus POG – Space Share`, METRICS[m].label(), dimLabel(dim), scope ? `${scope.dim} = ${scope.val}` : L('Toàn bộ kệ', 'Whole shelf'), new Date().toISOString().slice(0, 10)], [], [dimLabel(dim), ...inc.map((p) => p.name + ' %'), ...inc.map((p) => p.name + ' ' + METRICS[m].unit())]];
  const ag = inc.map((p) => aggregate(data.get(p.id)!, dim, scope));
  for (const k of keys) rows.push([k, ...ag.map((A) => +(share(A, k, m) * 100).toFixed(2)), ...ag.map((A) => +(A.rows.find((r) => r.key === k)?.[m] || 0).toFixed(1))]);
  rows.push([L('Tổng', 'Total'), ...ag.map(() => 100), ...ag.map((A) => +A.T[m].toFixed(1))]);
  download(`Space_Share_${new Date().toISOString().slice(0, 10)}.csv`, toCSV(rows), 'text/csv');
}

export const newPogId = () => uid('g');
export type { Design };
