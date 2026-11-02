// POG editor (builder pattern): project bar, library | canvas well | inspector, status strip.
import { useEffect, useRef, useState } from 'react';
import { computeBOM } from '../../../domain/bom';
import { fmt, L } from '../../../domain/i18n';
import { shelfMetrics } from '../../../domain/shelf/metrics';
import { arrayFromItem } from '../../../domain/ops/edit';
import type { SkuObj } from '../../../domain/types';
import { slug } from '../../../domain/util';
import { catalog, useCatalog } from '../../../app/catalogStore';
import { editor, useEditor } from '../../../app/editorStore';
import { bomCsv, download, exportPlnx, preflight, saveProjectFile, copyImageToClipboard } from '../../../app/io';
import { setPref, usePrefs, useResolvedTheme } from '../../../app/prefs';
import { session, useSession } from '../../../app/session';
import { toast, workspace } from '../../../app/workspace';
import { Interaction } from '../../../render/interaction';
import { pogSheetPNG } from '../../../render/pogSheet';
import { Viewport, type ViewMode } from '../../../render/viewport';
import { Button, Menu, Segmented } from '../../ds';
import { go } from '../../router';
import { Library } from './Library';
import { Inspector } from './Inspector';
import { EditorDialogs } from './dialogs';
import { runtime } from './runtime';

export function Editor({ id }: { id: string }) {
  const [err, setErr] = useState('');
  const scene = useSession((s) => s.scene), sid = useSession((s) => s.id);
  useEffect(() => { let alive = true; const me = Symbol('editor'); session.open(id, me).catch((e) => alive && setErr(e.message)); return () => { alive = false; session.close(me); }; }, [id]);
  if (err) return <div className="page"><h1>{L('Không mở được dự án', 'Could not open the project')}</h1><p className="muted" style={{ margin: '8px 0 16px' }}>{err}</p><Button onClick={() => go('/')}>{L('Về danh sách', 'Back to planograms')}</Button></div>;
  if (!scene || sid !== id) return <div className="page"><div className="loading-bar" style={{ width: 240 }} /></div>;
  return <EditorBody />;
}

function EditorBody() {
  usePrefs((s) => s.lang);
  const wellRef = useRef<HTMLDivElement>(null), glRef = useRef<HTMLCanvasElement>(null), ovRef = useRef<HTMLCanvasElement>(null);
  const version = useSession((s) => s.version), sel = useSession((s) => s.sel), view = useEditor((s) => s.view), builder = useEditor((s) => s.builder), assetsVer = useCatalog((s) => s.assets);

  useEffect(() => {
    if (!session.scene) return;
    const vp = new Viewport(wellRef.current!, glRef.current!, ovRef.current!, (aid) => catalog.asset(aid));
    const ix = new Interaction(vp, wellRef.current!);
    runtime.vp = vp; runtime.ix = ix;
    vp.setTheme(useResolvedTheme.getState().dark);
    const s = session.scene!;
    const mode: ViewMode = s.isShelfMode ? 'fsplit' : 'split';
    editor.set({ view: mode, builder: null, measure: false });
    vp.setMode(mode);
    vp.rebuild(s, useSession.getState().sel);
    vp.frameAll(new Set());
    const onSave = () => { session.saveNow(); saveProjectFile(session.d!); toast(L('Đã lưu và tải file project', 'Saved and downloaded the project file')); };
    const onPlnx = () => editor.set({ dialog: { kind: 'plnx' } });
    window.addEventListener('nexus:save', onSave); window.addEventListener('nexus:export-plnx', onPlnx);
    return () => { window.removeEventListener('nexus:save', onSave); window.removeEventListener('nexus:export-plnx', onPlnx); ix.dispose(); vp.dispose(); runtime.vp = null; runtime.ix = null; };
  }, []);
  useEffect(() => { const s = session.scene; if (runtime.vp && s) runtime.vp.rebuild(s, useSession.getState().sel); }, [version, assetsVer]);
  const dark = useResolvedTheme((t) => t.dark);
  useEffect(() => { runtime.vp?.setTheme(dark); }, [dark]);
  useEffect(() => { runtime.vp?.updateSelection(sel); if (editor.get().builder && !(sel.size === 1 && sel.has(editor.get().builder!.srcId))) { editor.set({ builder: null }); runtime.vp?.clearGhost(); } }, [sel]);
  useEffect(() => { if (runtime.vp && runtime.vp.mode !== view) { runtime.vp.setMode(view); runtime.vp.frameAll(useSession.getState().sel); } }, [view]);
  useEffect(() => {
    const vp = runtime.vp, s = session.scene;
    if (!vp || !s) return;
    if (!builder) { vp.clearGhost(); return; }
    const it = s.get(builder.srcId);
    if (!it || it.type !== 'sku') { editor.set({ builder: null }); return; }
    const a = arrayFromItem(s, it as SkuObj, builder);
    vp.setGhost([{ k: s.skuOf(a), matrices: vp.cellMatrices(s, a) }], false);
  }, [builder, version]);

  return <div className="editor">
    <ProjectBar />
    <div className="ed-body">
      <Library />
      <div className="canvas-well" ref={wellRef} aria-label={L('Vùng thiết kế', 'Design canvas')}>
        <canvas ref={glRef} />
        <canvas ref={ovRef} className="ov" />
        <div className="canvas-tools">
          <Segmented<ViewMode> label={L('Chế độ xem', 'View')} value={view} onChange={(v) => editor.set({ view: v })} options={[['top', 'Top'], ['3d', '3D'], ['split', 'Top + 3D'], ['fsplit', L('Trước + 3D', 'Front + 3D')], ['front', L('Trước', 'Front')], ['side', L('Bên', 'Side')]]} />
          <Button icon="frame" aria-label={L('Vừa khung (F)', 'Frame (F)')} title={L('Vừa khung (F)', 'Frame (F)')} onClick={() => runtime.vp?.frameAll(useSession.getState().sel)} />
          <MeasureButton />
        </div>
        <Hint view={view} />
      </div>
      <Inspector />
    </div>
    <StatusBar />
    <EditorDialogs />
    <div id="drag-float" />
  </div>;
}

