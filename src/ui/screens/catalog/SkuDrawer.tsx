// Edit one SKU of the master catalog (all legacy fields + prices + identifiers + face images), in a side drawer.
import { useState } from 'react';
import { formLabel, L } from '../../../domain/i18n';
import { PALETTE } from '../../../domain/colors';
import { codeIdentifier } from '../../../domain/catalog/catalog';
import type { Face, Identifier, PackForm, Sku } from '../../../domain/types';
import { deep, uid } from '../../../domain/util';
import { catalog, useCatalog } from '../../../app/catalogStore';
import { readAsDataURL, shrinkImage } from '../../../infra/images';
import { Button, Drawer, Field, Select } from '../../ds';

const FACES: Face[] = ['front', 'back', 'left', 'right', 'top'];
const FACE_LABEL: Record<string, [string, string]> = { front: ['Trước', 'Front'], back: ['Sau', 'Back'], left: ['Trái', 'Left'], right: ['Phải', 'Right'], top: ['Trên', 'Top'] };

export function SkuDrawer({ id, onClose, onSaved }: { id: string | null; onClose: () => void; onSaved?: (k: Sku) => void }) {
  useCatalog((s) => s.assets);
  const base = id ? catalog.byId(id) : null;
  const [k, setK] = useState<Sku>(() => base ? deep(base) : { id: 'u:' + uid('s'), code: '', name: '', brand: '', maker: '', form: 'carton', w: 30, d: 20, h: 15, units: 24, kg: 0, color: PALETTE[catalog.get().catalog.length % PALETTE.length], family: '', faces: {}, ml: '', pkg: '', cat: '', sub: '' });
  const set = <K extends keyof Sku>(f: K, v: Sku[K]) => setK((x) => ({ ...x, [f]: v }));
  const txt = (f: keyof Sku, lab: string, mono = false) => <Field label={lab}><input className={'input' + (mono ? ' mono' : '')} value={String(k[f] ?? '')} onChange={(e) => set(f, e.target.value as never)} /></Field>;
  const num = (f: 'w' | 'd' | 'h' | 'kg' | 'units', lab: string, unit = 'cm') => <Field label={lab}><div className="input-wrap"><input className="input num" inputMode="decimal" value={String(k[f] ?? '')} onChange={(e) => set(f, (parseFloat(e.target.value.replace(',', '.')) || 0) as never)} />{unit && <span className="unit">{unit}</span>}</div></Field>;
  const price = (f: 'priceNormal' | 'pricePromo', lab: string) => <Field label={lab}><div className="input-wrap"><input className="input num" inputMode="numeric" value={k[f] == null ? '' : String(k[f])} placeholder="—" onChange={(e) => { const v = e.target.value.replace(/[^\d]/g, ''); set(f, v ? +v : null); }} /><span className="unit">₫</span></div></Field>;
  const ident = k.identifiers || [];
  const save = () => {
    const nk: Sku = { ...k, code: k.code.trim(), name: k.name.trim() || k.code.trim(), brand: k.brand.trim(), maker: k.maker.trim(), w: Math.max(0.1, +k.w || 0.1), d: Math.max(0.1, +k.d || 0.1), h: Math.max(0.1, +k.h || 0.1), units: k.form === 'unit' ? 1 : Math.max(0, Math.round(+k.units || 0)) };
    if (!base && nk.code) nk.id = 'c:' + nk.code;
    if (base && (base.w !== nk.w || base.d !== nk.d || base.h !== nk.h)) { delete nk.est; nk.dsrc = 'tay'; }
    const saved = catalog.upsert(nk);
    onSaved?.(saved);
    onClose();
  };
  return <Drawer title={base ? L('Sửa SKU', 'Edit SKU') : L('SKU mới', 'New SKU')} onClose={onClose} footer={<><Button onClick={onClose}>{L('Huỷ', 'Cancel')}</Button><Button variant="primary" onClick={save}>{L('Lưu vào danh mục', 'Save to catalog')}</Button></>}>
    {base?.pid && <p className="small muted">PID <span className="mono">{base.pid}</span>{base.est ? ' · ' + L('kích thước ước tính (≈)', 'estimated size (≈)') : ''}</p>}
    <div className="grid2">{txt('code', L('Mã (EAN / mã SKU)', 'Code (EAN / SKU code)'), true)}{txt('brand', 'Brand')}</div>
    {txt('name', L('Tên', 'Name'))}
    <div className="grid2">{txt('maker', L('Nhà sản xuất', 'Manufacturer'))}{txt('cat', L('Ngành hàng', 'Category'))}</div>
    <div className="grid3">
      <Field label={L('Quy cách', 'Pack form')}><Select<PackForm> value={k.form} options={(['carton', 'pack', 'unit'] as PackForm[]).map((f) => [f, formLabel(f)])} onChange={(v) => set('form', v)} /></Field>
      {num('units', L('Đơn vị / quy cách', 'Units per pack'), '')}{num('kg', 'Kg', 'kg')}
    </div>
    <div className="grid3">{num('w', L('Rộng (mặt trước)', 'Width (front)'))}{num('d', L('Sâu', 'Depth'))}{num('h', L('Cao', 'Height'))}</div>
    <h3>{L('Giá (master data)', 'Prices (master data)')}</h3>
    <div className="grid2">{price('priceNormal', L('Giá niêm yết', 'Normal price'))}{price('pricePromo', L('Giá khuyến mãi', 'Promo price'))}</div>
    <p className="small muted">{L('Giá theo 1 đơn vị bán của SKU (thùng/lốc/lon). Phiếu dựng tự lấy giá này; vẫn sửa được riêng từng phiếu.', 'Price per selling unit of this SKU (carton/pack/single). Build sheets use it by default and can override per sheet.')}</p>
    <div className="grid2"><Field label={L('Nhóm quy đổi', 'Conversion family')} hint={L('SKU cùng nhóm được cộng dồn khi quy đổi (vd. thùng 24 lon + lon lẻ).', 'SKUs of one family add up when converting (e.g. 24-can carton + loose cans).')}><input className="input" value={k.family} onChange={(e) => set('family', e.target.value)} /></Field>
      <Field label={L('Màu (khi chưa có ảnh)', 'Colour (without images)')}><input className="input" type="color" value={k.color} onChange={(e) => set('color', e.target.value)} style={{ padding: 2 }} /></Field></div>
    <h3>{L('Ảnh các mặt', 'Face images')}</h3>
    <div className="grid4" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>{FACES.map((f) => { const src = catalog.asset(k.faces[f]); return <label key={f} className="field" style={{ cursor: 'pointer' }}><span>{L(FACE_LABEL[f][0], FACE_LABEL[f][1])}</span>
      <div className="thumb lg" style={{ width: '100%', height: 64 }}>{src ? <img src={src} alt="" /> : <span className="muted">+</span>}</div>
      <input type="file" accept="image/*" hidden onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const id2 = await catalog.putAsset(await shrinkImage(await readAsDataURL(file), 640)); set('faces', { ...k.faces, [f]: id2 }); }} /></label>; })}</div>
    <h3>{L('Mã nhận diện', 'Identifiers')}</h3>
    <div className="lib-list">
      {codeIdentifier(k.code) && <div className="small"><span className="pill info">{codeIdentifier(k.code)!.type}</span> <span className="mono">{k.code}</span> <span className="muted">· {L('mã chính', 'primary')}</span></div>}
      {ident.map((x, i) => <div key={i} className="grid3" style={{ gridTemplateColumns: '120px 1fr 32px' }}>
        <Select<Identifier['type']> value={x.type} options={(['EAN13', 'EAN8', 'UPC12', 'CHAIN_CODE', 'INTERNAL_CODE', 'OTHER'] as const).map((t) => [t, t])} onChange={(v) => set('identifiers', ident.map((y, j) => (j === i ? { ...y, type: v } : y)))} />
        <input className="input mono" value={x.value} placeholder={x.type === 'CHAIN_CODE' ? L('mã chuỗi (vd. Sale.code Lotte)', 'retailer code') : ''} onChange={(e) => set('identifiers', ident.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)))} />
        <Button variant="ghost" icon="trash" aria-label={L('Xoá mã', 'Remove identifier')} onClick={() => set('identifiers', ident.filter((_, j) => j !== i))} /></div>)}
      <div><Button size="sm" icon="plus" onClick={() => set('identifiers', [...ident, { type: 'CHAIN_CODE', value: '', status: 'unverified' }])}>{L('Thêm mã', 'Add identifier')}</Button></div>
    </div>
  </Drawer>;
}
