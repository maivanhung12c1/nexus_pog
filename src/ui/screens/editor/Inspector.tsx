// Inspector: properties of the selection (progressive: basic first, advanced in sections), layers, quantities.
import { useState } from 'react';
import { computeBOM } from '../../../domain/bom';
import { arrayCount } from '../../../domain/geometry';
import { fmt, formLabel, L } from '../../../domain/i18n';
import { shelfMetrics } from '../../../domain/shelf/metrics';
import { shelfDirect, shelfUnder } from '../../../domain/shelf/gondola';
import { defaultBuild } from '../../../domain/ops/edit';
import { PALLET_PRESETS } from '../../../domain/presets';
import { isStock, type Scene } from '../../../domain/scene';
import { usedSkus } from '../../../domain/shelf/layout';
import type { ArrayObj, ArrayShape, FixtureObj, PalletObj, PosmObj, PropObj, SceneObject, ShelfObj, Sku } from '../../../domain/types';
import { R1 } from '../../../domain/util';
import { catalog } from '../../../app/catalogStore';
import { cmd } from '../../../app/commands';
import { editor, useEditor, type InspectorTab } from '../../../app/editorStore';
import { bomCsv } from '../../../app/io';
import { setPref, usePrefs } from '../../../app/prefs';
import { session, useSession } from '../../../app/session';
import { Button, Field, Icon, NumberInput, Pill, Select, SkuThumb, TextInput } from '../../ds';
import { readAsDataURL, shrinkImage, pngHasAlpha, loadImg } from '../../../infra/images';
import { go } from '../../router';
import { runtime } from './runtime';

export function Inspector() {
  const tab = useEditor((s) => s.inspector);
  useSession((s) => s.version); useSession((s) => s.sel); usePrefs((s) => s.lang);
  return <section className="panel" aria-label={L('Thuộc tính', 'Inspector')}>
    <div className="panel-tabs" role="tablist">{([['properties', L('Thuộc tính', 'Properties')], ['layers', L('Đối tượng', 'Layers')], ['quantities', L('Số lượng', 'Quantities')]] as [InspectorTab, string][]).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => editor.set({ inspector: k })}>{l}</button>)}</div>
    <div className="panel-body">{tab === 'properties' ? <Properties /> : tab === 'layers' ? <Layers /> : <Quantities />}</div>
  </section>;
}

function Properties() {
  const s = session.scene!, os = session.selected(false), builder = useEditor((st) => st.builder);
  if (builder) return <BuilderForm />;
  if (!os.length) return s.isShelfMode ? <ShelfSummary s={s} /> : <PalletSummary s={s} />;
  if (os.length > 1) return <Multi os={os} s={s} />;
  const o = os[0];
  if (o.type === 'sku' || o.type === 'array') return <StockProps o={o} s={s} />;
  if (o.type === 'shelf') return <ShelfProps o={o} s={s} />;
  if (o.type === 'fixture') return <FixtureProps o={o} s={s} />;
  if (o.type === 'pallet') return <PalletProps o={o} s={s} />;
  if (o.type === 'posm' || o.type === 'prop') return <ImageObjProps o={o} />;
  return <><h3>{o.name || o.type}</h3><Position o={o} s={s} /><Flags os={[o]} /></>;
}

