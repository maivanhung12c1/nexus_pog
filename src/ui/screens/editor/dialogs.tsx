// Editor dialogs: replace SKU, hollow shell, Spaceman preflight, compare current ↔ proposal, SKU sizes, sales import.
import { useMemo, useState } from 'react';
import { compareDesigns, type ChangeStatus } from '../../../domain/analysis/compare';
import { runChecks } from '../../../domain/checks';
import { fmt, formLabel, L } from '../../../domain/i18n';
import { replaceCore, stockUnits, type ReplaceFit } from '../../../domain/ops/edit';
import { curLevels, dominantSku, exposedSides, maxLevels, onPallet, shellFor, shellPallets, applyShell } from '../../../domain/pallet/shell';
import { isDeck, isStock, Scene } from '../../../domain/scene';
import { applySalesSimple, applySalesWide, salesWide, type SalesWide } from '../../../domain/shelf/sales';
import { shelfDirect, shelfUnder } from '../../../domain/shelf/gondola';
import { usedSkus } from '../../../domain/shelf/layout';
import { rowsToItems } from '../../../domain/catalog/catalog';
import type { Design, PalletObj, Sku, Warning } from '../../../domain/types';
import { deep, norm, poolKey, R1, R2, toNum } from '../../../domain/util';
import { catalog, useCatalog } from '../../../app/catalogStore';
import { cmd } from '../../../app/commands';
import { editor, useEditor } from '../../../app/editorStore';
import { exportPlnx, readProjectFile, readTable, download } from '../../../app/io';
import { prefs } from '../../../app/prefs';
import { session, useSession } from '../../../app/session';
import { toast, useWorkspace, workspace } from '../../../app/workspace';
import { toCSV } from '../../../infra/csv';
import { Button, Dialog, Field, FileButton, Pill, Select, SkuThumb } from '../../ds';
import { runtime } from './runtime';

export function EditorDialogs() {
  const dlg = useEditor((s) => s.dialog);
  const close = () => editor.set({ dialog: null });
  if (!dlg) return null;
  if (dlg.kind === 'replace') return <ReplaceDialog onClose={close} />;
  if (dlg.kind === 'shell') return <ShellDialog onClose={close} />;
  if (dlg.kind === 'plnx') return <PreflightDialog list={(dlg.data as Warning[]) || []} onClose={close} />;
  if (dlg.kind === 'compare') return <CompareDialog onClose={close} />;
  if (dlg.kind === 'dims') return <DimsDialog onClose={close} />;
  if (dlg.kind === 'sales') return <SalesDialog onClose={close} />;
  return null;
}

/** Evaluate a change on a throw-away copy (for previews), returning new collision count. */
function preview(fn: (s: Scene) => void) {
  const d = deep(session.d!), s = new Scene(d), n0 = runChecks(s).filter((w) => w.level === 'danger').length;
  fn(s); s.invalidate();
  return { s, collisions: Math.max(0, runChecks(s).filter((w) => w.level === 'danger').length - n0) };
}

