// Import / export workflows (UI-independent): project JSON, Spaceman .plnx in/out, POG PDF, batch PDF → .plnx zip,
// catalog CSV/XLSX, BOM CSV, file download, image to clipboard.
import { computeBOM } from '../domain/bom';
import { formLabel, L } from '../domain/i18n';
import { Scene } from '../domain/scene';
import { plnxPreflight } from '../domain/shelf/layout';
import { rowsToItems } from '../domain/catalog/catalog';
import type { Design, Sku, Warning } from '../domain/types';
import { deep, poolKey, R1, slug } from '../domain/util';
import { parseCSV, toCSV } from '../infra/csv';
import { readXLSX } from '../infra/xlsx';
import { buildFromPlnx, mergePlnxCatalog, readPlnx } from '../infra/plnx/read';
import { plnxBlob } from '../infra/plnx/write';
import { buildFromPOG, pogDefaults, type Pog, type PogOptions, type PogReport } from '../infra/pdf/pogParser';
import { openProjectText, projectJSON } from '../infra/projectFile';
import { zipFiles } from '../infra/zip';
import { catalog, useCatalog } from './catalogStore';

export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function copyImageToClipboard(dataUrlOrBlob: string | Blob) {
  const blob = typeof dataUrlOrBlob === 'string' ? await (await fetch(dataUrlOrBlob)).blob() : dataUrlOrBlob;
  if (!navigator.clipboard || typeof ClipboardItem === 'undefined') throw Error(L('Trình duyệt không cho chép ảnh – dùng Tải PNG', 'This browser cannot copy images – use Download PNG'));
  await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
}

export const catalogHooks = () => ({ byId: (id: string) => catalog.byId(id), applyPool: (k: Sku) => { catalog.applyPool(k, false); } });
export const pogHooks = () => ({
  findByCode: (key: string) => catalog.byCode(key),
  addToCatalog: (k: Sku) => catalog.addMany([k]),
  brandIdx: catalog.brandIndex(),
  applyPool: (k: Sku) => { catalog.applyPool(k, false); },
});

// ---------- project files ----------
export const saveProjectFile = (d: Design) => download(`${slug(d.meta.name)}-nexus-pog.json`, projectJSON(d, useCatalog.getState().assets), 'application/json');
export async function readProjectFile(file: File) {
  const r = await openProjectText(await file.text(), (src) => catalog.putAsset(src));
  if (r.kind !== 'v6library') for (const [, src] of Object.entries(r.assets)) await catalog.putAsset(src);
  return r;
}

// ---------- Spaceman ----------
export async function importPlnxFile(file: File) {
  const r = await readPlnx(file);
  const mc = catalog.mutate((cat) => mergePlnxCatalog(cat, r.products, r.scale, catalogHooks()));
  const built = r.pogs.map((p) => buildFromPlnx(p, r.products, r.scale, file.name, catalogHooks()));
  catalog.addMany(built.flatMap((b) => b.rep.newSkus));
  return { built, merged: mc };
}
export async function exportPlnx(d: Design) {
  const name = (d.meta.name || 'Planogram').trim();
  const r = await plnxBlob(new Scene(d), name);
  if (!r) throw Error(L('.plnx chỉ dùng cho planogram kệ – thiết kế này chưa có kệ', '.plnx is for shelf planograms – this design has no shelves'));
  download(r.file, r.blob, 'application/zip');
  return r.stats;
}
export const preflight = (d: Design): Warning[] => plnxPreflight(new Scene(d));

// ---------- POG PDF ----------
export async function readPdf(file: File, onProg?: (i: number, n: number) => void) {
  const { readPOGFile } = await import('../infra/pdf/pdfjs');
  return readPOGFile(file, onProg);
}
export async function measureAndApplyDrawing(pogs: Pog[], onProg?: (s: string) => void) {
  const { pogDrawingSizes } = await import('../infra/pdf/pdfjs');
  const res = await pogDrawingSizes(pogs as never, onProg);
  return applyDrawingSizes(res);
}
/** Measured sizes go to estimated (≈) catalog items; pictures to the image pool when the code has none yet. */
export async function applyDrawingSizes(res: Map<string, { code: string; name: string; w: number; h: number; img?: string }>) {
  let dims = 0, pics = 0;
  if (!res.size) return { dims, pics };
  const { skuFromMaster, fillBrand } = await import('../domain/catalog/sku');
  for (const [key, e] of res) {
    let k = catalog.byCode(key);
    if (!k && e.name) { k = skuFromMaster({ code: e.code, name: e.name, brand: '', maker: '', pack: '', ml: '' }); k.src = 'POG'; fillBrand(catalog.brandIndex(), k); catalog.addMany([k]); k = catalog.byCode(key); }
    if (k && k.est) { const kk = k; catalog.mutate((cat) => { const c = cat.find((x) => x.id === kk.id)!; const ow = +c.w || e.w; c.w = e.w; c.h = e.h; c.d = c.form === 'unit' ? e.w : Math.max(1, Math.round((+c.d || e.w) * (e.w / ow) * 10) / 10); delete c.est; c.dsrc = 'PDF'; }); dims++; }
    const pool = useCatalog.getState().imgPool[poolKey(e.code)];
    if (e.img && !(pool && pool.front)) { const id = await catalog.putAsset(e.img); await catalog.setPoolImage(e.code, 'front', id); pics++; }
  }
  if (pics) catalog.mutate((cat) => { for (const k of cat) catalog.applyPool(k, false); });
  return { dims, pics };
}
export function buildPog(p: Pog, o?: PogOptions): { design: Design; rep: PogReport } { return buildFromPOG(p, o || pogDefaults(p), pogHooks()); }