// ---------- building blocks ----------
function Position({ o, s }: { o: SceneObject; s: Scene }) {
  const b = s.aabb(o);
  return <div className="panel-section"><h3>{L('Vị trí (góc trái-sau)', 'Position (back-left)')}</h3>
    <div className="grid3"><Field label="X"><NumberInput value={b.x0} unit="cm" onCommit={(v) => cmd.setPosition('x', v)} /></Field><Field label="Z"><NumberInput value={b.z0} unit="cm" onCommit={(v) => cmd.setPosition('z', v)} /></Field><Field label={L('Đáy Y', 'Bottom Y')}><NumberInput value={b.y0} unit="cm" onCommit={(v) => cmd.setPosition('y', v)} /></Field></div></div>;
}
function Rotation({ o }: { o: SceneObject }) {
  const step = usePrefs((p) => p.rotStep), a = Math.round(o.ry || 0);
  return <div className="panel-section"><h3>{L('Hướng', 'Orientation')} · {a}°</h3>
    <div className="btn-row"><Button size="sm" icon="rotate" style={{ transform: 'scaleX(-1)' }} aria-label={`−${step}°`} title={`Shift+R (−${step}°)`} onClick={() => cmd.rotate(-1)} /><Button size="sm" icon="rotate" aria-label={`+${step}°`} title={`R (+${step}°)`} onClick={() => cmd.rotate(1)} />
      <select className="select" style={{ width: 80, height: 28 }} value={step} onChange={(e) => setPref('rotStep', +e.target.value)} aria-label={L('Bước xoay', 'Rotation step')}>{[90, 45, 30, 15, 5, 1].map((x) => <option key={x} value={x}>{x}°</option>)}</select>
      <div style={{ width: 90 }}><NumberInput value={a} unit="°" step={1} onCommit={(v) => cmd.setAngle(v)} aria-label={L('Góc', 'Angle')} /></div></div>
    {a % 90 !== 0 && <p className="small muted">{L('Góc lẻ: kiểm tra giao nhau và mặt đỡ chỉ ước lượng theo hộp bao.', 'Free angle: overlap and support checks are approximate.')}</p>}</div>;
}
function Dup() {
  return <div className="panel-section"><h3>{L('Nhân bản', 'Duplicate')}</h3><div className="btn-row">
    {([['L', L('← Trái', '← Left'), 'Alt+←'], ['R', L('Phải →', 'Right →'), 'Ctrl+D'], ['B', L('↑ Sau', '↑ Back'), 'Alt+↑'], ['F', L('↓ Trước', '↓ Front'), 'Alt+↓'], ['U', L('Lên trên', 'On top'), 'Alt+PgUp']] as const).map(([d, l, k]) => <Button key={d} size="sm" title={k} onClick={() => cmd.duplicate(d)}>{l}</Button>)}</div></div>;
}
function Flags({ os }: { os: SceneObject[] }) {
  const lk = os.every((o) => o.lock), hd = os.every((o) => o.hidden);
  return <div className="btn-row" style={{ paddingTop: 8, borderTop: '1px solid var(--rule)' }}>
    <Button size="sm" icon={lk ? 'unlock' : 'lock'} onClick={() => cmd.toggleFlag('lock')}>{lk ? L('Mở khoá', 'Unlock') : L('Khoá', 'Lock')}</Button>
    <Button size="sm" icon={hd ? 'eye' : 'eyeOff'} onClick={() => cmd.toggleFlag('hidden')}>{hd ? L('Hiện', 'Show') : L('Ẩn', 'Hide')}</Button>
    <Button size="sm" variant="danger" icon="trash" title="Delete" onClick={() => cmd.remove()}>{L('Xoá', 'Delete')}</Button></div>;
}
function SkuHead({ k }: { k: Sku }) {
  const c = catalog.byId(k.id), diff = c && JSON.stringify([c.w, c.d, c.h, c.form, c.units, c.name, c.faces]) !== JSON.stringify([k.w, k.d, k.h, k.form, k.units, k.name, k.faces]);
  return <div className="panel-section">
    <div className="cell-sku"><SkuThumb k={k} size="lg" /><div style={{ minWidth: 0 }}><b style={{ fontWeight: 500, display: 'block' }}>{k.name}</b><span className="mono small muted">{k.code}</span><div className="small muted">{formLabel(k.form)} · {k.est ? '≈' : ''}{R1(k.w)}×{R1(k.d)}×{R1(k.h)} cm · {k.form === 'unit' ? 1 : k.units || '?'} {L('đv', 'units')}</div></div></div>
    {diff && <div className="notice">{L('SKU trong thiết kế khác danh mục.', 'This SKU differs from the catalog.')} <Button size="sm" onClick={() => cmd.syncFromMaster(k.id)}>{L('Cập nhật theo danh mục', 'Update from catalog')}</Button></div>}
    <div className="btn-row"><Button size="sm" onClick={() => editor.set({ dialog: { kind: 'replace' } })}>{L('Thay SKU…', 'Replace SKU…')}</Button><Button size="sm" variant="ghost" onClick={() => cmd.selectSame('sku')}>{L('Chọn cùng SKU', 'Same SKU')}</Button><Button size="sm" variant="ghost" onClick={() => cmd.selectSame('level')}>{L('Cùng cao độ', 'Same level')}</Button><Button size="sm" variant="ghost" onClick={() => cmd.selectSame('col')}>{L('Cùng cột', 'Same column')}</Button></div>
  </div>;
}