function ReplaceDialog({ onClose }: { onClose: () => void }) {
  const s = session.scene!, sel = session.selected().filter(isStock);
  const [scope, setScope] = useState<'sel' | 'level' | 'all'>(sel.length ? 'sel' : 'all'), [from, setFrom] = useState('*'), [pick, setPick] = useState<string | null>(null), [fit, setFit] = useState<ReplaceFit>('center'), [swap, setSwap] = useState(false), [q, setQ] = useState('');
  const cat = useCatalog((x) => x.catalog);
  const scopeIds = () => { if (scope === 'all') return s.d.objects.filter((o) => isStock(o) && !o.lock).map((o) => o.id); if (scope === 'level') { const ys = new Set(sel.map((o) => Math.round(s.aabb(o).y0 * 2))); return s.d.objects.filter((o) => isStock(o) && !o.lock && ys.has(Math.round(s.aabb(o).y0 * 2))).map((o) => o.id); } return sel.map((o) => o.id); };
  const ids = scopeIds(), targets = from === '*' ? ids : ids.filter((id) => (s.get(id) as { sku?: string })?.sku === from);
  const by = new Map<string, number>(); for (const id of ids) { const o = s.get(id) as { sku: string }; by.set(o.sku, (by.get(o.sku) || 0) + 1); }
  const list = useMemo(() => catalog.search(q, cat).slice(0, 120), [q, cat]);
  const pv = useMemo(() => { if (!pick) return null; const k = catalog.byId(pick)!; const r = preview((ps) => { ps.d.skus[pick] = ps.d.skus[pick] || deep(k); replaceCore(ps, targets, pick, fit, swap && from !== '*' ? from : null, ids); }); return { k, u1: stockUnits(r.s, targets), collisions: r.collisions }; }, [pick, fit, swap, from, scope]);
  return <Dialog wide title={L('Thay SKU', 'Replace SKU')} onClose={onClose} footer={<><Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button><Button variant="primary" disabled={!pick || !targets.length} onClick={() => { cmd.replace(targets, pick!, fit, swap && from !== '*' ? from : null, ids); onClose(); }}>{L('Áp dụng', 'Apply')}</Button></>}>
    <div className="grid2">
      <Field label={L('Phạm vi', 'Scope')}><Select value={scope} options={[...(sel.length ? [['sel', L(`Vùng chọn (${sel.length})`, `Selection (${sel.length})`)], ['level', L('Cùng cao độ với vùng chọn', 'Same level as selection')]] as [typeof scope, string][] : []), ['all', L('Toàn thiết kế', 'Whole design')]]} onChange={setScope} /></Field>
      <Field label={L('Chỉ thay SKU', 'Only replace SKU')}><Select value={from} options={[['*', L(`Mọi SKU trong phạm vi (${ids.length})`, `Every SKU in scope (${ids.length})`)], ...[...by].map(([k, n]) => [k, `${s.d.skus[k]?.name || k} (${n})`] as [string, string])]} onChange={setFrom} /></Field>
    </div>
    <input className="input" type="search" placeholder={L('Tìm SKU thay thế…', 'Search the replacement SKU…')} value={q} onChange={(e) => setQ(e.target.value)} />
    <div className="table-wrap" style={{ maxHeight: 260 }}><table className="t"><tbody>{list.map((k) => <tr key={k.id} className={'clickable' + (pick === k.id ? ' selected' : '')} onClick={() => setPick(k.id)}><td><div className="cell-sku"><SkuThumb k={k} /><span className="name">{k.name}<span className="sub mono">{k.code} · {formLabel(k.form)} · {k.est ? '≈' : ''}{R1(k.w)}×{R1(k.d)}×{R1(k.h)}</span></span></div></td></tr>)}</tbody></table></div>
    <div className="grid2">
      <Field label={L('Cách xếp', 'Fit')}><Select<ReplaceFit> value={fit} options={[['center', L('Giữ số lượng – giữ tâm', 'Keep count – keep centre')], ['corner', L('Giữ số lượng – giữ góc trái-sau', 'Keep count – keep back-left corner')], ['front', L('Giữ số lượng – giữ góc trái-trước', 'Keep count – keep front-left corner')], ['fill', L('Giữ vùng chiếm chỗ – tính lại cột/hàng/tầng', 'Keep footprint – recount columns/rows/levels')]]} onChange={setFit} /></Field>
      <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={swap} disabled={from === '*'} onChange={(e) => setSwap(e.target.checked)} />{L('Đổi chỗ 2 SKU (A ↔ B) trong phạm vi', 'Swap the two SKUs (A ↔ B) within scope')}</label>
    </div>
    <div className="notice info">{pv ? <>{pv.k.name} — {targets.length} {L('vật', 'objects')}, {stockUnits(s, targets)} → <b>{pv.u1}</b> {L('đơn vị', 'units')} · <b style={pv.collisions ? { color: 'var(--negative)' } : undefined}>{L(`Sau khi thay: ${pv.collisions} chỗ giao nhau`, `After replacing: ${pv.collisions} overlaps`)}</b></> : <>{targets.length} {L('vật', 'objects')} · {stockUnits(s, targets)} {L('đơn vị hàng', 'stock units')}</>}</div>
  </Dialog>;
}

