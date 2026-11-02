// Catalog rules: embedded master merge (legacy init), catalog file import (legacy rowsToItems / importCatalogFile),
// Spaceman merge (legacy mergePlnxCatalog), product identity (PIDs), competitor view.
import type { Sku } from '../types';
import { norm, poolKey, toNum } from '../util';
import { fixForm, skuFromMaster, unPlaceholder, type MasterRow } from './sku';

export interface MasterFile { ver: string; k: string[]; r: unknown[][] }
export const masterRows = (M: MasterFile): MasterRow[] => M.r.map((r) => Object.fromEntries(M.k.map((k, i) => [k, r[i]])) as unknown as MasterRow);

/** Merge a (newer) embedded master into a saved catalog: new codes added; blank maker/brand/cat/sub filled; user edits kept. */
export function mergeMaster(catalog: Sku[], rows: MasterRow[]) {
  const by = new Map(catalog.map((k) => [k.id, k]));
  let added = 0, filled = 0;
  for (const m of rows) {
    const k = skuFromMaster(m), o = by.get(k.id);
    if (!o) { catalog.push(k); by.set(k.id, k); added++; continue; }
    let f = false;
    if (!o.maker && k.maker) { o.maker = k.maker; f = true; }
    if (!o.brand && k.brand) { o.brand = k.brand; f = true; }
    if (!o.cat && k.cat) { o.cat = k.cat; f = true; }
    if (!o.sub && k.sub) { o.sub = k.sub; f = true; }
    if (f) filled++;
  }
  return { added, filled };
}

/** Start-up repairs kept from legacy (fixForm, unPlaceholder). */
export function repairCatalog(catalog: Sku[]) { let n = 0; for (const k of catalog) { if (fixForm(k)) n++; if (unPlaceholder(k)) n++; } return n; }

// ---- catalog file import (CSV / XLSX rows) ----
export const COLS: Record<string, string[]> = {
  code: ['masku', 'skucode', 'upc', 'gtin', 'productid', 'mahang', 'masp', 'barcode', 'ean', 'itemcode', 'sku', 'code', 'ma'],
  name: ['tensanpham', 'tensp', 'tenhang', 'productname', 'name', 'ten', 'mota', 'description'],
  w: ['chieudai', 'daicm', 'width', 'widthcm', 'length', 'lengthcm', 'dai', 'w', 'l'],
  d: ['chieurong', 'rongcm', 'depth', 'depthcm', 'rong', 'd'],
  h: ['chieucao', 'caocm', 'height', 'heightcm', 'cao', 'h'],
  kg: ['kgthung', 'trongluong', 'khoiluong', 'weightkg', 'grossweight', 'weight', 'kg'],
  units: ['donvithung', 'unitspercase', 'unitscase', 'casepack', 'packsize', 'quycach', 'units', 'donvi'],
  pack: ['loaidonggoi', 'donggoi', 'packtype', 'packaging', 'descl'],
  ml: ['dungtich', 'volume', 'desck'],
  pkg: ['desci', 'bottletype'],
  brand: ['brand', 'thuonghieu', 'nhanhang'],
  family: ['nhomquydoi', 'family'],
  maker: ['manufacturer', 'nhasanxuat'],
  cat: ['category', 'nganhhang'],
  // new in schema 8: prices
  priceNormal: ['gianiemyet', 'giaban', 'pricenormal', 'listprice', 'normalprice', 'giathuong'],
  pricePromo: ['giakhuyenmai', 'giakm', 'pricepromo', 'promoprice'],
};

export function mapHeader(row: unknown[]) {
  const m: Record<string, number> = {};
  row.forEach((c, i) => {
    const n = norm(c).replace(/[^a-z0-9]/g, '');
    if (!n) return;
    for (const [f, al] of Object.entries(COLS)) { if (m[f] != null) continue; if (al.some((a) => (a.length >= 4 ? n.startsWith(a) : n === a))) { m[f] = i; break; } }
  });
  return m;
}

