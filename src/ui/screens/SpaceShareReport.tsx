// Space Share report — a print-ready A4 document (browser "Save as PDF") for Account / sales manager / customer review.
// Every statement is computed from the POGs; findings are facts, not invented advice.
import { aggregate, dimLabel, groupColors, METRICS, positions, share, skuChanges } from '../../domain/analysis/spaceShare';
import { runChecks } from '../../domain/checks';
import { fmt, L } from '../../domain/i18n';
import { Scene } from '../../domain/scene';
import { usedSkus } from '../../domain/shelf/layout';
import { usePrefs } from '../../app/prefs';
import type { PogEntry } from '../../app/workspace';
import { Button } from '../ds';
import { BrandMark } from '../shell/AppFrame';
import type { ShareView } from './SpaceShare';
import { ShareMap } from './SpaceShare';

export function SpaceShareReport({ set, view, onClose }: { set: PogEntry[]; view: ShareView; onClose: () => void }) {
  const comp = usePrefs((s) => s.competitor), by = usePrefs((s) => s.preparedBy);
  const m = view.metric, dim = view.dim, focus = view.focus, scope = view.scope;
  const P = new Map(set.map((p) => [p.id, positions(p.design)])), A = new Map(set.map((p) => [p.id, aggregate(P.get(p.id)!, dim, scope)]));
  const base = set.find((p) => p.id === view.baseline) || set[0];
  const keysAll = new Map<string, number>();
  for (const a of A.values()) for (const r of a.rows) keysAll.set(r.key, (keysAll.get(r.key) || 0) + r.lin);
  const keys = [...keysAll].sort((a, b) => b[1] - a[1]).map((x) => x[0]);
  const colors = groupColors(keys, focus, comp.toUpperCase());
  const B = A.get(base.id)!;
  const findings: string[] = [];
  for (const p of set) {
    if (p.id === base.id) continue;
    const d = share(A.get(p.id)!, focus, m) - share(B, focus, m);
    if (Math.abs(d) >= 0.0005) findings.push(L(`${p.name}: ${focus} ${d > 0 ? 'tăng' : 'giảm'} ${fmt(Math.abs(d) * 100, 1)} điểm % ${METRICS[m].label().toLowerCase()} so với ${base.name}.`, `${p.name}: ${focus} ${d > 0 ? 'gains' : 'loses'} ${fmt(Math.abs(d) * 100, 1)} pp of ${METRICS[m].label().toLowerCase()} vs ${base.name}.`));
    const ch = skuChanges(P.get(base.id)!, P.get(p.id)!, scope);
    const n = (st: string) => ch.filter((c) => c.st === st).length;
    if (ch.length) findings.push(L(`${p.name}: ${n('new')} SKU mới, ${n('del')} SKU bỏ, ${n('up')} tăng facing, ${n('dn')} giảm facing.`, `${p.name}: ${n('new')} new SKUs, ${n('del')} removed, ${n('up')} more facings, ${n('dn')} fewer facings.`));
  }
  const warnings = set.map((p) => { const s = new Scene(p.design), w = runChecks(s); return { p, danger: w.filter((x) => x.level === 'danger').length, est: usedSkus(s).filter((k) => k.est).length }; }).filter((x) => x.danger || x.est);
  const today = new Date().toISOString().slice(0, 10);
  const other = set.find((p) => p.id !== base.id);
  return <div className="sheet" style={{ position: 'fixed', inset: 0, margin: 0, borderRadius: 0, zIndex: 30, background: 'var(--ground)' }}>
    <div className="no-print" style={{ display: 'flex', gap: 8, padding: '12px 16px', position: 'sticky', top: 0, background: 'var(--ground)', zIndex: 2 }}>
      <Button icon="back" onClick={onClose}>{L('Quay lại', 'Back')}</Button><div style={{ flex: 1 }} />
      <span className="muted small" style={{ alignSelf: 'center' }}>{L('In → "Lưu dưới dạng PDF" để có file PDF', 'Print → "Save as PDF" for a PDF file')}</span>
      <Button variant="primary" icon="print" onClick={() => window.print()}>{L('In / Lưu PDF', 'Print / Save PDF')}</Button>
    </div>
    <article className="doc" style={{ marginBottom: 32 }}>
      <div className="doc-head"><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><BrandMark /><div><h1>Space Share — {focus}</h1><div className="muted">{METRICS[m].label()} · {L('nhóm theo', 'by')} {dimLabel(dim)}{scope ? ` · ${scope.dim} = ${scope.val}` : ''}</div></div></div>
        <div className="meta">Nexus POG by VBH<br />{today}{by ? <><br />{L('Người lập', 'Prepared by')}: {by}</> : null}</div></div>

      <h2>{L('Tổng quan', 'Overview')}</h2>
      <table><thead><tr><th>POG</th><th className="num">{focus} share</th><th className="num">Δ {L('vs mốc', 'vs base')}</th><th className="num">Linear cm</th><th className="num">Facings</th><th className="num">SKU</th></tr></thead>
        <tbody>{set.map((p) => { const a = A.get(p.id)!, s0 = share(a, focus, m), d = s0 - share(B, focus, m); return <tr key={p.id}><td>{p.name}{p.id === base.id ? ' (' + L('mốc', 'baseline') + ')' : ''}</td><td className="num"><b>{fmt(s0 * 100, 1)}%</b></td><td className="num">{p.id === base.id ? '—' : (d >= 0 ? '+' : '−') + fmt(Math.abs(d) * 100, 1) + ' pp'}</td><td className="num">{fmt(a.T.lin, 0)}</td><td className="num">{fmt(a.T.fac, 0)}</td><td className="num">{a.T.sku}</td></tr>; })}</tbody></table>

      <h2>{L('Share theo nhóm', 'Share by group')}</h2>
      <table><thead><tr><th>{dimLabel(dim)}</th>{set.map((p) => <th key={p.id} className="num">{p.name.length > 22 ? p.name.slice(0, 21) + '…' : p.name}</th>)}</tr></thead>
        <tbody>{keys.slice(0, 18).map((k) => <tr key={k} style={k === focus ? { fontWeight: 600 } : undefined}><td><span className="dot" style={{ background: colors.get(k) }} />{k}</td>{set.map((p) => <td key={p.id} className="num">{fmt(share(A.get(p.id)!, k, m) * 100, 1)}%</td>)}</tr>)}</tbody></table>

      {set.map((p) => <section key={p.id} style={{ breakInside: 'avoid' }}><h2>{L('Sơ đồ kệ', 'Shelf map')} · {p.name}</h2><ShareMap P={P.get(p.id)!} dim={dim} scope={scope} colors={colors} height={240} /></section>)}
      <div className="legend" style={{ marginTop: 6 }}>{keys.slice(0, 12).map((k) => <span key={k}><i className="swatch" style={{ background: colors.get(k) }} />{k}</span>)}</div>

      {other && <><h2>{L('Thay đổi SKU chính', 'Key SKU changes')} · {base.name} → {other.name}</h2>
        <table><thead><tr><th>SKU</th><th></th><th className="num">F {L('mốc', 'base')}</th><th className="num">F</th></tr></thead><tbody>{skuChanges(P.get(base.id)!, P.get(other.id)!, scope).slice(0, 25).map((r) => <tr key={r.code}><td>{r.k.name} <span className="muted mono" style={{ fontSize: 11 }}>{r.code}</span></td><td>{({ new: L('Mới', 'New'), del: L('Bỏ', 'Removed'), up: L('Tăng F', 'More F'), dn: L('Giảm F', 'Fewer F') })[r.st]}</td><td className="num">{r.a?.fac ?? '—'}</td><td className="num">{r.b?.fac ?? '—'}</td></tr>)}</tbody></table></>}

      <h2>{L('Nhận định từ số liệu', 'Findings from the data')}</h2>
      {findings.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{findings.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="muted">{L('Chỉ có 1 POG – thêm POG để so sánh.', 'Only one POG – add another to compare.')}</p>}

      {warnings.length > 0 && <><h2>{L('Lưu ý dữ liệu', 'Data caveats')}</h2><ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map((w) => <li key={w.p.id}>{w.p.name}: {w.danger ? L(`${w.danger} chỗ giao nhau/vượt cao`, `${w.danger} overlaps/height issues`) : ''}{w.danger && w.est ? ' · ' : ''}{w.est ? L(`${w.est} SKU kích thước ước tính (≈) – linear có thể lệch`, `${w.est} SKUs with estimated sizes (≈) – linear may be off`) : ''}</li>)}</ul></>}

      <div className="foot"><span>Nexus POG by VBH · {today}</span><span>{L('Linear = khoảng ngang trên kệ (Spaceman HorizSpace khi có)', 'Linear = horizontal shelf space (Spaceman HorizSpace when known)')}</span></div>
    </article>
  </div>;
}