function ShellDialog({ onClose }: { onClose: () => void }) {
  const s = session.scene!, ps = shellPallets(s, session.selected(false)), all = s.d.objects.filter((o): o is PalletObj => o.type === 'pallet' && !isDeck(o));
  const skus = Object.values(s.d.skus).filter((k) => k.form === 'carton' || k.form === 'pack');
  const [opt, setOpt] = useState({ lid: true, sides: 'outer' as 'outer' | 'all', replace: true });
  const [plan, setPlan] = useState(() => ps.map((p, i) => { const sk = dominantSku(s, p) || skus[0]?.id || null, k = sk ? s.d.skus[sk] : null; return { pid: p.id, name: p.name || 'Pallet ' + (i + 1), sku: sk, side: { front: sk || '', back: '', left: '', right: '', lid: sk || '' } as Record<string, string>, levels: k ? curLevels(s, p, k) || maxLevels(s, p, k, true) : 4, before: onPallet(s, p).filter(isStock).reduce((a, o) => a + s.count(o), 0) }; }));
  const [levels, setLevels] = useState(() => Math.min(...plan.map((r) => r.levels), 40) || 4);
  const [core, setCore] = useState('');
  if (!ps.length) return <Dialog title={L('Xếp viền rỗng ruột', 'Hollow shell')} onClose={onClose}><p>{L('Chưa có pallet trong thiết kế.', 'There is no pallet in the design.')}</p></Dialog>;
  if (!skus.length) return <Dialog title={L('Xếp viền rỗng ruột', 'Hollow shell')} onClose={onClose}><p>{L('Thêm ít nhất một SKU thùng/lốc vào thiết kế trước.', 'Add at least one carton/pack SKU to the design first.')}</p></Dialog>;
  const resolved = (r: (typeof plan)[number]) => { const f = r.side.front || r.sku || ''; return { front: f, back: r.side.back || f, left: r.side.left || f, right: r.side.right || f, lid: r.side.lid || f }; };
  const items = plan.map((r) => ({ pid: r.pid, sku: r.side.front || r.sku, skuPerSide: resolved(r), levels }));
  const est = useMemo(() => {
    const d = deep(session.d!), ps2 = new Scene(d), get = (id: string): Sku | null => d.skus[id] || null, al = d.objects.filter((o): o is PalletObj => o.type === 'pallet' && !isDeck(o));
    const per = items.map((it) => { const p = ps2.get(it.pid) as PalletObj; return p ? shellFor(ps2, p, { ...opt, sku: it.sku, skuPerSide: it.skuPerSide, levels }, al, get).n : 0; });
    const n0 = runChecks(ps2).filter((w) => w.level === 'danger').length;
    applyShell(ps2, items, opt, get); ps2.invalidate();
    return { per, collisions: Math.max(0, runChecks(ps2).filter((w) => w.level === 'danger').length - n0) };
  }, [JSON.stringify(items), JSON.stringify(opt), levels]);
  const opts = (allowEmpty: boolean): [string, string][] => [...(allowEmpty ? [['', L('— giống mặt trước —', '— same as front —')] as [string, string]] : []), ...skus.map((k) => [k.id, `${k.name} · ${R1(k.w)}×${R1(k.d)}×${R1(k.h)}`] as [string, string])];
  const label: Record<string, string> = { front: L('Trước', 'Front'), back: L('Sau', 'Back'), left: L('Trái', 'Left'), right: L('Phải', 'Right'), lid: L('Nắp trên', 'Top lid') };
  return <Dialog wide title={L('Xếp viền rỗng ruột', 'Hollow shell')} onClose={onClose} footer={<><Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button><Button variant="primary" onClick={() => { cmd.shell(items, opt, core || null); onClose(); toast(L('Đã xếp viền – Ctrl+Z để hoàn tác', 'Shell built – Ctrl+Z to undo')); }}>{L('Áp dụng', 'Apply')}</Button></>}>
    <p className="muted">{L('Mỗi mặt ngoài được xếp 1 lớp thùng (mặt trước thùng hướng ra), ruột để trống; tầng trên cùng có thể xếp đầy trên tấm ván. Mặt Sau/Trái/Phải để trống = dùng SKU mặt Trước.', 'Each outer face gets one carton layer (front artwork outward), the core stays empty; the top can be a full layer on a deck board. Back/Left/Right blank = same as Front.')}</p>
    <div className="table-wrap"><table className="t"><thead><tr><th>{L('Pallet & SKU theo mặt', 'Pallet & per-face SKU')}</th><th className="num">{L('Thùng', 'Cases')}</th></tr></thead><tbody>{plan.map((r, i) => { const p = s.get(r.pid) as PalletObj, ex = opt.sides === 'all' ? { front: true, back: true, left: true, right: true } : exposedSides(s, p, all); return <tr key={r.pid}><td><b>{r.name}</b> <span className="muted small">· {Object.entries(ex).filter(([, v]) => v).map(([k]) => label[k]).join(', ') || '—'}</span>
      <div className="grid3" style={{ marginTop: 6 }}>{[...(['front', 'back', 'left', 'right'] as const).filter((f) => opt.sides === 'all' || ex[f]), ...(opt.lid ? ['lid' as const] : [])].map((f) => <Field key={f} label={label[f]}><Select value={r.side[f] || ''} options={opts(f !== 'front')} onChange={(v) => setPlan(plan.map((x, j) => (j === i ? { ...x, side: { ...x.side, [f]: v }, sku: f === 'front' ? v || x.sku : x.sku } : x)))} /></Field>)}</div></td>
      <td className="num">{r.before} → <b>{est.per[i]}</b></td></tr>; })}</tbody></table></div>
    <div className="grid3">
      <Field label={L('Số tầng', 'Levels')}><input className="input num" type="number" min={1} max={40} value={levels} onChange={(e) => setLevels(Math.max(1, Math.min(40, +e.target.value | 0)))} /></Field>
      <Field label={L('Mặt xếp viền', 'Walled sides')}><Select value={opt.sides} options={[['outer', L('Chỉ mặt ngoài của ụ', 'Outer faces of the island')], ['all', L('Cả 4 mặt mỗi pallet', 'All 4 sides')]]} onChange={(v) => setOpt({ ...opt, sides: v })} /></Field>
      <Field label={L('Điền ruột bằng SKU', 'Fill core with SKU')}><Select value={core} options={[['', L('— Không điền ruột —', '— No core fill —')], ...opts(false)]} onChange={setCore} /></Field>
    </div>
    <label className="check"><input type="checkbox" checked={opt.lid} onChange={(e) => setOpt({ ...opt, lid: e.target.checked })} />{L('Tầng nắp đầy (tấm ván đỡ 1,2 cm)', 'Full top layer (1.2 cm deck board)')}</label>
    <label className="check"><input type="checkbox" checked={opt.replace} onChange={(e) => setOpt({ ...opt, replace: e.target.checked })} />{L('Thay hàng đang có trên pallet', 'Replace what is on the pallet')}</label>
    <div className="notice info">{L('Tổng', 'Total')}: {plan.reduce((a, r) => a + r.before, 0)} → <b>{est.per.reduce((a, b) => a + b, 0)}</b> {L('thùng/lốc', 'cases')} · <b style={est.collisions ? { color: 'var(--negative)' } : undefined}>{L(`${est.collisions} chỗ giao nhau mới`, `${est.collisions} new overlaps`)}</b></div>
  </Dialog>;
}