export function rowsToItems(rows: unknown[][]): { items: Sku[]; skipped: number; err?: string } {
  let hi = -1, map: Record<string, number> | null = null;
  for (let i = 0; i < Math.min(8, rows.length); i++) { const m = mapHeader(rows[i]); if (m.w != null && m.d != null && m.h != null && (m.code != null || m.name != null)) { hi = i; map = m; break; } }
  if (!map) return { items: [], skipped: 0, err: 'Không tìm thấy dòng tiêu đề (cần Mã/Tên + Rộng/Sâu/Cao) · No header row found (need code/name + width/depth/height)' };
  const items: Sku[] = [];
  let skipped = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i], g = (f: string) => (map![f] != null ? String(r[map![f]] ?? '').trim() : '');
    const code = g('code').replace(/\s+/g, ''), name = g('name');
    if (!code && !name) continue;
    const w = toNum(g('w')), d = toNum(g('d')), h = toNum(g('h'));
    if (!(w > 0 && d > 0 && h > 0)) { skipped++; continue; }
    const it = skuFromMaster({ code: code || name, name: name || code, brand: g('brand'), w, d, h, pack: g('pack'), ml: g('ml'), pkg: g('pkg'), cat: g('cat'), kg: toNum(g('kg')), family: g('family'), maker: g('maker') });
    const u = Math.round(toNum(g('units')));
    if (u > 0 && it.form !== 'unit') it.units = u;
    const pn = toNum(g('priceNormal')), pp = toNum(g('pricePromo'));
    if (pn > 0) it.priceNormal = Math.round(pn);
    if (pp > 0) it.pricePromo = Math.round(pp);
    items.push(it);
  }
  return { items, skipped };
}

/** Legacy importCatalogFile merge: existing → fields replaced, faces/colour kept, family kept when blank. */
export function mergeImported(catalog: Sku[], items: Sku[]) {
  let nNew = 0, nUpd = 0;
  for (const it of items) {
    const i = catalog.findIndex((c) => c.id === it.id);
    if (i >= 0) {
      const old = catalog[i];
      catalog[i] = { ...old, ...it, faces: old.faces || {}, color: old.color || it.color, family: it.family || old.family, pid: old.pid, identifiers: old.identifiers,
        priceNormal: it.priceNormal ?? old.priceNormal, pricePromo: it.pricePromo ?? old.pricePromo };
      nUpd++;
    } else { catalog.push(it); nNew++; }
  }
  return { nNew, nUpd };
}

// ---- product identity (PID) — replaces the separate legacy productMaster store ----
export const fmtPid = (n: number) => 'NXP-' + String(n).padStart(6, '0');
export const isPid = (p: unknown) => typeof p === 'string' && /^NXP-\d{6}$/.test(p);

/** Give every SKU without a PID the next PID, in catalog order. Returns the new counter. Idempotent. */
export function backfillPids(catalog: Sku[], counter: number) {
  let n = counter;
  for (const k of catalog) if (!isPid(k.pid)) k.pid = fmtPid(++n);
  return n;
}

/** Primary identifier of a numeric code (legacy backfill rule: 8–14 digits). */
export function codeIdentifier(code: string) {
  const c = String(code || '').trim().replace(/\s/g, '');
  if (!/^\d{8,14}$/.test(c)) return null;
  const type = c.length === 12 ? 'UPC12' : c.length === 13 ? 'EAN13' : c.length === 8 ? 'EAN8' : 'OTHER';
  return { type, value: c } as const;
}

/** Codes shared by more than one SKU (identifiers + primary codes), for review — never auto-merged. */
export function duplicateCodes(catalog: Sku[]) {
  const by = new Map<string, Sku[]>();
  for (const k of catalog) {
    const vals = new Set<string>([poolKey(k.code), ...(k.identifiers || []).map((i) => poolKey(i.value))]);
    for (const v of vals) { if (!v) continue; const a = by.get(v) || []; a.push(k); by.set(v, a); }
  }
  return [...by].filter(([, ks]) => ks.length > 1).map(([value, ks]) => ({ value, skus: ks }));
}

// ---- competitor view (data from the master's maker field; nothing invented) ----
export const isOwn = (k: Sku, own: string) => norm(k.maker).includes(norm(own));
export function makerSummary(catalog: Sku[], own: string) {
  const m = new Map<string, { maker: string; skus: number; brands: Set<string>; cats: Set<string>; own: boolean }>();
  for (const k of catalog) {
    const key = String(k.maker || '').trim() || '—';
    const e = m.get(key) || { maker: key, skus: 0, brands: new Set(), cats: new Set(), own: isOwn(k, own) };
    e.skus++; if (k.brand) e.brands.add(k.brand); if (k.cat) e.cats.add(k.cat);
    m.set(key, e);
  }
  return [...m.values()].sort((a, b) => b.skus - a.skus);
}
