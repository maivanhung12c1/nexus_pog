// Library panel: products (catalog), fixtures (gondola bays or pallet presets), POSM / props.
import { useMemo, useState } from 'react';
import { formLabel, L } from '../../../domain/i18n';
import { GONDOLA_PRESETS, PALLET_PRESETS } from '../../../domain/presets';
import { suspectDims } from '../../../domain/checks';
import { codeTail } from '../../../domain/catalog/sku';
import type { GondolaPreset } from '../../../domain/presets';
import type { SceneObject } from '../../../domain/types';
import { clamp, deep, R1, uid } from '../../../domain/util';
import { catalog, useCatalog } from '../../../app/catalogStore';
import { cmd } from '../../../app/commands';
import { editor, useEditor } from '../../../app/editorStore';
import { session, useSession } from '../../../app/session';
import { toast } from '../../../app/workspace';
import { pngHasAlpha, readAsDataURL, shrinkImage, loadImg } from '../../../infra/images';
import { Button, Field, FileButton, Icon, NumberInput, Select, SkuThumb } from '../../ds';
import type { LibSpec } from '../../../render/interaction';
import { runtime } from './runtime';
import { SkuDrawer } from '../catalog/SkuDrawer';

function startDrag(spec: LibSpec, e: React.PointerEvent) { if (e.button !== 0) return; e.preventDefault(); runtime.ix?.startLibDrag(spec, e.nativeEvent); }

export function Library() {
  const tab = useEditor((s) => s.libTab), shelf = session.scene!.isShelfMode;
  useSession((s) => s.version);
  return <section className="panel" aria-label={L('Thư viện', 'Library')}>
    <div className="panel-tabs" role="tablist">
      {([['products', L('Sản phẩm', 'Products')], ['fixtures', shelf ? 'Gondola' : 'Pallet'], ['posm', 'POSM']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => editor.set({ libTab: k })}>{l}</button>)}
    </div>
    {tab === 'products' ? <Products /> : tab === 'fixtures' ? (shelf ? <GondolaBuilder /> : <PalletPresets />) : <Posm />}
  </section>;
}

function Products() {
  const q = useEditor((s) => s.libQuery), form = useEditor((s) => s.libForm), brand = useEditor((s) => s.libBrand), limit = useEditor((s) => s.libLimit);
  const cat = useCatalog((s) => s.catalog), assets = useCatalog((s) => s.assets);
  const [edit, setEdit] = useState<string | null | 'new'>(null);
  const used = new Set(Object.keys(session.d!.skus));
  const brands = useMemo(() => [...new Set(cat.map((k) => k.brand).filter(Boolean))].sort(), [cat]);
  const list = useMemo(() => catalog.search(q, cat).filter((k) => (form === 'used' ? used.has(k.id) : form === 'all' || k.form === form) && (!brand || k.brand === brand)), [q, cat, form, brand, used.size]);
  void assets;
  return <div className="panel-body">
    <div className="input-wrap"><Icon.search className="lead-icon" /><input className="input" type="search" placeholder={L('Tìm tên, mã, brand…', 'Search name, code, brand…')} value={q} onChange={(e) => editor.set({ libQuery: e.target.value, libLimit: 120 })} aria-label={L('Tìm sản phẩm', 'Search products')} /></div>
    <div className="chips">{(['all', 'carton', 'pack', 'unit', 'used'] as const).map((f) => <button key={f} className={form === f ? 'on' : ''} onClick={() => editor.set({ libForm: f })}>{f === 'all' ? L('Tất cả', 'All') : f === 'used' ? L('Đang dùng', 'In use') : formLabel(f)}</button>)}</div>
    <select className="select" value={brand} onChange={(e) => editor.set({ libBrand: e.target.value })} aria-label="Brand"><option value="">Brand: {L('tất cả', 'all')}</option>{brands.map((b) => <option key={b}>{b}</option>)}</select>
    <p className="small muted">{L('Kéo vào vùng thiết kế · nhấp đúp để thêm nhanh', 'Drag into the design · double-click to add')} · {list.length.toLocaleString('vi-VN')}/{cat.length.toLocaleString('vi-VN')}</p>
    <div className="lib-list">
      {list.slice(0, limit).map((k) => <div key={k.id} className="lib-card" title={`${k.name}\n${k.code} · ${k.w}×${k.d}×${k.h} cm`} onPointerDown={(e) => { if ((e.target as HTMLElement).closest('.edit')) return; startDrag({ kind: 'sku', id: k.id }, e); }} onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('.edit')) return; runtime.ix?.quickAdd({ kind: 'sku', id: k.id }); }}>
        <SkuThumb k={k} />
        <div className="meta"><b>{k.name}</b><small>{formLabel(k.form)}{k.form !== 'unit' ? ' ' + (k.units || '?') : ''} · {k.est ? '≈' : ''}{R1(k.w)}×{R1(k.d)}×{R1(k.h)}{suspectDims(k) ? ' · ' + L('kích thước nghi sai', 'size looks wrong') : ''}</small><small className="mono">{codeTail(k.code)}</small></div>
        <Button className="edit" size="sm" variant="ghost" icon="edit" aria-label={L('Sửa SKU', 'Edit SKU')} onClick={() => setEdit(k.id)} />
      </div>)}
      {list.length > limit && <Button onClick={() => editor.set({ libLimit: limit + 300 })}>+ {list.length - limit}</Button>}
      {!list.length && <p className="muted small">{L('Không có SKU khớp. Thử bỏ bộ lọc hoặc tạo SKU mới.', 'No SKU matches. Clear the filters or create a new SKU.')}</p>}
    </div>
    <div className="btn-row"><Button size="sm" icon="plus" onClick={() => setEdit('new')}>{L('SKU mới', 'New SKU')}</Button></div>
    {edit && <SkuDrawer id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(k) => { if (session.d!.skus[k.id]) session.edit(L('Sửa SKU', 'Edit SKU'), (s) => { s.d.skus[k.id] = deep(k); }); }} />}
  </div>;
}