/** Batch: many POG PDFs → designs → .plnx each (+ preflight) → one zip. */
export async function batchPdf(files: File[], opts: { measure: boolean }, onProgress: (i: number, name: string) => void) {
  const results: ({ file: string; name: string; design: Design; stats: { bays: number; positions: number; facings: number; skus: number; est: number }; pf: Warning[]; plnx: { file: string; blob: Blob } } | { file: string; err: string })[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    onProgress(i, f.name);
    try {
      const pogs = await readPdf(f);
      const p = pogs[0];
      if (opts.measure) await measureAndApplyDrawing([p] as never);
      const b = buildPog(p);
      const r = await plnxBlob(new Scene(b.design), b.design.meta.name);
      results.push({ file: f.name, name: b.design.meta.name, design: b.design, stats: r!.stats, pf: plnxPreflight(new Scene(b.design)), plnx: { file: r!.file, blob: r!.blob } });
    } catch (e) { results.push({ file: f.name, err: (e as Error).message || String(e) }); }
  }
  return results;
}
export async function zipPlnx(list: { file: string; blob: Blob }[]) {
  const seen = new Set<string>(), files: { name: string; data: Uint8Array }[] = [];
  for (const r of list) { let n = r.file, j = 2; while (seen.has(n)) n = r.file.replace(/\.plnx$/, ` (${j++}).plnx`); seen.add(n); files.push({ name: n, data: new Uint8Array(await r.blob.arrayBuffer()) }); }
  return zipFiles(files);
}

// ---------- catalog / tables ----------
export async function readTable(file: File) { return /\.xlsx$/i.test(file.name) ? readXLSX(file) : parseCSV(await file.text()); }
export async function importCatalogFile(file: File) {
  const r = rowsToItems(await readTable(file));
  if (r.err) throw Error(r.err);
  return { ...catalog.importItems(r.items), skipped: r.skipped, total: r.items.length };
}

export function bomCsv(d: Design) {
  const b = computeBOM(new Scene(d)), s = new Scene(d), sb = s.sceneBox(true), rows: unknown[][] = [];
  rows.push(['Display', d.meta.name]);
  if (sb) rows.push([L('Kích thước (cm)', 'Size (cm)'), `${R1(sb.x1 - sb.x0)} x ${R1(sb.z1 - sb.z0)} x ${R1(sb.y1)}`]);
  rows.push([]);
  rows.push([L('Mã', 'Code'), L('Tên', 'Name'), L('Quy cách', 'Pack form'), L('Số lượng', 'Count'), L('Đơn vị/quy cách', 'Units per pack'), L('Quy đổi đơn vị', 'Converted units'), L('Nhóm quy đổi', 'Conversion family')]);
  for (const r of b.rows) rows.push([r.k.code, r.k.name, formLabel(r.k.form), r.n, r.units || '', r.conv ?? '', r.k.family || '']);
  rows.push([]);
  rows.push([formLabel('carton'), b.tot.carton], [formLabel('pack'), b.tot.pack], [formLabel('unit'), b.tot.unit], [L('Quy đổi đơn vị', 'Converted units'), b.tot.conv]);
  for (const f of b.families) rows.push([L('Quy đổi theo nhóm: ', 'Family: ') + f.key, f.parts.map((p) => p.n + ' ' + formLabel(p.k.form)).join(' + '), f.unknown ? '?' : f.conv]);
  rows.push([]);
  for (const [n, c] of b.posm) rows.push(['POSM', n, c]);
  for (const [n, c] of b.props) rows.push([L('Vật trang trí', 'Decorative props'), n, c]);
  rows.push([L('Pallet', 'Pallets'), b.pallets]);
  download(`${slug(d.meta.name)}-BOM.csv`, toCSV(rows), 'text/csv;charset=utf-8');
}

export const cloneDesign = (d: Design) => deep(d);