// ---------- per type ----------
function StockProps({ o, s }: { o: SceneObject & { sku: string }; s: Scene }) {
  const k = s.skuOf(o);
  if (!k) return <p className="muted">SKU?</p>;
  const onShelf = !!shelfUnder(s, o);
  if (o.type === 'sku') return <>
    <SkuHead k={k} />
    <div className="panel-section"><h3>{L('Xây nhanh', 'Quick build')}</h3><div className="btn-row">{(['row', 'grid', 'block'] as const).map((m) => <Button key={m} size="sm" disabled={(o.ry || 0) % 90 !== 0} onClick={() => editor.set({ builder: { ...defaultBuild(m), srcId: o.id, mode: m } })}>{{ row: L('Hàng', 'Row'), grid: L('Mảng', 'Grid'), block: L('Khối', 'Block') }[m]}</Button>)}</div>
      {onShelf && <div className="btn-row"><Button size="sm" onClick={() => cmd.count('x', (v) => v + 1)}>F +</Button><Button size="sm" onClick={() => cmd.count('y', (v) => v + 1)}>{L('Tầng +', 'Stack +')}</Button></div>}</div>
    <Position o={o} s={s} /><Rotation o={o} /><Dup /><Flags os={[o]} />
  </>;
  const a = o as ArrayObj, S = s.localSize(a);
  return <>
    <SkuHead k={k} />
    <div className="panel-section"><h3>{L('Khối', 'Block')} <span className="muted" style={{ fontWeight: 400 }}>· {arrayCount(a)} {formLabel(k.form).toLowerCase()} · {fmt(S.w)}×{fmt(S.d)}×{fmt(S.h)} cm</span></h3>
      <div className="grid3"><Field label={onShelf ? 'Facing' : L('Cột', 'Columns')}><NumberInput value={a.n.x} step={1} min={1} onCommit={(v) => cmd.arrayParam(a, 'nx', v)} /></Field><Field label={L('Hàng sâu', 'Rows deep')}><NumberInput value={a.n.z} step={1} min={1} onCommit={(v) => cmd.arrayParam(a, 'nz', v)} /></Field><Field label={L('Tầng', 'Levels')}><NumberInput value={a.n.y} step={1} min={1} onCommit={(v) => cmd.arrayParam(a, 'ny', v)} /></Field></div>
      <div className="btn-row"><Button size="sm" title="Shift+←" onClick={() => cmd.count('x', (v) => v - 1)}>F −</Button><Button size="sm" title={L('Shift+→ hoặc gõ 1–9', 'Shift+→ or type 1–9')} onClick={() => cmd.count('x', (v) => v + 1)}>F +</Button><Button size="sm" title="Shift+↓" onClick={() => cmd.count('y', (v) => v - 1)}>{L('Tầng −', 'Stack −')}</Button><Button size="sm" title="Shift+↑" onClick={() => cmd.count('y', (v) => v + 1)}>{L('Tầng +', 'Stack +')}</Button><Button size="sm" onClick={() => cmd.count('z', (v) => v - 1)}>{L('Sâu −', 'Depth −')}</Button><Button size="sm" onClick={() => cmd.count('z', (v) => v + 1)}>{L('Sâu +', 'Depth +')}</Button>{onShelf && <Button size="sm" onClick={() => cmd.fillOne(a)}>{L('Đủ chiều sâu', 'Fill depth')}</Button>}</div>
      <details><summary className="small muted" style={{ cursor: 'pointer' }}>{L('Nâng cao: hình dạng, khe hở, xoay ô', 'Advanced: shape, gaps, cell rotation')}</summary>
        <div className="panel-section" style={{ marginTop: 8 }}>
          <Field label={L('Hình dạng', 'Shape')}><Select<ArrayShape> value={a.shape || 'block'} options={[['block', L('Khối đặc', 'Solid block')], ['steps', L('Bậc thang', 'Steps')], ['pyramid', L('Kim tự tháp', 'Pyramid')]]} onChange={(v) => cmd.arrayParam(a, 'shape', v)} /></Field>
          {a.shape === 'steps' && <Field label={L('Mỗi bậc lùi (hàng)', 'Step back per level')}><NumberInput value={a.step || 1} step={1} min={1} onCommit={(v) => cmd.arrayParam(a, 'step', v)} /></Field>}
          <div className="grid3"><Field label={L('Khe X', 'Gap X')}><NumberInput value={a.gap.x} unit="cm" min={0} onCommit={(v) => cmd.arrayParam(a, 'gx', v)} /></Field><Field label={L('Khe Z', 'Gap Z')}><NumberInput value={a.gap.z} unit="cm" min={0} onCommit={(v) => cmd.arrayParam(a, 'gz', v)} /></Field><Field label={L('Khe Y', 'Gap Y')}><NumberInput value={a.gap.y} unit="cm" min={0} onCommit={(v) => cmd.arrayParam(a, 'gy', v)} /></Field></div>
          <div className="btn-row"><Button size="sm" onClick={() => cmd.arrayParam(a, 'cellRy', 0)}>{L('Xoay từng ô 90°', 'Rotate each cell 90°')}</Button><Button size="sm" onClick={() => cmd.splitLevels(a)}>{L('Tách theo tầng', 'Split by level')}</Button><Button size="sm" onClick={() => cmd.explode(a)}>{L('Tách từng thùng', 'Split into items')}</Button></div>
        </div></details>
    </div>
    <Position o={o} s={s} /><Rotation o={o} /><Dup /><Flags os={[o]} />
  </>;
}

function BuilderForm() {
  const B = useEditor((s) => s.builder)!, k = session.scene!.skuOf(session.scene!.get(B.srcId) || null);
  const set = (p: Partial<typeof B>) => editor.set({ builder: { ...B, ...p } });
  const s = session.scene!, it = s.get(B.srcId);
  const nb = (key: 'nx' | 'nz' | 'ny', lab: string) => <Field label={lab}><NumberInput value={B[key]} step={1} min={1} onCommit={(v) => set({ [key]: Math.max(1, Math.round(v)) })} /></Field>;
  const count = it ? (() => { const n = { x: B.nx, y: B.ny, z: B.nz }; return arrayCount({ n, shape: B.shape, step: B.step }); })() : 0;
  return <>
    <h3>{L('Xây nhanh', 'Quick build')}: {{ row: L('Hàng', 'Row'), grid: L('Mảng', 'Grid'), block: L('Khối', 'Block') }[B.mode]}</h3>
    <p className="small muted">{k?.name}</p>
    <div className="grid3">{nb('nx', L('Cột', 'Columns'))}{nb('nz', L('Hàng sâu', 'Rows'))}{nb('ny', L('Tầng', 'Levels'))}</div>
    <Field label={L('Hình dạng', 'Shape')}><Select<ArrayShape> value={B.shape} options={[['block', L('Khối đặc', 'Solid block')], ['steps', L('Bậc thang', 'Steps')], ['pyramid', L('Kim tự tháp', 'Pyramid')]]} onChange={(v) => set({ shape: v })} /></Field>
    <div className="grid2"><Field label={L('Hướng ngang', 'Across')}><Select value={String(B.dirX)} options={[['1', L('→ phải', '→ right')], ['-1', L('← trái', '← left')]]} onChange={(v) => set({ dirX: +v as 1 | -1 })} /></Field><Field label={L('Hướng sâu', 'Depth')}><Select value={String(B.dirZ)} options={[['-1', L('↑ về sau', '↑ back')], ['1', L('↓ về trước', '↓ front')]]} onChange={(v) => set({ dirZ: +v as 1 | -1 })} /></Field></div>
    <div className="well"><b style={{ fontSize: 18, fontWeight: 400 }} className="num">{count}</b> <span className="muted">{k ? formLabel(k.form).toLowerCase() : ''}</span></div>
    <div className="btn-row"><Button variant="primary" onClick={() => { cmd.applyBuild(B.srcId, B, B.mode); editor.set({ builder: null }); }}>{L('Áp dụng', 'Apply')}</Button><Button onClick={() => editor.set({ builder: null })}>{L('Huỷ', 'Cancel')} <span className="kbd">Esc</span></Button></div>
  </>;
}