function GondolaBuilder() {
  const [p, setP] = useState<GondolaPreset & { bays: number }>({ ...GONDOLA_PRESETS.g100, bays: 1 });
  const f = (k: keyof GondolaPreset, lab: string, unit = 'cm', step = 0.5) => <Field label={lab}><NumberInput value={p[k] as number} unit={unit} step={step} onCommit={(v) => setP({ ...p, [k]: Math.max(k === 'n' ? 1 : 0.1, v) })} /></Field>;
  return <div className="panel-body">
    <p className="small muted">{L('Thêm bay vào bên phải dãy hiện có. Tấm kệ bám lỗ cài; kéo lên/xuống ở khung Trước.', 'Adds bays to the right of the run. Shelves follow the notch pitch; drag them up/down in the Front view.')}</p>
    <Field label={L('Mẫu', 'Preset')}><Select value={p.id} options={Object.values(GONDOLA_PRESETS).map((x) => [x.id, x.name] as [string, string])} onChange={(v) => setP({ ...GONDOLA_PRESETS[v], bays: p.bays })} /></Field>
    <div className="grid2">{f('w', L('Rộng bay', 'Bay width'))}{f('h', L('Cao', 'Height'))}</div>
    <div className="grid2">{f('d', L('Sâu kệ', 'Shelf depth'))}{f('baseD', L('Sâu đế', 'Base depth'))}</div>
    <div className="grid2">{f('kick', L('Cao chân đế', 'Kick'))}{f('pitch', L('Bước lỗ', 'Pitch'))}</div>
    <div className="grid2">{f('n', L('Số tầng (kể cả đế)', 'Shelves incl. base'), '', 1)}{f('t', L('Dày kệ', 'Thickness'), 'cm', 0.1)}</div>
    <Field label={L('Số bay', 'Bays')}><NumberInput value={p.bays} step={1} min={1} max={20} onCommit={(v) => setP({ ...p, bays: Math.round(v) })} /></Field>
    <Button variant="primary" icon="plus" onClick={() => { cmd.addGondola({ ...p }, clamp(p.bays | 0, 1, 20)); runtime.vp?.frameAll(new Set()); }}>{L('Thêm gondola', 'Add gondola')}</Button>
    <p className="small muted">{L('Kích thước mẫu là giả định — chưa có chuẩn theo chuỗi.', 'Preset sizes are assumptions — no retailer standard loaded.')}</p>
  </div>;
}

