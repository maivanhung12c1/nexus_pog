// Sales import (legacy salesWide / salesWideUI / salesSimpleUI): stored per design as single units per week,
// keyed by poolKey(code).
import { norm, poolKey, R1, toNum } from '../util';

export interface SalesWide { ci: number; nc: number; sc: number; months: { j: number; label: string }[]; data: unknown[][]; stores: string[] }

/** AEON "Data sharing" layout: store × barcode × month with "Sold Quantity" columns under month headers. */
export function salesWide(rows: unknown[][]): SalesWide | null {
  for (let i = 1; i < Math.min(20, rows.length); i++) {
    const r = rows[i].map((c) => String(c ?? '').trim());
    const ci = r.findIndex((c) => /^item\s*barcode$/i.test(c)), q = r.map((c, j) => (/^sold\s*quantity$/i.test(c) ? j : -1)).filter((j) => j >= 0);
    if (ci < 0 || !q.length) continue;
    const up = rows[i - 1].map((c) => String(c ?? '').trim());
    const months = q.filter((j) => up[j] && !/overall/i.test(up[j])).map((j) => ({ j, label: up[j] }));
    if (!months.length) continue;
    const sc = r.findIndex((c) => /^name\s*store$/i.test(c)), sc2 = r.findIndex((c) => /^store$/i.test(c)), nc = r.findIndex((c) => /^name\s*item$/i.test(c));
    const scol = sc >= 0 ? sc : sc2;
    const data = rows.slice(i + 1).filter((x) => String(x[ci] ?? '').trim() && !/overall/i.test(String(x[scol] ?? '')));
    return { ci, nc, sc: scol, months, data, stores: [...new Set(data.map((x) => String(x[scol] ?? '').trim()).filter(Boolean))].sort() };
  }
  return null;
}

/** Wide → weekly units. store: a store name, '*avg' (average per store) or '*sum'. unitsOfCode converts packs to units. */
export function applySalesWide(W: SalesWide, store: string, months: { j: number; label: string }[], unitsOfCode: (code: string) => number) {
  const out: Record<string, number> = {}, stores = new Set<string>();
  for (const r of W.data) {
    const s = String(r[W.sc] ?? '').trim();
    if (store[0] !== '*' && s !== store) continue;
    stores.add(s);
    const code = poolKey(String(r[W.ci]).replace(/\s+/g, ''));
    let q = 0;
    for (const m of months) q += toNum(r[m.j]);
    if (!q) continue;
    out[code] = (out[code] || 0) + q;
  }
  const div = months.length * (store === '*avg' ? Math.max(1, stores.size) : 1), res: Record<string, number> = {};
  for (const [c, q] of Object.entries(out)) res[c] = R1(((q / div) * 7) / 30.44 * unitsOfCode(c));
  return res;
}

const QTY_HEAD = /^(soluongban|soban|sales|qty|quantity|soluong|sl|ban|volume|soldquantity)/;
const CODE_HEAD = ['masku', 'skucode', 'upc', 'gtin', 'productid', 'mahang', 'masp', 'barcode', 'ean', 'itemcode', 'sku', 'code', 'ma'];

/** Simple layout: a code column + a quantity column; unit = 'unit' | 'sku' (per pack), period = 'week' | 'month' | 'day'. */
export function applySalesSimple(rows: unknown[][], unit: 'unit' | 'sku', period: 'week' | 'month' | 'day', unitsOfCode: (code: string) => number) {
  let hi = -1, ci = -1, qi = -1;
  for (let i = 0; i < Math.min(8, rows.length); i++) {
    const cells = rows[i].map((c) => norm(c).replace(/[^a-z0-9]/g, ''));
    const c = cells.findIndex((n) => !!n && CODE_HEAD.some((a) => (a.length >= 4 ? n.startsWith(a) : n === a)));
    const q = cells.findIndex((n) => QTY_HEAD.test(n));
    if (c >= 0 && q >= 0) { hi = i; ci = c; qi = q; break; }
  }
  if (hi < 0) throw Error('no code + sales columns');
  const fac = period === 'month' ? 7 / 30.44 : period === 'day' ? 7 : 1, out: Record<string, number> = {};
  let n = 0;
  for (let i = hi + 1; i < rows.length; i++) {
    const code = poolKey(String(rows[i][ci] || '').replace(/\s+/g, ''));
    const q = toNum(rows[i][qi]);
    if (!code || !(q > 0)) continue;
    out[code] = (out[code] || 0) + R1(q * fac * (unit === 'sku' ? unitsOfCode(code) : 1));
    n++;
  }
  return { sales: out, rows: n };
}