function ShelfProps({ o, s }: { o: ShelfObj; s: Scene }) {
  const t = s.aabb(o), it = shelfDirect(s, o), used = it.reduce((a, q) => { const b = s.aabb(q); return a + Math.max(0, Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0)); }, 0), f = o.fixture ? (s.get(o.fixture) as FixtureObj | undefined) : undefined;
  return <>
    <h3>{o.name || L('Tấm kệ', 'Shelf')}</h3>
    <p className="small muted">{it.length} {L('vị trí', 'positions')} · {L('đã dùng', 'used')} {fmt(used)}/{fmt(t.x1 - t.x0)} cm ({fmt((used / Math.max(1, t.x1 - t.x0)) * 100)}%)</p>
    <Field label={L('Mặt kệ cao (từ sàn)', 'Shelf top (from floor)')} hint={f?.fx ? L(`Bám lỗ cài ${f.fx.pitch} cm; hàng trên kệ đi theo`, `Snaps to the ${f.fx.pitch} cm notch pitch; products follow`) : undefined}><NumberInput value={t.y1} unit="cm" onCommit={(v) => cmd.shelfTop(o, v)} /></Field>
    <div className="panel-section"><h3>{L('Sắp xếp trên kệ', 'Arrange on shelf')}</h3><div className="btn-row"><Button size="sm" onClick={() => cmd.packShelf(o, 'L')}>{L('Dồn trái', 'Pack left')}</Button><Button size="sm" onClick={() => cmd.packShelf(o, 'D')}>{L('Giãn đều', 'Spread')}</Button><Button size="sm" onClick={() => cmd.packShelf(o, 'R')}>{L('Dồn phải', 'Pack right')}</Button><Button size="sm" onClick={() => cmd.fillDepth(o)}>{L('Lấp đầy chiều sâu', 'Fill depth')}</Button></div>
      <div className="btn-row"><Button size="sm" variant="ghost" onClick={() => cmd.selectShelfItems(o)}>{L('Chọn hàng trên kệ', 'Select products on shelf')}</Button></div></div>
    <div className="grid3"><Field label={L('Rộng', 'Width')}><NumberInput value={o.size.w} unit="cm" onCommit={(v) => cmd.resize(o, 'w', v)} /></Field><Field label={L('Sâu', 'Depth')}><NumberInput value={o.size.d} unit="cm" onCommit={(v) => cmd.resize(o, 'd', v)} /></Field><Field label={L('Dày', 'Thickness')}><NumberInput value={o.size.h} unit="cm" onCommit={(v) => cmd.resize(o, 'h', v)} /></Field></div>
    <Flags os={[o]} />
  </>;
}
function FixtureProps({ o, s }: { o: FixtureObj; s: Scene }) {
  const sh = s.d.objects.filter((q) => q.type === 'shelf' && q.fixture === o.id);
  return <>
    <h3>{o.name || 'Bay'}</h3><p className="small muted">{sh.length} {L('tấm kệ', 'shelves')} · {L('bước lỗ', 'pitch')} {o.fx ? o.fx.pitch : '—'} cm</p>
    <Field label={L('Tên', 'Name')}><TextInput value={o.name || ''} onCommit={(v) => cmd.rename(o, v)} /></Field>
    <div className="grid3"><Field label={L('Rộng', 'Width')}><NumberInput value={o.size.w} unit="cm" onCommit={(v) => cmd.resizeBay(o, v)} /></Field><Field label={L('Cao', 'Height')}><NumberInput value={o.size.h} unit="cm" onCommit={(v) => cmd.resize(o, 'h', v)} /></Field><Field label={L('Bước lỗ', 'Pitch')}><NumberInput value={o.fx?.pitch ?? 2.5} unit="cm" onCommit={(v) => cmd.setPitch(o, v)} /></Field></div>
    <div className="btn-row"><Button size="sm" icon="plus" onClick={() => cmd.addShelf(o)}>{L('Thêm tấm kệ', 'Add shelf')}</Button><Button size="sm" variant="danger" icon="trash" onClick={() => { if (confirm(L('Xoá bay kèm kệ và hàng trên đó?', 'Delete the bay with its shelves and products?'))) cmd.deleteBay(o); }}>{L('Xoá bay', 'Delete bay')}</Button></div>
    <p className="small muted">{L('Bay đang khoá để không kéo nhầm; mở khoá rồi kéo trong Top/3D để dời cả bay (kèm kệ và hàng).', 'Bays are locked against accidental drags; unlock, then drag in Top/3D to move the whole bay with its shelves and products.')}</p>
    <Position o={o} s={s} /><Flags os={[o]} />
  </>;
}
function PalletProps({ o, s }: { o: PalletObj; s: Scene }) {
  return <>
    <h3>{o.name || 'Pallet'}</h3>
    <Field label={L('Tên', 'Name')}><TextInput value={o.name || ''} onCommit={(v) => cmd.rename(o, v)} /></Field>
    <div className="grid3"><Field label={L('Rộng', 'Width')}><NumberInput value={o.size.w} unit="cm" onCommit={(v) => cmd.resize(o, 'w', v)} /></Field><Field label={L('Sâu', 'Depth')}><NumberInput value={o.size.d} unit="cm" onCommit={(v) => cmd.resize(o, 'd', v)} /></Field><Field label={L('Cao', 'Height')}><NumberInput value={o.size.h} unit="cm" onCommit={(v) => cmd.resize(o, 'h', v)} /></Field></div>
    {o.subtype !== 'deck' && <Button onClick={() => editor.set({ dialog: { kind: 'shell' } })}>{L('Xếp viền rỗng ruột…', 'Hollow shell…')} <span className="kbd">H</span></Button>}
    <Position o={o} s={s} /><Rotation o={o} /><Dup /><Flags os={[o]} />
  </>;
}
function ImageObjProps({ o }: { o: PosmObj | PropObj }) {
  const s = session.scene!, src = catalog.asset(o.asset), [keep, setKeep] = useState(true);
  return <>
    <h3>{o.type === 'posm' ? 'POSM' : L('Vật trang trí', 'Decorative prop')}</h3>
    {src && <img src={src} alt="" style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', background: 'var(--raised)', borderRadius: 6 }} />}
    {o.type === 'posm' && o.cutout && <p className="small muted">{L('Biểu diễn phẳng (cutout) – không phải mô hình 3D thật', 'Flat cutout – not a true 3D model')}</p>}
    <Field label={L('Tên', 'Name')}><TextInput value={o.name || ''} onCommit={(v) => cmd.rename(o, v)} /></Field>
    <div className="grid3"><Field label={L('Rộng', 'Width')}><NumberInput value={o.size.w} unit="cm" onCommit={(v) => cmd.resize(o, 'w', v, keep)} /></Field><Field label={o.type === 'posm' ? L('Dày', 'Thickness') : L('Sâu', 'Depth')}><NumberInput value={o.size.d} unit="cm" onCommit={(v) => cmd.resize(o, 'd', v)} /></Field><Field label={L('Cao', 'Height')}><NumberInput value={o.size.h} unit="cm" onCommit={(v) => cmd.resize(o, 'h', v, keep)} /></Field></div>
    <label className="check"><input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />{L('Giữ tỷ lệ ảnh', 'Keep image aspect')}</label>
    <div className="grid2"><Field label={L('Màu', 'Colour')}><input type="color" className="input" style={{ padding: 2 }} value={o.color || '#ffffff'} onChange={(e) => cmd.setColor(o, e.target.value)} /></Field>
      <Field label={L('Ảnh', 'Image')}><input type="file" accept="image/*" className="input" style={{ paddingTop: 4 }} onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const src2 = await readAsDataURL(f), al = /png/i.test(f.type) ? await pngHasAlpha(src2) : false, id = await catalog.putAsset(await shrinkImage(src2, 1400, al)); const im = await loadImg(catalog.asset(id)!), ar = im.naturalWidth / Math.max(1, im.naturalHeight); session.edit(L('Đổi ảnh', 'Change image'), (sc) => { const x = sc.get(o.id) as PosmObj | PropObj; x.asset = id; if (x.type === 'posm') x.cutout = al; x.size.h = R1(x.size.w / ar); }); }} /></Field></div>
    <Position o={o} s={s} /><Rotation o={o} /><Dup /><Flags os={[o]} />
  </>;
}
function Multi({ os, s }: { os: SceneObject[]; s: Scene }) {
  const b = os.map((o) => s.aabb(o)).reduce((a, x) => ({ x0: Math.min(a.x0, x.x0), x1: Math.max(a.x1, x.x1), y0: Math.min(a.y0, x.y0), y1: Math.max(a.y1, x.y1), z0: Math.min(a.z0, x.z0), z1: Math.max(a.z1, x.z1) }));
  const stock = os.filter(isStock);
  return <>
    <h3>{L(`Đã chọn ${os.length} vật`, `${os.length} objects selected`)}</h3>
    <p className="small muted">{fmt(b.x1 - b.x0)} × {fmt(b.z1 - b.z0)} × {fmt(b.y1 - b.y0)} cm</p>
    {stock.length > 0 && <div className="btn-row"><Button size="sm" onClick={() => cmd.count('x', (v) => v - 1)}>F −</Button><Button size="sm" onClick={() => cmd.count('x', (v) => v + 1)}>F +</Button><Button size="sm" onClick={() => editor.set({ dialog: { kind: 'replace' } })}>{L('Thay SKU…', 'Replace SKU…')}</Button></div>}
    <div className="panel-section"><h3>{L('Căn', 'Align')}</h3><div className="btn-row">{([['L', L('Trái', 'Left')], ['C', L('Giữa', 'Centre')], ['R', L('Phải', 'Right')], ['B', L('Sau', 'Back')], ['F', L('Trước', 'Front')], ['DX', L('Giãn đều', 'Distribute')]] as const).map(([m, l]) => <Button key={m} size="sm" onClick={() => cmd.align(m)}>{l}</Button>)}</div></div>
    <div className="panel-section"><h3>{L('Vị trí vùng chọn', 'Selection position')}</h3><div className="grid3"><Field label="X"><NumberInput value={b.x0} unit="cm" onCommit={(v) => cmd.setPosition('x', v)} /></Field><Field label="Z"><NumberInput value={b.z0} unit="cm" onCommit={(v) => cmd.setPosition('z', v)} /></Field><Field label="Y"><NumberInput value={b.y0} unit="cm" onCommit={(v) => cmd.setPosition('y', v)} /></Field></div></div>
    <div className="btn-row"><Button size="sm" icon="rotate" onClick={() => cmd.rotate(1)}>90°</Button><Button size="sm" variant="ghost" onClick={() => cmd.selectSame('level')}>{L('Cùng cao độ', 'Same level')}</Button><Button size="sm" variant="ghost" onClick={() => cmd.selectSame('col')}>{L('Cùng cột', 'Same column')}</Button></div>
    <Dup /><Flags os={os} />
  </>;
}

