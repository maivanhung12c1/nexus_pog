// SKU construction from master rows (legacy formFromPack / unitsFrom / mlOf / estUnit / estDims / skuFromMaster /
// fixForm / unPlaceholder / brand inference). Arithmetic and regexes unchanged.
import { colorFor } from '../colors';
import type { PackForm, Sku } from '../types';
import { norm, R1 } from '../util';

export interface MasterRow {
  code: string; name: string; brand?: string; maker?: string;
  w?: number | string; d?: number | string; h?: number | string;
  cat?: string; pkg?: string; ml?: string | number; pack?: string; sub?: string; kg?: number; family?: string; est?: boolean;
}

export function formFromPack(pack: unknown, name: unknown, w: number, d: number): PackForm {
  const p = String(pack || '').toUpperCase(), nn = ' ' + norm(name).toUpperCase() + ' ';
  // the name wins when it clearly says carton / multipack (master files often keep SINGLE by mistake)
  if (/\bTH(UNG)?\.?\s*\d|\bCARTON\b|\bTHUNG\b|\bT\d{2}\b/.test(nn)) return 'carton';
  if (/\d\s*PACK\b|\bPACK\s*\d|\b(LOC|LO)\s*\d|\bLOC\b|\bMULTIPACK\b|\bX\s*[46]\s*(LON|CHAI)?\s*$/.test(nn)) return 'pack';
  if (/CARTON|THUNG/.test(p)) return 'carton';
  if (/PACK|LOC|TRAY|KHAY/.test(p)) return 'pack';
  if (/SINGLE|LE\b/.test(p)) return 'unit';
  const n = ' ' + norm(name).toUpperCase() + ' ';
  if (/\bTH(UNG)?\.?\s*\d|\bCARTON\b|\bTHUNG\b/.test(n)) return 'carton';
  if (/\bLOC\b|\bL\.?\s*\d\b/.test(n)) return 'pack';
  return w * d < 150 ? 'unit' : 'carton';
}

export function unitsFrom(pack: unknown, name: unknown): number {
  const p = String(pack || '').toUpperCase(), m = p.match(/(\d{1,2})\s*PACK/) || (' ' + norm(name).toUpperCase()).match(/(\d{1,2})\s*PACK\b|PACK\s*(\d{1,2})\b/);
  if (m) return +(m[1] || m[2]);
  if (/SINGLE/.test(p)) return 1;
  const n = ' ' + norm(name).toUpperCase() + ' ';
  for (const re of [/\bTH(?:UNG)?\.?\s*(\d{1,2})(?!\d)/, /\b(?:LOC|L)\s*\.?\s*(\d{1,2})\b/, /(?:ML|L)\s*[*X]\s*(\d{1,2})\b/, /\b(\d{1,2})\s*X\s*\d+(?:[.,]\d+)?\s*(?:ML|L)\b/, /[*X]\s*(\d{1,2})\s*$/, /\bX\s*(\d{1,2})\s*(?:LON|CHAI)\b/, /\b(\d{1,2})\s*(?:LON|CHAI)\b/]) {
    const r = n.match(re);
    if (r && +r[1] >= 2 && +r[1] <= 48) return +r[1];
  }
  return 0;
}

export function mlOf(m: { ml?: unknown; name?: unknown }) {
  const v = parseFloat(String(m.ml || '').replace(',', '.'));
  if (v > 0) return v;
  const n = norm(m.name).toUpperCase(), a = n.match(/(\d+(?:[.,]\d+)?)\s*ML/), b = n.match(/(\d+(?:[.,]\d+)?)\s*L\b/);
  if (a) return parseFloat(a[1].replace(',', '.'));
  if (b) return parseFloat(b[1].replace(',', '.')) * 1000;
  return 0;
}

/** Unit size estimate (cm) from volume + package when the master has no dimensions – always flagged est:true. */
export function estUnit(m: { ml?: unknown; name?: unknown; pkg?: unknown }) {
  const ml = mlOf(m), n = norm(m.name).toUpperCase(), can = /CAN/i.test(String(m.pkg || '')) || /\bLON\b|SLEEK/.test(n);
  if (can) {
    if (ml && ml <= 200) return { d: 5.3, h: 10.5 };
    if (ml && ml <= 250) return { d: 5.5, h: 11.5 };
    if (ml && ml <= 330) return /SLEEK|320/.test(n) ? { d: 5.9, h: 14.6 } : { d: 6.6, h: 12.2 };
    return { d: 6.6, h: 16.8 };
  }
  if (!ml) return { d: 6.5, h: 20 };
  if (ml <= 300) return { d: 5.8, h: 17 };
  if (ml <= 400) return { d: 6.3, h: 20 };
  if (ml <= 600) return { d: 6.6, h: 22.5 };
  if (ml <= 1000) return { d: 8, h: 27 };
  if (ml <= 1600) return { d: 9, h: 31 };
  if (ml <= 2500) return { d: 10.5, h: 33 };
  return { d: 16, h: 33 };
}