function PalletPresets() {
  return <div className="panel-body">
    <p className="small muted">{L('Kéo pallet vào thiết kế, hoặc nhấp đúp.', 'Drag a pallet into the design, or double-click.')}</p>
    <div className="lib-list">{Object.values(PALLET_PRESETS).map((p) => <div key={p.id} className="lib-card" onPointerDown={(e) => startDrag({ kind: 'pallet', preset: p.id }, e)} onDoubleClick={() => runtime.ix?.quickAdd({ kind: 'pallet', preset: p.id })}>
      <div className="thumb"><Icon.pallet width={20} height={20} /></div><div className="meta"><b>{p.name}</b><small>{p.w}×{p.d}×{p.h} cm · max {p.maxH} cm</small></div></div>)}</div>
  </div>;
}

function Posm() {
  useSession((s) => s.version);
  const d = session.d!;
  const protos = useMemo(() => { const seen = new Map<string, SceneObject>(); for (const o of d.objects) { if (o.type !== 'posm' && o.type !== 'prop') continue; const key = o.type + '|' + o.name + '|' + o.asset + '|' + o.size.w + '|' + o.size.h; if (!seen.has(key)) seen.set(key, o); } return [...seen.values()].map((o) => { const c = deep(o); c.lock = false; c.hidden = false; return c; }); }, [d.objects]);
  const add = async (file: File, type: 'posm' | 'prop') => {
    const src = await readAsDataURL(file), hasAlpha = /png/i.test(file.type) ? await pngHasAlpha(src) : false, small = await shrinkImage(src, 1400, hasAlpha), id = await catalog.putAsset(small);
    const im = await loadImg(small), ar = im.naturalWidth / Math.max(1, im.naturalHeight), s = session.scene!, sb = s.sceneBox(true) || { x0: 0, x1: 120, z0: 0, z1: 80, y1: 0 } as never, name = file.name.replace(/\.[^.]+$/, '');
    const w = R1(Math.min(120, sb.x1 - sb.x0));
    const o: SceneObject = type === 'posm' ? { id: uid(), type: 'posm', name, size: { w, d: 1, h: R1(w / ar) }, asset: id, cutout: hasAlpha, color: '#ffffff', pos: { x: (sb.x0 + sb.x1) / 2, y: 0, z: sb.z1 + 1 }, ry: 0 }
      : { id: uid(), type: 'prop', name, size: { w: 20, d: 20, h: R1(20 / ar) }, asset: id, color: '#f4a3c0', pos: { x: sb.x0 + 10, y: 0, z: sb.z1 + 12 }, ry: 0 };
    cmd.addObject(o);
    toast(L('Đã thêm ', 'Added ') + name);
  };
  return <div className="panel-body">
    <p className="small muted">{L('PNG nền trong suốt giữ đúng tỷ lệ; bảng POSM không là mặt đỡ và không tính vào hàng bán.', 'Transparent PNGs keep their aspect; POSM boards never carry products and never count as stock.')}</p>
    <div className="btn-row"><FileButton accept="image/*" icon="image" onFiles={(f) => add(f[0], 'posm')}>{L('Bảng POSM từ ảnh', 'POSM board from image')}</FileButton><FileButton accept="image/*" onFiles={(f) => add(f[0], 'prop')}>{L('Vật trang trí', 'Decorative prop')}</FileButton></div>
    <div className="lib-list">{protos.map((p, i) => { const src = catalog.asset((p as { asset?: string }).asset); const sz = (p as { size: { w: number; d: number; h: number } }).size; return <div key={i} className="lib-card" onPointerDown={(e) => startDrag({ kind: 'obj', proto: p }, e)} onDoubleClick={() => runtime.ix?.quickAdd({ kind: 'obj', proto: p })}>
      <div className="thumb">{src ? <img src={src} alt="" /> : <Icon.posm width={18} height={18} />}</div><div className="meta"><b>{p.name}</b><small>{p.type === 'posm' ? 'POSM' : L('Trang trí', 'Prop')} · {R1(sz.w)}×{R1(sz.d)}×{R1(sz.h)}</small></div></div>; })}
      {!protos.length && <p className="small muted">{L('POSM đã dùng trong thiết kế sẽ hiện ở đây để kéo thêm.', 'POSM used in this design appear here to reuse.')}</p>}</div>
  </div>;
}