function ShelfSummary({ s }: { s: Scene }) {
  const own = usePrefs((p) => p.ownMaker), m = shelfMetrics(s), o = m.makers.find((e) => e.key.toUpperCase().includes(own.toUpperCase())), est = usedSkus(s).filter((k) => k.est).length, id = useSession((st) => st.id);
  return <>
    <h3>{L('Planogram kệ', 'Shelf planogram')}</h3>
    <div className="mini-kpis"><div><b>{fmt(m.totalLinear, 0)}</b><span>{L('cm kệ', 'shelf cm')}</span></div><div><b>{fmt(m.totalLinear ? (m.usedLinear / m.totalLinear) * 100 : 0)}%</b><span>{L('đã dùng', 'used')}</span></div><div><b>{m.rows.length}</b><span>SKU</span></div><div><b>{m.rows.reduce((a, r) => a + r.facings, 0)}</b><span>Facing</span></div><div><b style={{ color: 'var(--chart-1)' }}>{o ? fmt(o.share * 100) + '%' : '—'}</b><span>{own} share</span></div><div><b>{s.d.objects.filter((x) => x.type === 'fixture').length}</b><span>Bay</span></div></div>
    <Field label={L('Chiều cao tối đa', 'Max height')}><NumberInput value={s.d.settings.maxH} unit="cm" onCommit={(v) => cmd.setting('maxH', v)} /></Field>
    <div className="btn-row"><Button size="sm" icon="auto" onClick={() => go('/auto/' + id)}>Auto POG</Button><Button size="sm" onClick={() => editor.set({ dialog: { kind: 'compare' } })}>{L('So sánh hiện trạng/đề xuất', 'Compare current/proposal')}</Button><Button size="sm" variant={est ? undefined : 'ghost'} onClick={() => editor.set({ dialog: { kind: 'dims' } })}>{L('Kích thước SKU', 'SKU sizes')}{est ? ` (≈ ${est})` : ''}</Button><Button size="sm" variant="ghost" onClick={() => editor.set({ dialog: { kind: 'sales' } })}>{L('Nhập số bán', 'Import sales')}</Button></div>
    <div className="well small"><p><b>{L('Mẹo', 'Tips')}</b></p><p className="muted">{L('Kéo SKU vào tấm kệ ở khung Trước: tự thành 1 facing lấp đầy chiều sâu. Chọn khối → gõ số để đặt facing, Shift+↑↓ chồng tầng. Chọn tấm kệ → Dồn trái/Giãn đều. Kéo tấm kệ lên/xuống ở khung Trước.', 'Drag SKUs onto a shelf in the Front view: each becomes one facing filling the depth. Select a block → type a number for facings, Shift+↑↓ to stack. Select a shelf → pack/spread. Drag shelves up/down in the Front view.')}</p></div>
  </>;
}
function PalletSummary({ s }: { s: Scene }) {
  const p = s.d.objects.find((o): o is PalletObj => o.type === 'pallet' && o.subtype !== 'deck'), bom = computeBOM(s), sb = s.sceneBox(true), follow = usePrefs((x) => x.palletFollow);
  return <>
    <h3>Display</h3>
    <div className="grid2"><Field label={L('Chiều cao tối đa', 'Max height')}><NumberInput value={s.d.settings.maxH} unit="cm" onCommit={(v) => cmd.setting('maxH', v)} /></Field><Field label={L('Cho phép lố mép', 'Allowed overhang')}><NumberInput value={s.d.settings.overhang} unit="cm" onCommit={(v) => cmd.setting('overhang', v)} /></Field></div>
    {p && <div className="panel-section"><h3>Pallet</h3>
      <Field label={L('Mẫu pallet', 'Pallet preset')}><Select value={PALLET_PRESETS[s.d.settings.preset] ? s.d.settings.preset : 'custom'} options={[...Object.values(PALLET_PRESETS).map((x) => [x.id, `${x.name} – ${x.w}×${x.d}×${x.h}`] as [string, string]), ['custom', 'Custom']]} onChange={(v) => { const pr = PALLET_PRESETS[v]; if (pr) { cmd.resizePallet(p, pr.w, pr.d, pr.h, v); cmd.setting('maxH', pr.maxH); } }} /></Field>
      <div className="grid3"><Field label={L('Rộng', 'Width')}><NumberInput value={p.size.w} unit="cm" onCommit={(v) => cmd.resizePallet(p, Math.max(1, v), p.size.d, p.size.h)} /></Field><Field label={L('Sâu', 'Depth')}><NumberInput value={p.size.d} unit="cm" onCommit={(v) => cmd.resizePallet(p, p.size.w, Math.max(1, v), p.size.h)} /></Field><Field label={L('Cao', 'Height')}><NumberInput value={p.size.h} unit="cm" onCommit={(v) => cmd.resizePallet(p, p.size.w, p.size.d, Math.max(1, v))} /></Field></div>
      <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setPref('palletFollow', e.target.checked)} />{L('Khi đổi chiều cao pallet: dời hàng đang đặt trên mặt pallet theo', 'When the pallet height changes, move products standing on it')}</label>
      <Button onClick={() => editor.set({ dialog: { kind: 'shell' } })}>{L('Xếp viền rỗng ruột (chỉ mặt ngoài)…', 'Hollow shell (outer faces only)…')} <span className="kbd">H</span></Button></div>}
    <div className="mini-kpis"><div><b>{sb ? fmt(sb.x1 - sb.x0, 0) + '×' + fmt(sb.z1 - sb.z0, 0) : 0}</b><span>cm</span></div><div><b>{sb ? fmt(sb.y1) : 0}</b><span>{L('cao', 'height')} cm</span></div><div><b>{bom.tot.carton}</b><span>{L('thùng', 'cartons')}</span></div><div><b>{bom.tot.pack}</b><span>{L('lốc', 'packs')}</span></div><div><b>{bom.tot.unit}</b><span>{L('lẻ', 'singles')}</span></div><div><b>{fmt(bom.tot.conv, 0)}</b><span>{L('quy đổi', 'converted')}</span></div></div>
    <div className="well small"><p className="muted"><span className="kbd">R</span> {L('xoay', 'rotate')} · <span className="kbd">Ctrl+D</span> {L('nhân bản', 'duplicate')} · <span className="kbd">Ctrl+kéo</span> {L('nhân bản khi kéo', 'copy while dragging')} · <span className="kbd">Del</span> {L('xoá', 'delete')} · <span className="kbd">←→↑↓</span> {L('dịch 1 cm', 'nudge 1 cm')} · <span className="kbd">PgUp/PgDn</span> {L('nâng/hạ', 'raise/lower')} · <span className="kbd">F</span> {L('vừa khung', 'frame')} · <span className="kbd">M</span> {L('đo', 'measure')} · <span className="kbd">H</span> {L('viền rỗng', 'shell')}</p></div>
  </>;
}