export function estDims(m: { ml?: unknown; name?: unknown; pkg?: unknown }, form: PackForm, units: number) {
  const u = estUnit(m);
  if (form === 'unit') return { w: u.d, d: u.d, h: u.h };
  const n = units || (form === 'pack' ? 6 : 24);
  const lay = ({ 4: [2, 2], 6: [3, 2], 8: [4, 2], 12: [4, 3], 15: [5, 3], 20: [5, 4], 24: [6, 4], 30: [6, 5] } as Record<number, number[]>)[n]
    || [Math.ceil(Math.sqrt(n * 1.5)), Math.ceil(n / Math.ceil(Math.sqrt(n * 1.5)))];
  return { w: R1(lay[0] * u.d + 0.6), d: R1(lay[1] * u.d + 0.6), h: R1(u.h + (form === 'carton' ? 0.8 : 0)) };
}

export function skuFromMaster(m0: MasterRow): Sku {
  let m: MasterRow = m0;
  const has = +(m.w ?? 0) > 0 && +(m.d ?? 0) > 0;
  const form = formFromPack(m.pack, m.name, has ? +m.w! : 1, has ? +m.d! : 1);
  let units = unitsFrom(m.pack, m.name);
  if (form === 'unit') units = 1;
  if (!(+(m.w ?? 0) > 0 && +(m.d ?? 0) > 0 && +(m.h ?? 0) > 0)) { const e = estDims(m, form, units); m = { ...m, ...e, est: true }; }
  return {
    est: !!m.est, id: 'c:' + String(m.code).trim(), code: String(m.code).trim(), name: m.name, brand: m.brand || '', form,
    w: +m.w!, d: +m.d!, h: +m.h!, units, kg: +(m.kg || 0) || 0, color: colorFor(m.name, m.brand), family: m.family || '', faces: {},
    ml: m.ml || '', pkg: m.pkg || '', cat: m.cat || '', sub: m.sub || '', maker: m.maker || '',
  };
}

/** Fix SKUs saved by older versions: a multipack/carton that was typed as a single unit. */
export function fixForm(k: Sku | null | undefined) {
  if (!k || k.form !== 'unit') return false;
  const f = formFromPack('', k.name, k.w, k.d);
  if (f === 'unit') return false;
  k.form = f;
  if (!(k.units > 1)) k.units = unitsFrom('', k.name) || (f === 'pack' ? 6 : 0);
  return true;
}

/** A 4×6×2 cm size (Spaceman's placeholder) goes back to an estimate. */
export function unPlaceholder(k: Sku) {
  if (!(+k.w === 4 && +k.h === 6 && +k.d === 2)) return false;
  const e = skuFromMaster({ code: k.code, name: k.name, brand: k.brand, maker: k.maker, pack: '', ml: k.ml || '' });
  k.w = e.w; k.h = e.h; k.d = e.d; k.est = true;
  if (k.form !== e.form) { k.form = e.form; k.units = e.units; }
  return true;
}

export const codeTail = (c: unknown) => { const s = String(c || ''); return s.length > 8 ? '…' + s.slice(-5) : s; };

// ---- brand / maker of a new code from its name, learned from the catalog ("NTK AQUAFINA 5L" → AQUAFINA / SPVB) ----
export interface BrandEntry { key: string; ns: string; brand: string; maker: string }
export function brandIndex(catalog: Sku[]): BrandEntry[] {
  const m = new Map<string, { brand: string; makers: Map<string, number> }>();
  for (const k of catalog) {
    const b = String(k.brand || '').trim();
    if (!b || /^(other|others|no brand|khac|\(.*\))$/i.test(norm(b))) continue;
    const key = norm(b);
    const e = m.get(key) || { brand: b, makers: new Map() };
    if (k.maker) e.makers.set(k.maker, (e.makers.get(k.maker) || 0) + 1);
    m.set(key, e);
  }
  return [...m].map(([key, e]) => ({ key, ns: key.replace(/[^a-z0-9]/g, ''), brand: e.brand, maker: [...e.makers].sort((a, b) => b[1] - a[1])[0]?.[0] || '' }))
    .filter((e) => e.ns.length >= 2).sort((a, b) => b.key.length - a.key.length);
}
export function inferBrand(idx: BrandEntry[], name: unknown) {
  const n = ' ' + norm(name).replace(/[^a-z0-9]+/g, ' ') + ' ', ns = n.replace(/ /g, '');
  for (const e of idx) { if (n.includes(' ' + e.key.replace(/[^a-z0-9]+/g, ' ').trim() + ' ') || (e.ns.length >= 5 && ns.includes(e.ns))) return { brand: e.brand, maker: e.maker }; }
  return null;
}
export function fillBrand(idx: BrandEntry[], k: Sku) {
  if (k.brand && k.maker) return false;
  const g = inferBrand(idx, k.name);
  if (!g) return false;
  if (!k.brand) k.brand = g.brand;
  if (!k.maker && g.maker) k.maker = g.maker;
  k.color = k.color || colorFor(k.name, k.brand);
  return true;
}
