// Competitors (a real view over the master's manufacturer field) and Presets (pallets, gondolas, display types).
import { useMemo, useState } from 'react';
import { makerSummary } from '../../domain/catalog/catalog';
import { formLabel, L } from '../../domain/i18n';
import { DISPLAY_TYPES, GONDOLA_PRESETS, PALLET_PRESETS } from '../../domain/presets';
import { R1 } from '../../domain/util';
import { useCatalog } from '../../app/catalogStore';
import { setPref, usePrefs } from '../../app/prefs';
import { AppFrame } from '../shell/AppFrame';
import { Field, Pill, Select, SkuThumb } from '../ds';

export function Competitors({ path }: { path: string }) {
  const cat = useCatalog((s) => s.catalog), own = usePrefs((s) => s.ownMaker), comp = usePrefs((s) => s.competitor);
  usePrefs((s) => s.lang);
  const rows = useMemo(() => makerSummary(cat, own), [cat, own]);
  const [maker, setMaker] = useState(comp);
  const skus = cat.filter((k) => (k.maker || '—') === maker).slice(0, 300);
  const named = rows.filter((r) => r.maker !== 'OTHER' && r.maker !== '—');
  return <AppFrame path={path} title={L('Đối thủ', 'Competitors')}>
    <div className="page">
      <div className="page-head"><div><h1>{L('Đối thủ', 'Competitors')}</h1><p className="lead">{L(`Từ cột nhà sản xuất của danh mục: ${named.length} nhà SX có tên, ${rows.find((r) => r.maker === 'OTHER')?.skus || 0} SKU ghi "OTHER".`, `From the catalog's manufacturer field: ${named.length} named makers, ${rows.find((r) => r.maker === 'OTHER')?.skus || 0} SKUs marked "OTHER".`)}</p></div></div>
      <div className="controls-row">
        <Field label={L('Nhà SX của mình (nhóm tập trung)', 'Own manufacturer (focus group)')}><Select value={own} options={named.map((r) => [r.maker, r.maker] as [string, string])} onChange={(v) => setPref('ownMaker', v)} /></Field>
        <Field label={L('Đối thủ chính (màu đỏ trên biểu đồ)', 'Main competitor (red in charts)')}><Select value={comp} options={named.filter((r) => !r.own).map((r) => [r.maker, r.maker] as [string, string])} onChange={(v) => setPref('competitor', v)} /></Field>
      </div>
      <div className="notice info" style={{ marginBottom: 20, maxWidth: 900 }}>{L('Danh mục đối thủ dùng chính dữ liệu master (không nhập tay số liệu giả). Giá và kích thước đối thủ sửa trong Danh mục SKU. Khi có file danh mục đối thủ riêng, nhập qua Danh mục SKU → Nhập.', 'The competitor catalog is the master data itself (nothing invented). Edit competitor prices and sizes in the SKU catalog; import a dedicated competitor file through SKU catalog → Import.')}</div>
      <div className="two-col">
        <section><div className="section-head"><h2>{L('Nhà sản xuất', 'Manufacturers')}</h2></div>
          <div className="table-wrap" style={{ maxHeight: 560 }}><table className="t"><thead><tr><th>{L('Nhà SX', 'Maker')}</th><th className="num">SKU</th><th className="num">Brand</th><th>{L('Ngành', 'Categories')}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.maker} className={'clickable' + (r.maker === maker ? ' selected' : '')} onClick={() => setMaker(r.maker)}><td>{r.maker} {r.own && <Pill tone="info">{L('của mình', 'own')}</Pill>}{r.maker === comp && <Pill tone="negative">{L('đối thủ chính', 'main competitor')}</Pill>}</td><td className="num">{r.skus}</td><td className="num">{r.brands.size}</td><td className="small muted">{[...r.cats].slice(0, 4).join(', ')}</td></tr>)}</tbody></table></div></section>
        <section><div className="section-head"><h2>{maker}</h2><span className="lead">{skus.length} SKU</span></div>
          <div className="table-wrap" style={{ maxHeight: 560 }}><table className="t"><thead><tr><th>SKU</th><th>Brand</th><th className="num">cm</th></tr></thead>
            <tbody>{skus.map((k) => <tr key={k.id}><td><div className="cell-sku"><SkuThumb k={k} /><span className="name">{k.name}<span className="sub">{formLabel(k.form)} · {k.cat}</span></span></div></td><td>{k.brand}</td><td className="num">{k.est && <Pill tone="warning">≈</Pill>} {R1(k.w)}×{R1(k.d)}×{R1(k.h)}</td></tr>)}</tbody></table></div></section>
      </div>
    </div>
  </AppFrame>;
}