function MeasureButton() {
  const on = useEditor((s) => s.measure);
  return <Button icon="ruler" className={on ? 'on' : ''} aria-pressed={on} aria-label={L('Đo (M)', 'Measure (M)')} title={L('Đo (M)', 'Measure (M)')} onClick={() => { const v = !on; editor.set({ measure: v }); if (runtime.vp) { runtime.vp.ov.measure = v ? { a: null, b: null } : null; runtime.vp.request(); } }} />;
}

function Hint({ view }: { view: ViewMode }) {
  const t = view === 'side' ? L('Khung Bên chỉ để xem — chỉnh ở Top / Trước / 3D', 'Side is view only — edit in Top / Front / 3D')
    : view === 'front' || view === 'fsplit' ? L('Trước: kéo vật ngang/lên xuống (thả xuống mặt đỡ gần nhất bên dưới) · kéo tấm kệ theo lỗ cài · gõ 1–9: facing · Shift+↑↓: tầng · Alt: tắt snap', 'Front: drag across/up/down (drops onto the nearest surface below) · drag shelves along the notches · type 1–9: facings · Shift+↑↓: stack · Alt: snap off')
      : L('Kéo vật: di chuyển · Kéo nền: quét chọn (3D: xoay) · Chuột phải: pan · Lăn: zoom · R: xoay · Ctrl+kéo: nhân bản', 'Drag object: move · Drag empty: box select (3D: orbit) · Right drag: pan · Wheel: zoom · R: rotate · Ctrl+drag: copy');
  return <div className="canvas-hint">{t}</div>;
}