function PreflightDialog({ list, onClose }: { list: Warning[]; onClose: () => void }) {
  return <Dialog wide title={L('Kiểm tra trước khi xuất Spaceman', 'Check before exporting to Spaceman')} onClose={onClose} footer={<><Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button><Button variant="primary" icon="download" onClick={async () => { onClose(); try { const st = await exportPlnx(session.d!); toast(L(`Đã xuất: ${st.positions} vị trí · ${st.facings} facing`, `Exported: ${st.positions} positions · ${st.facings} facings`)); } catch (e) { toast((e as Error).message, 'warn'); } }}>{L('Vẫn xuất .plnx', 'Export anyway')}</Button></>}>
    <p className="muted">{L('Những điểm dưới đây sẽ làm POG trên Spaceman khác với app. Sửa trước, hoặc vẫn xuất.', 'These would make the Spaceman POG differ from the app. Fix them first, or export anyway.')}</p>
    <div className="table-wrap"><table className="t"><tbody>{list.map((w, i) => <tr key={i}><td style={{ width: 70 }}><Pill tone={w.level === 'danger' ? 'negative' : w.level === 'warn' ? 'warning' : undefined}>{w.level === 'danger' ? L('Lỗi', 'Error') : w.level === 'warn' ? L('Lưu ý', 'Warning') : '≈'}</Pill></td><td>{w.msg}</td><td className="num">
      {w.level === 'info' && <Button size="sm" onClick={() => editor.set({ dialog: { kind: 'dims' } })}>{L('Sửa kích thước', 'Fix sizes')}</Button>}
      <Button size="sm" variant="ghost" onClick={() => { onClose(); session.select(w.ids.filter((id) => session.scene!.get(id))); runtime.vp?.frameAll(new Set(w.ids)); }}>{L('Xem', 'Show')}</Button></td></tr>)}</tbody></table></div>
  </Dialog>;
}