export function Presets({ path }: { path: string }) {
  usePrefs((s) => s.lang);
  return <AppFrame path={path} title={L('Mẫu kệ & display', 'Fixtures & displays')}>
    <div className="page">
      <div className="page-head"><div><h1>{L('Mẫu kệ & display', 'Fixtures & displays')}</h1><p className="lead">{L('Kích thước mẫu là giả định từ bản cũ – chưa có chuẩn chính thức theo chuỗi.', 'Preset sizes come from the previous app as assumptions – no official retailer standard loaded yet.')}</p></div></div>
      <section><div className="section-head"><h2>{L('Pallet / ụ đảo', 'Pallets / islands')}</h2></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>{L('Mẫu', 'Preset')}</th><th>{L('Chuỗi', 'Retailer')}</th><th className="num">{L('Rộng', 'W')}</th><th className="num">{L('Sâu', 'D')}</th><th className="num">{L('Cao', 'H')}</th><th className="num">{L('Cao tối đa', 'Max height')}</th></tr></thead>
          <tbody>{Object.values(PALLET_PRESETS).map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.retailer}</td><td className="num">{p.w}</td><td className="num">{p.d}</td><td className="num">{p.h}</td><td className="num">{p.maxH}</td></tr>)}</tbody></table></div></section>
      <section className="section"><div className="section-head"><h2>Gondola</h2></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>{L('Mẫu', 'Preset')}</th><th className="num">{L('Rộng bay', 'Bay W')}</th><th className="num">{L('Cao', 'H')}</th><th className="num">{L('Sâu kệ', 'Shelf D')}</th><th className="num">{L('Sâu đế', 'Base D')}</th><th className="num">{L('Chân đế', 'Kick')}</th><th className="num">{L('Số tầng', 'Shelves')}</th><th className="num">{L('Bước lỗ', 'Pitch')}</th></tr></thead>
          <tbody>{Object.values(GONDOLA_PRESETS).map((p) => <tr key={p.id}><td>{p.name}</td><td className="num">{p.w}</td><td className="num">{p.h}</td><td className="num">{p.d}</td><td className="num">{p.baseD}</td><td className="num">{p.kick}</td><td className="num">{p.n}</td><td className="num">{p.pitch}</td></tr>)}</tbody></table></div></section>
      <section className="section"><div className="section-head"><h2>{L('Loại trưng bày (phiếu dựng)', 'Display types (build sheets)')}</h2></div>
        <div className="table-wrap"><table className="t"><thead><tr><th>{L('Loại', 'Type')}</th><th>{L('Nền', 'Base')}</th><th>{L('Mẫu POSM', 'POSM template')}</th></tr></thead>
          <tbody>{DISPLAY_TYPES.map((t) => <tr key={t.id}><td>{L(t.label, t.en)}</td><td>{t.base}</td><td>{t.posm.length ? t.posm.map((p) => p.type).join(', ') : <span className="dash">—</span>} {!t.templateConfirmed && <Pill tone="warning">{L('chưa có mẫu', 'no template yet')}</Pill>}</td></tr>)}</tbody></table></div></section>
    </div>
  </AppFrame>;
}