function ProjectBar() {
  const d = session.d!, undo = useSession((s) => s.undo), redo = useSession((s) => s.redo), save = useSession((s) => s.save), id = useSession((s) => s.id)!;
  useSession((s) => s.version);
  const shelf = d.settings.kind === 'shelf';
  const png = (key: 'persp' | 'top' | 'front') => { const url = runtime.vp!.snapshot(key); download(`${slug(d.meta.name)}-${key === 'persp' ? '3d' : key}.png`, dataURLtoBlob(url), 'image/png'); };
  const plnx = () => { const pf = preflight(d); if (pf.some((w) => w.level !== 'info')) editor.set({ dialog: { kind: 'plnx', data: pf } }); else exportPlnx(d).then((st) => toast(L(`Đã xuất: ${st.bays} bay · ${st.positions} vị trí · ${st.facings} facing · ${st.skus} SKU`, `Exported: ${st.bays} bays · ${st.positions} positions · ${st.facings} facings · ${st.skus} SKUs`))).catch((e) => toast(e.message, 'warn')); };
  return <header className="ed-bar">
    <Button variant="ghost" icon="back" aria-label={L('Về danh sách', 'Back to planograms')} onClick={() => go('/')} />
    <input className="name" aria-label={L('Tên planogram', 'Planogram name')} defaultValue={d.meta.name} key={d.meta.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.meta.name) session.edit(L('Đổi tên', 'Rename'), (s) => { s.d.meta.name = v; }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    <span className="save-state">{save.state === 'saving' ? L('Đang lưu…', 'Saving…') : save.state === 'error' ? L('Lưu lỗi – dữ liệu chỉ còn trong phiên này', 'Save failed – changes only in this session') : save.state === 'saved' ? L('Đã lưu trên máy', 'Saved on this computer') : ''}</span>
    <div className="divider-v" />
    <Button variant="ghost" icon="undo" disabled={!undo.length} aria-label={L('Hoàn tác', 'Undo')} title={L('Hoàn tác', 'Undo') + (undo.length ? ': ' + undo[undo.length - 1].label : '') + ' (Ctrl+Z)'} onClick={() => session.undo()} />
    <Button variant="ghost" icon="redo" disabled={!redo.length} aria-label={L('Làm lại', 'Redo')} title={L('Làm lại', 'Redo') + (redo.length ? ': ' + redo[redo.length - 1].label : '') + ' (Ctrl+Y)'} onClick={() => session.redo()} />
    <div style={{ flex: 1 }} />
    <ThemeToggle />
    {shelf && <Button icon="auto" onClick={() => go('/auto/' + id)}>Auto POG</Button>}
    <Button icon="share" onClick={async () => { await workspace.addPog(d, L('dự án đang mở', 'open project')); toast(L('Đã thêm bản hiện tại vào Space Share', 'Current version added to Space Share')); }}>{L('Vào Space Share', 'To Space Share')}</Button>
    <Menu label={L('Xuất', 'Export')} icon="download" items={[
      { header: L('Hình ảnh', 'Images') },
      { label: L('Ảnh 3D (PNG)', '3D image (PNG)'), icon: 'image', onClick: () => png('persp') },
      { label: L('Ảnh mặt trước (PNG)', 'Front image (PNG)'), icon: 'image', onClick: () => png('front') },
      { label: L('Ảnh Top (PNG)', 'Top image (PNG)'), icon: 'image', onClick: () => png('top') },
      ...(shelf ? [{ label: L('Ảnh POG có nhãn (PNG)', 'Labelled POG sheet (PNG)'), icon: 'sheet' as const, onClick: async () => { const u = await pogSheetPNG(runtime.vp!, session.scene!); if (u) download(`${slug(d.meta.name)}-POG.png`, dataURLtoBlob(u), 'image/png'); } }] : []),
      { label: L('Chép ảnh 3D (dán vào Zalo)', 'Copy 3D image (paste into Zalo)'), icon: 'clipboard', onClick: async () => { try { await copyImageToClipboard(runtime.vp!.snapshot('persp')); toast(L('Đã chép ảnh – dán (Ctrl+V) vào Zalo', 'Image copied – paste (Ctrl+V) into Zalo')); } catch (e) { toast((e as Error).message, 'warn'); } } },
      'sep', { header: L('Dữ liệu', 'Data') },
      { label: L('BOM (CSV/Excel)', 'BOM (CSV/Excel)'), icon: 'catalog', onClick: () => bomCsv(d) },
      ...(shelf ? [{ label: 'Spaceman (.plnx)', icon: 'gondola' as const, onClick: plnx }] : []),
      { label: L('Project (.json, kèm ảnh)', 'Project (.json with images)'), icon: 'planograms', onClick: () => saveProjectFile(d) },
    ]} />
    <Button variant="primary" icon="sheet" onClick={() => { session.saveNow(); go('/sheets/' + id); }}>{L('Phiếu dựng', 'Build sheet')}</Button>
  </header>;
}

export function dataURLtoBlob(u: string) { const [h, b] = u.split(','), m = /data:([^;]+)/.exec(h)![1], bin = atob(b), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return new Blob([a], { type: m }); }

function StatusBar() {
  const p = usePrefs(), warnings = useSession((s) => s.warnings), open = useEditor((s) => s.warningsOpen);
  useSession((s) => s.version);
  const s = session.scene!, sb = s.sceneBox(true), shelf = s.isShelfMode;
  const nD = warnings.filter((w) => w.level === 'danger').length, nW = warnings.filter((w) => w.level === 'warn').length;
  let counts: React.ReactNode;
  if (shelf) { const m = shelfMetrics(s), own = m.makers.find((e) => e.key.toUpperCase().includes(p.ownMaker.toUpperCase())); counts = <>{L('Kệ', 'Shelf')} <b>{fmt(m.usedLinear)}</b>/{fmt(m.totalLinear)} cm ({fmt(m.totalLinear ? (m.usedLinear / m.totalLinear) * 100 : 0)}%) · SKU <b>{m.rows.length}</b> · Facing <b>{m.rows.reduce((a, r) => a + r.facings, 0)}</b>{own && <> · {p.ownMaker} <b>{fmt(own.share * 100)}%</b></>}</>; }
  else { const b = computeBOM(s); counts = <>{L('Thùng', 'Cartons')} <b>{b.tot.carton}</b> · {L('Lốc', 'Packs')} <b>{b.tot.pack}</b> · {L('Lẻ', 'Units')} <b>{b.tot.unit}</b> · {L('Quy đổi', 'Converted')} <b>{fmt(b.tot.conv, 0)}</b>{b.tot.unknown ? '*' : ''}</>; }
  return <footer className="status">
    <span>{sb ? <><b>{fmt(sb.x1 - sb.x0)} × {fmt(sb.z1 - sb.z0)}</b> cm · {L('Cao', 'Height')} <b style={sb.y1 > s.d.settings.maxH ? { color: 'var(--negative)' } : undefined}>{fmt(sb.y1)}</b>/{s.d.settings.maxH} cm</> : '—'}</span>
    <span>{counts}</span>
    <span className="grow" />
    <label><input type="checkbox" checked={p.snapOn} onChange={(e) => setPref('snapOn', e.target.checked)} /> Snap</label>
    <label>{L('Lưới', 'Grid')} <select value={p.grid} onChange={(e) => setPref('grid', +e.target.value)}>{[0, 0.5, 1, 5, 10].map((g) => <option key={g} value={g}>{g ? g + ' cm' : '—'}</option>)}</select></label>
    <label><input type="checkbox" checked={p.snapEdge} onChange={(e) => setPref('snapEdge', e.target.checked)} /> {L('Cạnh/tâm', 'Edges')}</label>
    <label><input type="checkbox" checked={p.autoRest} onChange={(e) => setPref('autoRest', e.target.checked)} /> {L('Tự đặt lên mặt đỡ', 'Rest on support')}</label>
    <label title={L('Chặn thao tác tạo va chạm mới', 'Block edits that create a new collision')}><input type="checkbox" checked={p.strict} onChange={(e) => setPref('strict', e.target.checked)} /> {L('Chặn va chạm', 'Block collisions')}</label>
    <label title={L('Pallet / tấm kệ / bay kéo theo hàng phía trên', 'Pallets / shelves / bays carry what is on them')}><input type="checkbox" checked={p.carry} onChange={(e) => setPref('carry', e.target.checked)} /> {L('Kéo kèm hàng', 'Carry')}</label>
    {shelf && <label><input type="checkbox" checked={p.fillDepth} onChange={(e) => setPref('fillDepth', e.target.checked)} /> {L('Thả lên kệ: lấp sâu', 'Drop: fill depth')}</label>}
    <button className={'warn-btn ' + (nD ? 'danger' : nW ? 'warn' : '')} onClick={() => editor.set({ warningsOpen: !open })} aria-expanded={open}>{warnings.length ? `${nD + nW} ${L('cảnh báo', 'warnings')}${warnings.length - nD - nW ? ` · ${warnings.length - nD - nW} ${L('ghi chú', 'notes')}` : ''}` : L('Không có cảnh báo', 'No warnings')}</button>
    {open && <div className="warn-pop" role="dialog" aria-label={L('Cảnh báo', 'Warnings')}>
      <h3 style={{ marginBottom: 6 }}>{L('Cảnh báo', 'Warnings')} <span className="muted small">· {L('chỉ báo, không tự sửa', 'listed only, never auto-fixed')}</span></h3>
      {!warnings.length && <p className="muted">{L('Không có cảnh báo', 'No warnings')}</p>}
      {warnings.map((w, i) => <div key={i} className="warn-row" onClick={() => { const ids = w.ids.filter((x) => s.get(x)); if (ids.length) { session.select(ids); runtime.vp?.frameAll(new Set(ids)); } }}><span style={{ color: w.level === 'danger' ? 'var(--negative)' : w.level === 'warn' ? 'var(--warning)' : 'var(--muted)' }}>{w.level === 'danger' ? '●' : w.level === 'warn' ? '▲' : 'i'}</span><span>{w.msg}</span></div>)}
    </div>}
  </footer>;
}

function ThemeToggle() {
  const dark = useResolvedTheme((t) => t.dark);
  return <Button variant="ghost" icon={dark ? 'sun' : 'moon'} aria-label={dark ? L('Giao diện sáng', 'Light theme') : L('Giao diện tối', 'Dark theme')} title={dark ? L('Giao diện sáng', 'Light theme') : L('Giao diện tối', 'Dark theme')} onClick={() => setPref('theme', dark ? 'light' : 'dark')} />;
}