const ST: Record<ChangeStatus, [string, string, 'positive' | 'negative' | 'warning' | 'info' | undefined]> = { add: ['Thêm mới', 'Added', 'positive'], del: ['Bỏ', 'Removed', 'negative'], up: ['Tăng facing', 'More facings', 'info'], down: ['Giảm facing', 'Fewer facings', 'warning'], move: ['Đổi cm', 'Width changed', undefined], same: ['Giữ', 'Same', undefined] };
function CompareDialog({ onClose }: { onClose: () => void }) {
  const projects = useWorkspace((s) => s.projects), id = useSession((s) => s.id);
  const [other, setOther] = useState<{ d: Design; label: string } | null>(null), [openIs, setOpenIs] = useState<'prop' | 'cur'>('prop'), [only, setOnly] = useState<'chg' | 'focus' | 'all'>('chg');
  const focus = prefs().ownMaker;
  const res = useMemo(() => (other ? (openIs === 'prop' ? compareDesigns(other.d, session.d!, focus) : compareDesigns(session.d!, other.d, focus)) : null), [other, openIs]);
  const labC = openIs === 'prop' ? other?.label : L('Thiết kế đang mở', 'Open design'), labP = openIs === 'prop' ? L('Thiết kế đang mở', 'Open design') : other?.label;
  const isFocus = (k: Sku) => norm((k.maker || '') + ' ' + (k.brand || '')).includes(norm(focus));
  const rows = res ? res.rows.filter((r) => (only === 'all' || r.st !== 'same') && (only !== 'focus' || isFocus(r.k))) : [];
  const pick = async (f: File) => { try { const r = await readProjectFile(f); if (r.kind === 'v6library') throw Error('V6 library'); setOther({ d: r.design, label: f.name }); } catch (e) { toast((e as Error).message, 'warn'); } };
  const dd = (v: number) => (v > 0 ? '+' : '') + fmt(v, 1);
  return <Dialog wide title={L('So sánh hiện trạng ↔ đề xuất', 'Current ↔ proposal')} onClose={onClose} footer={res && <Button icon="download" onClick={() => download(`POG-changes.csv`, toCSV([[L('Trạng thái', 'Status'), L('Mã', 'Code'), L('Tên', 'Name'), 'Brand', L('NSX', 'Maker'), 'F ' + labC, 'cm ' + labC, 'F ' + labP, 'cm ' + labP, 'Δ F', 'Δ cm'], ...res.rows.map((r) => [L(ST[r.st][0], ST[r.st][1]), r.k.code, r.k.name, r.k.brand, r.k.maker, r.fc, R1(r.lc), r.fp, R1(r.lp), r.fp - r.fc, R1(r.lp - r.lc)])]), 'text/csv')}>{L('Xuất danh sách thay đổi', 'Export change list')}</Button>}>
    <div className="grid3">
      <Field label={L('So với dự án', 'Compare with project')}><Select value="" options={[['', L('— chọn —', '— choose —')], ...projects.filter((p) => p.id !== id).map((p) => [p.id, p.name] as [string, string])]} onChange={async (v) => { const d = await workspace.loadDesign(v); if (d) setOther({ d, label: projects.find((p) => p.id === v)!.name }); }} /></Field>
      <Field label={L('hoặc file', 'or a file')}><FileButton accept=".json" onFiles={(f) => pick(f[0])}>{L('Chọn .json', 'Choose .json')}</FileButton></Field>
      <Field label={L('Thiết kế đang mở là', 'The open design is')}><Select value={openIs} options={[['prop', L('Đề xuất', 'Proposal')], ['cur', L('Hiện trạng', 'Current')]]} onChange={setOpenIs} /></Field>
    </div>
    {res && <>
      <div className="kpis"><div className="kpi"><div className="label">{focus} share</div><div className="value" style={{ fontSize: 22 }}>{fmt(res.focusCur * 100, 1)}% → {fmt(res.focusProp * 100, 1)}%</div><div className="sub">{dd((res.focusProp - res.focusCur) * 100)} pp</div></div>
        <div className="kpi"><div className="label">cm {L('đã dùng', 'used')}</div><div className="value" style={{ fontSize: 22 }}>{fmt(res.cur.usedLinear, 0)} → {fmt(res.prop.usedLinear, 0)}</div></div>
        <div className="kpi"><div className="label">SKU</div><div className="value" style={{ fontSize: 22 }}>{res.cur.rows.length} → {res.prop.rows.length}</div><div className="sub">+{res.rows.filter((r) => r.st === 'add').length} / −{res.rows.filter((r) => r.st === 'del').length}</div></div>
        <div className="kpi"><div className="label">Facing</div><div className="value" style={{ fontSize: 22 }}>{res.cur.rows.reduce((a, r) => a + r.facings, 0)} → {res.prop.rows.reduce((a, r) => a + r.facings, 0)}</div></div></div>
      <Field label={L('Danh sách SKU', 'SKU list')}><Select value={only} options={[['chg', L('Chỉ mã thay đổi', 'Changed only')], ['focus', L('Chỉ mã của nhóm tập trung', 'Focus group only')], ['all', L('Tất cả', 'All')]]} onChange={setOnly} /></Field>
      <div className="table-wrap" style={{ maxHeight: 340 }}><table className="t"><thead><tr><th></th><th>SKU</th><th className="num">{labC}</th><th className="num">{labP}</th><th className="num">Δ F</th><th className="num">Δ cm</th></tr></thead><tbody>{rows.map((r) => <tr key={r.k.code}><td><Pill tone={ST[r.st][2]}>{L(ST[r.st][0], ST[r.st][1])}</Pill></td><td>{r.k.name}<span className="sub mono">{r.k.code} · {r.k.maker}</span></td><td className="num">{r.fc ? `${r.fc} F · ${fmt(r.lc)} cm` : <span className="dash">—</span>}</td><td className="num">{r.fp ? `${r.fp} F · ${fmt(r.lp)} cm` : <span className="dash">—</span>}</td><td className="num">{dd(r.fp - r.fc)}</td><td className="num">{dd(r.lp - r.lc)}</td></tr>)}</tbody></table></div>
    </>}
  </Dialog>;
}

