// SKU catalog: the SPVB master merged with user edits — search, filter, edit, prices, images, import, PIDs.
// Question it answers first: "Is the SKU data good enough to plan with?" (sizes measured, prices set, pictures loaded)
import { useMemo, useRef, useState } from 'react';
import { duplicateCodes } from '../../domain/catalog/catalog';
import { formatVnd } from '../../domain/catalog/pricing';
import { fmt, formLabel, L } from '../../domain/i18n';
import type { Sku } from '../../domain/types';
import { R1 } from '../../domain/util';
import { catalog, useCatalog } from '../../app/catalogStore';
import { download, importCatalogFile } from '../../app/io';
import { usePrefs } from '../../app/prefs';
import { toast } from '../../app/workspace';
import { toCSV } from '../../infra/csv';
import { AppFrame } from '../shell/AppFrame';
import { Button, Dialog, FileButton, Icon, Menu, Pill, Select, SkuThumb } from '../ds';
import { SkuDrawer } from './catalog/SkuDrawer';

type Status = 'all' | 'est' | 'noprice' | 'noimg' | 'own' | 'comp';
const ROW = 52;

export function Catalog({ path }: { path: string }) {
  const cat = useCatalog((s) => s.catalog), ready = useCatalog((s) => s.ready), info = useCatalog((s) => s.masterInfo), own = usePrefs((s) => s.ownMaker);
  usePrefs((s) => s.lang); useCatalog((s) => s.assets);
  const [q, setQ] = useState(''), [maker, setMaker] = useState(''), [catF, setCatF] = useState(''), [form, setForm] = useState(''), [status, setStatus] = useState<Status>('all'), [edit, setEdit] = useState<string | null | 'new'>(null), [dupes, setDupes] = useState(false), [scroll, setScroll] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const makers = useMemo(() => [...new Set(cat.map((k) => k.maker).filter(Boolean))].sort(), [cat]), cats = useMemo(() => [...new Set(cat.map((k) => k.cat).filter(Boolean))].sort(), [cat]);
  const isOwn = (k: Sku) => (k.maker || '').toUpperCase().includes(own.toUpperCase());
  const list = useMemo(() => catalog.search(q, cat).filter((k) => (!maker || k.maker === maker) && (!catF || k.cat === catF) && (!form || k.form === form) && (status === 'all' || (status === 'est' && k.est) || (status === 'noprice' && k.priceNormal == null) || (status === 'noimg' && !k.faces?.front) || (status === 'own' && isOwn(k)) || (status === 'comp' && !isOwn(k) && k.maker && k.maker !== 'OTHER'))), [cat, q, maker, catF, form, status, own]);
  const stats = useMemo(() => ({ est: cat.filter((k) => k.est).length, priced: cat.filter((k) => k.priceNormal != null).length, img: cat.filter((k) => k.faces?.front).length, own: cat.filter(isOwn).length }), [cat, own]);
  const viewH = 640, first = Math.max(0, Math.floor(scroll / ROW) - 5), last = Math.min(list.length, first + Math.ceil(viewH / ROW) + 12);
  const doImport = async (f: File[]) => { try { const r = await importCatalogFile(f[0]); toast(L(`Đã nhập ${r.total} SKU (${r.nNew} mới, ${r.nUpd} cập nhật${r.skipped ? `, ${r.skipped} dòng thiếu kích thước bỏ qua` : ''})`, `Imported ${r.total} SKUs (${r.nNew} new, ${r.nUpd} updated${r.skipped ? `, ${r.skipped} rows without sizes skipped` : ''})`)); } catch (e) { toast((e as Error).message, 'danger'); } };
  const doImages = async (f: File[]) => { toast(L(`Đang nạp ${f.length} file ảnh…`, `Loading ${f.length} image files…`)); const r = await catalog.loadImagePool(f); toast(L(`${r.img} ảnh cho ${r.codes.size} mã · ${r.catalogUpdated} SKU cập nhật · ${r.badType.size + r.badName.length} file bỏ qua`, `${r.img} images for ${r.codes.size} codes · ${r.catalogUpdated} SKUs updated · ${r.badType.size + r.badName.length} files skipped`), r.badType.size ? 'warn' : 'info'); };
  const exportCsv = () => download(`catalog_${new Date().toISOString().slice(0, 10)}.csv`, toCSV([['PID', 'Code', 'Name', 'Brand', 'Manufacturer', 'Category', 'Subcategory', 'Pack form', 'Units', 'Width', 'Depth', 'Height', 'Estimated', 'Normal price', 'Promo price'], ...list.map((k) => [k.pid, k.code, k.name, k.brand, k.maker, k.cat, k.sub, k.form, k.units, k.w, k.d, k.h, k.est ? 'yes' : '', k.priceNormal ?? '', k.pricePromo ?? ''])]), 'text/csv');
  const chip = (s: Status, label: string, n?: number) => <button className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>{label}{n != null ? ` ${n.toLocaleString('vi-VN')}` : ''}</button>;
  return <AppFrame path={path} title={L('Danh mục SKU', 'SKU catalog')}>
    <div className="page">
      <div className="page-head">
        <div><h1>{L('Danh mục SKU', 'SKU catalog')}</h1><p className="lead">{ready ? L(`${cat.length.toLocaleString('vi-VN')} SKU · master ${info.ver} · ${stats.est.toLocaleString('vi-VN')} mã kích thước ước tính (≈) · ${stats.priced} mã có giá`, `${cat.length.toLocaleString('en-US')} SKUs · master ${info.ver} · ${stats.est.toLocaleString('en-US')} with estimated sizes (≈) · ${stats.priced} priced`) : '…'}</p></div>
        <div className="actions">
          <Menu label={L('Nhập', 'Import')} icon="upload" items={[
            { label: L('Danh mục CSV / XLSX (mã, tên, kích thước, giá…)', 'Catalog CSV / XLSX (code, name, sizes, prices…)'), icon: 'catalog', onClick: () => pick('.csv,.txt,.xlsx', false, doImport) },
            { label: L('Ảnh sản phẩm (file / ZIP)', 'Product images (files / ZIP)'), icon: 'image', onClick: () => pick('.zip,image/*,.1,.2,.3,.7,.8', true, doImages) },
            { label: L('Thư mục ảnh', 'Image folder'), icon: 'image', onClick: () => pick('', true, doImages, true) },
          ]} />
          <Button icon="download" onClick={exportCsv}>CSV</Button>
          <Button variant="primary" icon="plus" onClick={() => setEdit('new')}>{L('SKU mới', 'New SKU')}</Button>
        </div>
      </div>
      <div className="controls-row">
        <div className="input-wrap" style={{ width: 320 }}><Icon.search className="lead-icon" /><input className="input" type="search" placeholder={L('Tìm tên, mã, brand, PID…', 'Search name, code, brand, PID…')} value={q} onChange={(e) => { setQ(e.target.value); wrap.current?.scrollTo(0, 0); }} aria-label={L('Tìm SKU', 'Search SKUs')} /></div>
        <Select value={maker} options={[['', L('Mọi nhà SX', 'All makers')], ...makers.map((m) => [m, m] as [string, string])]} onChange={setMaker} aria-label={L('Nhà SX', 'Maker')} />
        <Select value={catF} options={[['', L('Mọi ngành', 'All categories')], ...cats.map((m) => [m, m] as [string, string])]} onChange={setCatF} aria-label={L('Ngành hàng', 'Category')} />
        <Select value={form} options={[['', L('Mọi quy cách', 'All pack forms')], ['carton', formLabel('carton')], ['pack', formLabel('pack')], ['unit', formLabel('unit')]]} onChange={setForm} aria-label={L('Quy cách', 'Pack form')} />
        <div className="chips">{chip('all', L('Tất cả', 'All'))}{chip('est', L('Cần đo ≈', 'Needs measuring ≈'), stats.est)}{chip('noprice', L('Chưa có giá', 'No price'), cat.length - stats.priced)}{chip('noimg', L('Chưa có ảnh', 'No image'), cat.length - stats.img)}{chip('own', own, stats.own)}{chip('comp', L('Đối thủ', 'Competitors'))}</div>
        <Button variant="ghost" size="sm" onClick={() => setDupes(true)}>{L('Mã trùng', 'Duplicate codes')}</Button>
      </div>
      <p className="small muted" style={{ marginBottom: 8 }}>{list.length.toLocaleString('vi-VN')} {L('kết quả', 'results')}</p>
      <div className="table-wrap" ref={wrap} style={{ height: viewH, overflow: 'auto' }} onScroll={(e) => setScroll((e.target as HTMLDivElement).scrollTop)}>
        <table className="t" style={{ tableLayout: 'fixed' }}>
          <colgroup><col style={{ width: '34%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '9%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '11%' }} /></colgroup>
          <thead><tr><th>SKU</th><th>Brand</th><th>{L('Nhà SX', 'Maker')}</th><th>{L('Quy cách', 'Pack')}</th><th className="num">{L('Kích thước (cm)', 'Size (cm)')}</th><th className="num">{L('Niêm yết', 'Normal')}</th><th className="num">{L('Khuyến mãi', 'Promo')}</th></tr></thead>
          <tbody>
            {first > 0 && <tr style={{ height: first * ROW }}><td colSpan={7} style={{ padding: 0, border: 0 }} /></tr>}
            {list.slice(first, last).map((k) => <tr key={k.id} className="clickable" style={{ height: ROW }} onClick={() => setEdit(k.id)}>
              <td><div className="cell-sku"><SkuThumb k={k} /><span className="name" title={k.name}>{k.name}<span className="sub mono">{k.code}{k.pid ? ' · ' + k.pid : ''}</span></span></div></td>
              <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.brand || <span className="dash">—</span>}</td>
              <td style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.maker || <span className="dash">—</span>}</td>
              <td>{formLabel(k.form)}{k.form !== 'unit' && <span className="muted"> × {k.units || '?'}</span>}</td>
              <td className="num">{k.est && <Pill tone="warning">≈</Pill>} {R1(k.w)}×{R1(k.d)}×{R1(k.h)}</td>
              <td className="num">{k.priceNormal != null ? formatVnd(k.priceNormal) : <span className="dash">—</span>}</td>
              <td className="num">{k.pricePromo != null ? formatVnd(k.pricePromo) : <span className="dash">—</span>}</td></tr>)}
            {last < list.length && <tr style={{ height: (list.length - last) * ROW }}><td colSpan={7} style={{ padding: 0, border: 0 }} /></tr>}
            {!list.length && <tr><td colSpan={7} className="muted">{L('Không có SKU khớp bộ lọc.', 'No SKU matches the filters.')}</td></tr>}
          </tbody></table></div>
      <p className="small muted" style={{ marginTop: 12, maxWidth: 820 }}>{L('Ảnh: tên file đúng bằng mã SKU (bỏ số 0 đầu) + .1 trước · .2 trái · .3 trên · .7 sau · .8 phải, hoặc MÃ_1.jpg / MÃ.jpg. Danh mục master nhúng sẵn được gộp khi có phiên bản mới: mã mới được thêm, chỉnh sửa của bạn được giữ.', 'Images: file named exactly as the SKU code (leading zeros ignored) + .1 front · .2 left · .3 top · .7 back · .8 right, or CODE_1.jpg / CODE.jpg. The embedded master merges on new versions: new codes are added, your edits are kept.')}</p>
    </div>
    {edit && <SkuDrawer id={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    {dupes && <Dialog wide title={L('Mã trùng giữa các SKU', 'Codes shared by several SKUs')} onClose={() => setDupes(false)}>
      <p className="muted">{L('Không tự gộp: kiểm tra từng nhóm rồi sửa mã ở SKU sai.', 'Never merged automatically: review each group and fix the wrong SKU’s code.')}</p>
      {(() => { const d = duplicateCodes(cat); return d.length ? <div className="table-wrap" style={{ maxHeight: 420 }}><table className="t"><thead><tr><th>{L('Mã', 'Code')}</th><th>SKU</th></tr></thead><tbody>{d.slice(0, 200).map((g) => <tr key={g.value}><td className="mono">{g.value}</td><td>{g.skus.map((k) => <div key={k.id}><a href="#" onClick={(e) => { e.preventDefault(); setDupes(false); setEdit(k.id); }}>{k.name}</a> <span className="muted small mono">{k.id}</span></div>)}</td></tr>)}</tbody></table></div> : <p>{L('Không có mã trùng.', 'No duplicate codes.')}</p>; })()}
    </Dialog>}
  </AppFrame>;
  function pick(accept: string, multiple: boolean, fn: (f: File[]) => void, dir = false) {
    const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple;
    if (dir) (i as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
    i.onchange = () => { const fs = [...(i.files || [])]; if (fs.length) fn(fs); }; i.click();
  }
}
export const _fb = FileButton; export const _fmt = fmt;