function Layers() {
  const s = session.scene!, sel = useSession((st) => st.sel);
  const lv = new Map<number, SceneObject[]>();
  for (const o of s.d.objects) { if (o.type === 'pallet') continue; const y = Math.round(s.aabb(o).y0 * 2) / 2; const e = lv.get(y) || []; e.push(o); lv.set(y, e); }
  const levels = [...lv.entries()].sort((a, b) => a[0] - b[0]), list = s.d.objects.slice(0, 400);
  const icon = (o: SceneObject) => { const I = o.type === 'array' ? Icon.layers : o.type === 'sku' ? Icon.planograms : o.type === 'pallet' ? Icon.pallet : o.type === 'shelf' || o.type === 'fixture' ? Icon.gondola : Icon.posm; return <I />; };
  return <>
    <div className="panel-section"><h3>{L('Theo cao độ (đáy)', 'By level (bottom)')}</h3><div className="btn-row">{levels.map(([y, os]) => <Button key={y} size="sm" onClick={(e) => session.select(s.d.objects.filter((o) => o.type !== 'pallet' && !o.lock && !o.hidden && Math.round(s.aabb(o).y0 * 2) / 2 === y).map((o) => o.id), e.shiftKey)}>{fmt(y)} cm · {os.length}</Button>)}</div></div>
    <div className="panel-section"><h3>{L('Đối tượng', 'Objects')} <span className="muted" style={{ fontWeight: 400 }}>({s.d.objects.length})</span></h3>
      <div>{list.map((o) => <div key={o.id} className={'layer-row' + (sel.has(o.id) ? ' on' : '') + (o.hidden ? ' dim' : '')} onClick={(e) => (e.shiftKey ? session.toggle(o.id) : session.select([o.id]))}>
        <span className="muted">{icon(o)}</span><span className="n">{s.objName(o)}</span><span className="small muted num">{fmt(s.aabb(o).y0)}</span>
        <button aria-label={o.lock ? L('Mở khoá', 'Unlock') : L('Khoá', 'Lock')} onClick={(e) => { e.stopPropagation(); cmd.flagOne(o.id, 'lock'); }}>{o.lock ? <Icon.lock /> : <Icon.unlock style={{ opacity: 0.35 }} />}</button>
        <button aria-label={o.hidden ? L('Hiện', 'Show') : L('Ẩn', 'Hide')} onClick={(e) => { e.stopPropagation(); cmd.flagOne(o.id, 'hidden'); }}>{o.hidden ? <Icon.eyeOff /> : <Icon.eye />}</button></div>)}
        {s.d.objects.length > 400 && <p className="small muted">+{s.d.objects.length - 400}…</p>}</div></div>
  </>;
}