function DimsDialog({ onClose }: { onClose: () => void }) {
  const s = session.scene!, [mode, setMode] = useState<'est' | 'all'>('est'), [q, setQ] = useState(''), [edits, setEdits] = useState(new Map<string, { w: number; h: number; d: number; units: number }>()), [paste, setPaste] = useState('');
  const all = usedSkus(s), list = all.filter((k) => (mode === 'all' || k.est) && (!q || norm(k.name + ' ' + k.code + ' ' + k.brand).includes(norm(q)))).sort((a, b) => (b.est ? 1 : 0) - (a.est ? 1 : 0) || a.name.localeCompare(b.name));
  const val = (k: Sku, f: 'w' | 'h' | 'd' | 'units') => { const e = edits.get(k.id); return e ? e[f] : +k[f]; };
  const setV = (k: Sku, f: 'w' | 'h' | 'd' | 'units', v: number) => { const m = new Map(edits); const e = m.get(k.id) || { w: +k.w, h: +k.h, d: +k.d, units: +k.units || 0 }; e[f] = Math.max(0.1, v || 0); m.set(k.id, e); setEdits(m); };
  const take = (items: { code: string; w: number; h: number; d: number; units: number }[]) => { const m = new Map(edits); let hit = 0, other = 0; for (const it of items) { const k = all.find((x) => poolKey(x.code) === poolKey(it.code)); if (k) { m.set(k.id, { w: it.w, h: it.h, d: it.d, units: it.units || +k.units || 0 }); hit++; } else { const c = catalog.byCode(it.code); if (c) { catalog.upsert({ ...c, w: it.w, h: it.h, d: it.d, units: it.units > 0 && c.form !== 'unit' ? it.units : c.units, est: undefined, dsrc: 'tay' }); other++; } } } setEdits(m); setMode('all'); toast(L(`Đã nhận ${hit} mã trong POG`, `${hit} SKUs of this POG matched`) + (other ? L(` · ${other} mã khác cập nhật vào danh mục`, ` · ${other} other codes updated in the catalog`) : '')); };
  const apply = () => {
    if (!edits.size) { onClose(); return; }
    const ch = new Map(edits);
    session.edit(L('Sửa kích thước SKU', 'Edit SKU sizes'), (sc) => {
      // re-lay every affected shelf in its order from the side it was packed against, refilling the depth
      const shelves = sc.d.objects.filter((o) => o.type === 'shelf');
      const plan = shelves.map((sh) => { const items = shelfDirect(sc, sh).filter(isStock), t = sc.aabb(sh); if (!items.length) return null; const b0 = sc.aabb(items[0]), b1 = sc.aabb(items[items.length - 1]); return { sh, items, side: b0.x0 - t.x0 <= t.x1 - b1.x1 + 0.5 ? 'L' : 'R', hit: items.some((o) => ch.has(o.sku)) }; }).filter((x): x is NonNullable<typeof x> => !!x);
      for (const [id, v] of ch) { const k = sc.d.skus[id]; if (!k) continue; k.w = v.w; k.h = v.h; k.d = v.d; if (v.units > 0 && k.form !== 'unit') k.units = v.units; delete k.est; k.dsrc = 'tay'; }
      sc.invalidate();
      for (const p of plan) { if (!p.hit) continue; const t = sc.aabb(p.sh); for (const o of p.items) { if (o.type !== 'array') continue; const kk = sc.skuOf(o)!, cd = o.cellRy % 180 ? kk.w : kk.d, gz = o.gap.z || 0; o.n.z = Math.max(1, Math.floor((t.z1 - t.z0 + gz + 0.01) / (cd + gz))); const S = sc.localSize(o); o.pos.z = R2(t.z1 - S.d / 2); }
        const ws = p.items.map((o) => { const b = sc.aabb(o); return b.x1 - b.x0; }); let x = p.side === 'R' ? t.x1 - ws.reduce((a, b) => a + b, 0) : t.x0; p.items.forEach((o, i) => { const b = sc.aabb(o); o.pos.x = R2(o.pos.x + x - b.x0); x += ws[i]; }); }
    });
    for (const [id, v] of ch) { const c = catalog.byId(id); if (c) catalog.upsert({ ...c, w: v.w, h: v.h, d: v.d, units: v.units > 0 && c.form !== 'unit' ? v.units : c.units, est: undefined, dsrc: 'tay' }); }
    onClose(); toast(L(`Đã cập nhật ${ch.size} SKU · kệ đã xếp lại`, `${ch.size} SKUs updated · shelves re-laid`));
  };
  const numIn = (k: Sku, f: 'w' | 'h' | 'd' | 'units') => <input className="input num" style={{ width: 70, height: 28 }} disabled={f === 'units' && k.form === 'unit'} value={f === 'units' && k.form === 'unit' ? 1 : R1(val(k, f)) || ''} onChange={(e) => setV(k, f, toNum(e.target.value))} />;
  return <Dialog wide title={L('Kích thước SKU', 'SKU sizes')} onClose={onClose} footer={<><Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button><Button variant="primary" onClick={apply}>{L('Áp dụng và xếp lại kệ', 'Apply and re-lay shelves')}</Button></>}>
    <p className="muted">{L('Mã ≈ đang dùng kích thước ước tính. Sửa Rộng × Cao × Sâu (cm, 1 đơn vị bán) – kệ tự xếp lại theo đúng thứ tự, kích thước được lưu vào danh mục.', '≈ codes use estimated sizes. Enter width × height × depth (cm, one selling unit) – shelves re-lay in order; sizes are kept in the catalog.')}</p>
    <div className="grid3"><Field label={L('Hiển thị', 'Show')}><Select value={mode} options={[['est', L('Chỉ mã ≈', 'Only ≈ codes')], ['all', L('Mọi SKU trong POG', 'Every SKU in the POG')]]} onChange={setMode} /></Field><Field label={L('Tìm', 'Search')}><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <Field label={L('Nhập từ file', 'Import file')}><FileButton accept=".csv,.xlsx,.txt" onFiles={async (f) => { try { const r = rowsToItems(await readTable(f[0])); if (r.err) throw Error(r.err); take(r.items.map((k) => ({ code: k.code, w: k.w, h: k.h, d: k.d, units: k.units }))); } catch (e) { toast((e as Error).message, 'warn'); } }}>{L('CSV / XLSX', 'CSV / XLSX')}</FileButton></Field></div>
    <details><summary className="small" style={{ cursor: 'pointer' }}>{L('Dán từ Excel (Mã · Rộng · Cao · Sâu · Đơn vị/thùng)', 'Paste from Excel (code · width · height · depth · units)')}</summary>
      <textarea className="input mono" rows={4} value={paste} placeholder="8935049510899	6.5	20.5	6.5	24" onChange={(e) => setPaste(e.target.value)} />
      <Button size="sm" onClick={() => take(paste.split(/\r?\n/).map((l) => l.split(/\t|;|,(?=\s*\d)/).map((x) => x.trim())).filter((r) => r.length >= 4 && /\d{6,}/.test(r[0])).map((r) => ({ code: r[0].replace(/\s+/g, ''), w: toNum(r[1]), h: toNum(r[2]), d: toNum(r[3]), units: toNum(r[4] || '') })).filter((r) => r.w > 0 && r.h > 0 && r.d > 0))}>{L('Nhận dữ liệu dán', 'Use pasted data')}</Button></details>
    <p className="small muted">{L('Mã ≈ trong POG', 'Estimated (≈) SKUs in this POG')}: <b>{all.filter((k) => k.est).length}</b> / {all.length} · {L('đang sửa', 'edited')}: <b>{edits.size}</b></p>
    <div className="table-wrap" style={{ maxHeight: 360 }}><table className="t"><thead><tr><th>SKU</th><th>{L('Rộng', 'W')}</th><th>{L('Cao', 'H')}</th><th>{L('Sâu', 'D')}</th><th>{L('ĐV', 'Units')}</th><th>{L('Nguồn', 'Source')}</th></tr></thead>
      <tbody>{list.map((k) => <tr key={k.id} className={edits.has(k.id) ? 'selected' : ''}><td><div className="cell-sku"><SkuThumb k={k} /><span className="name">{k.name}<span className="sub mono">{k.code}</span></span></div></td><td>{numIn(k, 'w')}</td><td>{numIn(k, 'h')}</td><td>{numIn(k, 'd')}</td><td>{numIn(k, 'units')}</td><td>{k.est ? <Pill tone="warning">≈</Pill> : k.dsrc === 'PDF' ? <Pill>PDF</Pill> : k.dsrc === 'tay' ? <Pill>{L('tay', 'manual')}</Pill> : <Pill tone="positive">{L('thật', 'measured')}</Pill>}</td></tr>)}
        {!list.length && <tr><td colSpan={6} className="muted">{L('Không còn mã ≈ – mọi SKU trong POG đã có kích thước thật.', 'No estimated SKUs left.')}</td></tr>}</tbody></table></div>
  </Dialog>;
}

function SalesDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<unknown[][] | null>(null), [fname, setF] = useState(''), [W, setW] = useState<SalesWide | null>(null), [store, setStore] = useState('*avg'), [months, setMonths] = useState<number[]>([]), [unit, setUnit] = useState<'unit' | 'sku'>('unit'), [per, setPer] = useState<'week' | 'month' | 'day'>('week'), [err, setErr] = useState('');
  const unitsOfCode = (code: string) => { const k = Object.values(session.d!.skus).find((x) => poolKey(x.code) === code) || catalog.byCode(code); return k ? (k.form === 'unit' ? 1 : +k.units || 1) : 1; };
  const load = async (f: File) => { try { const r = await readTable(f); setRows(r); setF(f.name); const w = salesWide(r); setW(w); setMonths(w ? w.months.map((_, i) => i) : []); setErr(''); } catch (e) { setErr((e as Error).message); } };
  const apply = () => {
    try {
      if (W) { const ms = months.map((i) => W.months[i]); const res = applySalesWide(W, store, ms, unitsOfCode); session.edit(L('Nhập số bán', 'Import sales'), (s) => { s.d.settings.sales = res; s.d.settings.salesSrc = `${fname} · ${store === '*avg' ? L('TB/store', 'avg/store') : store === '*sum' ? L('tổng store', 'all stores') : store} · ${ms.map((m) => m.label).join(', ')}`; }); toast(L(`Đã nhập ${Object.keys(res).length} mã (lon/chai mỗi tuần)`, `Imported ${Object.keys(res).length} codes (units per week)`)); }
      else { const r = applySalesSimple(rows!, unit, per, unitsOfCode); session.edit(L('Nhập số bán', 'Import sales'), (s) => { s.d.settings.sales = Object.assign({}, s.d.settings.sales || {}, r.sales); s.d.settings.salesSrc = fname; }); toast(L(`Đã nhập ${r.rows} dòng`, `Imported ${r.rows} rows`)); }
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };
  return <Dialog title={L('Nhập số bán theo SKU', 'Import sales by SKU')} onClose={onClose} footer={rows && <Button variant="primary" onClick={apply}>{L('Áp dụng', 'Apply')}</Button>}>
    <p className="muted">{L('Hai dạng: (1) file AEON "Data sharing" (store × barcode × tháng, cột Sold Quantity); (2) file có cột mã + số bán. Số bán lưu theo dự án (mỗi store khác nhau), đổi ra lon/chai mỗi tuần.', 'Two layouts: (1) AEON "Data sharing" (store × barcode × month, Sold Quantity columns); (2) a code + sales file. Sales are stored per project (stores differ), as single units per week.')}</p>
    <FileButton accept=".csv,.txt,.xlsx" icon="upload" onFiles={(f) => load(f[0])}>{L('Chọn file', 'Choose file')}</FileButton>
    {err && <div className="notice" role="alert">{err}</div>}
    {rows && W && <>
      <p><b>{fname}</b> · {W.data.length} {L('dòng', 'rows')} · {W.stores.length} store</p>
      <Field label="Store"><Select value={store} options={[['*avg', L('Trung bình 1 store (tất cả)', 'Average per store (all)')], ['*sum', L('Cộng tất cả store', 'Sum of all stores')], ...W.stores.map((x) => [x, x] as [string, string])]} onChange={setStore} /></Field>
      <div className="chips">{W.months.map((m, i) => <label key={i} className="check"><input type="checkbox" checked={months.includes(i)} onChange={(e) => setMonths(e.target.checked ? [...months, i] : months.filter((x) => x !== i))} />{m.label}</label>)}</div>
    </>}
    {rows && !W && <div className="grid2"><Field label={L('Đơn vị số bán', 'Sales unit')}><Select value={unit} options={[['unit', L('Lon/chai lẻ', 'Single units')], ['sku', L('Theo quy cách SKU (thùng/lốc)', 'Per SKU pack')]]} onChange={setUnit} /></Field><Field label={L('Kỳ', 'Period')}><Select value={per} options={[['week', L('Tuần', 'Week')], ['month', L('Tháng', 'Month')], ['day', L('Ngày', 'Day')]]} onChange={setPer} /></Field></div>}
  </Dialog>;
}

export const _unusedShelfUnder = shelfUnder;