function Quantities() {
  const s = session.scene!, b = computeBOM(s), T = b.tot, shelf = s.isShelfMode;
  const m = shelf ? shelfMetrics(s) : null;
  return <>
    {m && <div className="panel-section"><h3>{L('Chỉ số kệ', 'Shelf metrics')}</h3>
      <div className="mini-kpis"><div><b>{fmt(m.totalLinear, 0)}</b><span>{L('cm kệ', 'shelf cm')}</span></div><div><b>{fmt(m.usedLinear, 0)}</b><span>{L('cm dùng', 'cm used')}</span></div><div><b>{m.rows.length}</b><span>SKU</span></div></div>
      <ShareTable rows={m.brands} label="Brand" /><ShareTable rows={m.makers} label={L('Nhà SX', 'Maker')} />
      <h3>SKU · {L('ngày đủ hàng', 'days of supply')}</h3>
      <Field label={L('Cảnh báo khi dưới (ngày)', 'Warn below (days)')}><NumberInput value={m.minDos} step={0.5} onCommit={(v) => cmd.setting('minDos', v)} /></Field>
      {s.d.settings.salesSrc && <p className="small muted">{L('Số bán', 'Sales')}: {s.d.settings.salesSrc}</p>}
      {!m.rows.length ? <p className="small muted">{L('Kéo SKU từ thư viện lên tấm kệ để bắt đầu.', 'Drag SKUs from the library onto a shelf to start.')}</p> : <div className="table-wrap"><table className="t"><thead><tr><th>SKU</th><th className="num">F</th><th className="num">cm</th><th className="num">{L('Ngày', 'Days')}</th></tr></thead><tbody>{m.rows.map((r) => <tr key={r.k.id}><td><span className="dot" style={{ background: r.k.color }} />{r.k.name}<span className="sub">{r.count} {formLabel(r.k.form).toLowerCase()}{r.conv ? ` = ${fmt(r.conv, 0)} ${L('đv', 'u')}` : ''}{r.sales ? ` · ${fmt(r.sales)}/${L('tuần', 'wk')}` : ''}</span></td><td className="num">{r.facings}</td><td className="num">{fmt(r.linear)}</td><td className="num" style={r.dos != null && r.dos < m.minDos ? { color: 'var(--negative)' } : undefined}>{r.dos != null ? fmt(r.dos) : <span className="dash">—</span>}</td></tr>)}</tbody></table></div>}
    </div>}
    <div className="panel-section"><h3>{L('Số lượng (BOM)', 'Bill of materials')} <span className="muted" style={{ fontWeight: 400 }}>· {L('đếm từ mô hình', 'counted from the model')}</span></h3>
      <div className="mini-kpis"><div><b>{T.carton}</b><span>{L('thùng', 'cartons')}</span></div><div><b>{T.pack}</b><span>{L('lốc/khay', 'packs')}</span></div><div><b>{T.unit}</b><span>{L('lẻ', 'singles')}</span></div></div>
      <div className="well"><span className="muted">{L('Quy đổi đơn vị', 'Converted units')}</span> <b className="num" style={{ float: 'right' }}>{fmt(T.conv, 0)}{T.unknown ? ' *' : ''}</b></div>
      {T.unknown > 0 && <p className="small" style={{ color: 'var(--warning)' }}>* {T.unknown} {L('vật thuộc SKU chưa rõ quy cách – không quy đổi', 'objects have no pack size – not converted')}</p>}
      <div className="table-wrap"><table className="t"><thead><tr><th>SKU</th><th className="num">{L('SL', 'Qty')}</th><th className="num">{L('Quy đổi', 'Conv.')}</th></tr></thead><tbody>{b.rows.map((r) => <tr key={r.k.id}><td><span className="dot" style={{ background: r.k.color }} />{r.k.name}<span className="sub mono">{r.k.code} · {formLabel(r.k.form)}{r.units ? ' × ' + r.units : ''}</span></td><td className="num">{r.n}</td><td className="num">{r.conv != null ? fmt(r.conv, 0) : <Pill tone="warning">?</Pill>}</td></tr>)}
        {!b.rows.length && <tr><td colSpan={3} className="muted">{L('Chưa có sản phẩm', 'No products yet')}</td></tr>}</tbody></table></div>
      {b.families.length > 0 && <div className="small">{b.families.map((f) => <p key={f.key}><b>{f.key}</b>: {f.parts.map((p) => `${p.n} ${formLabel(p.k.form).toLowerCase()}${p.k.form !== 'unit' ? ' × ' + (p.units || '?') : ''}`).join(' + ')} = <b>{f.unknown ? '?' : fmt(f.conv, 0)}</b></p>)}</div>}
      {(b.posm.length > 0 || b.props.length > 0 || b.pallets > 0) && <dl className="kv">{b.pallets > 0 && <><dt>Pallet</dt><dd>{b.pallets}</dd></>}{b.posm.map(([n, c]) => <><dt key={'p' + n}>POSM · {n}</dt><dd key={'pv' + n}>{c}</dd></>)}{b.props.map(([n, c]) => <><dt key={'r' + n}>{L('Trang trí', 'Prop')} · {n}</dt><dd key={'rv' + n}>{c}</dd></>)}</dl>}
      <p className="small muted">{L('Chỉ quy đổi khi SKU có số đơn vị/quy cách. Vật trang trí và lon vẽ trên mặt thùng không được đếm.', 'Units convert only when the SKU has a pack size. Props and cans printed on artwork are never counted.')}</p>
      <Button icon="download" onClick={() => bomCsv(s.d)}>{L('Xuất BOM (CSV)', 'Export BOM (CSV)')}</Button>
    </div>
  </>;
}
function ShareTable({ rows, label }: { rows: { key: string; linear: number; share: number; facings: number }[]; label: string }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.share));
  if (!rows.length) return <p className="small muted">{label}: {L('chưa có sản phẩm trên kệ.', 'no products on the shelves yet.')}</p>;
  return <div className="table-wrap"><table className="t"><thead><tr><th>{label}</th><th className="num">cm</th><th className="num">Share</th><th className="num">F</th></tr></thead><tbody>{rows.map((e) => <tr key={e.key}><td><div className="barcell"><span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.key}</span></div><span className="sub"><span className="barcell"><span className="track" style={{ width: 90 }}><i style={{ width: (e.share / max) * 100 + '%', background: 'var(--chart-muted)' }} /></span></span></span></td><td className="num">{fmt(e.linear)}</td><td className="num">{fmt(e.share * 100)}%</td><td className="num">{e.facings}</td></tr>)}</tbody></table></div>;
}

export const _rt = runtime;
