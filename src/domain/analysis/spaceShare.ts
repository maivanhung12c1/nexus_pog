// Space Share (legacy report.js): share of shelf by any product field, several POGs side by side.
// Positions = stock objects (facing blocks / single products). Linear = horizontal space (Spaceman HorizSpace when the
// position came from a .plnx, else x-extent), Facings = n.x, SKU = distinct products, Area = linear × depth,
// Stock = units on shelf. Products stacked on other products count their own linear (Spaceman rule).
import { arrayCount } from '../geometry';
import { formLabel, L } from '../i18n';
import { isStock, Scene } from '../scene';
import type { Box, Design, Sku } from '../types';
import { poolKey } from '../util';

export type Metric = 'lin' | 'fac' | 'sku' | 'are' | 'stk';
export const METRICS: Record<Metric, { label: () => string; unit: () => string; decimals: number }> = {
  lin: { label: () => 'Linear', unit: () => 'cm', decimals: 1 },
  fac: { label: () => 'Facings', unit: () => 'F', decimals: 0 },
  sku: { label: () => 'SKU', unit: () => 'SKU', decimals: 0 },
  are: { label: () => L('Diện tích', 'Area'), unit: () => 'cm²', decimals: 0 },
  stk: { label: () => 'Stock', unit: () => L('đv', 'u'), decimals: 0 },
};

export const DIMS: [string, () => string][] = [
  ['maker', () => L('Nhà sản xuất', 'Manufacturer')], ['brand', () => 'Brand'], ['cat', () => 'Category'], ['sub', () => 'Sub-category'],
  ['seg', () => 'Segment'], ['pkg', () => L('Bao bì', 'Package')], ['ml', () => L('Dung tích', 'Size')], ['form', () => L('Quy cách', 'Pack form')],
  ...['DescA', 'DescB', 'DescC', 'DescD', 'DescE', 'DescF', 'DescG', 'DescH', 'DescJ', 'DescL', 'SubSegment', 'String1', 'String2', 'String3'].map((f) => [f, () => f] as [string, () => string]),
];
export const dimLabel = (d: string) => (DIMS.find((x) => x[0] === d) || [d, () => d])[1]();

export const rpNorm = (v: unknown) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase(); return t || L('(TRỐNG)', '(EMPTY)'); };
export function rpVal(k: Sku | null | undefined, dim: string) {
  if (!k) return rpNorm('');
  if (dim === 'form') return rpNorm(formLabel(k.form));
  const v = (k as unknown as Record<string, unknown>)[dim] !== undefined && (k as unknown as Record<string, unknown>)[dim] !== '' ? (k as unknown as Record<string, unknown>)[dim] : k.attr && k.attr[dim];
  return rpNorm(v);
}

export interface Position { k: Sku; lin: number; fac: number; are: number; stk: number; x0: number; x1: number; y0: number; y1: number; id: string }
export interface Positions { pos: Position[]; shelves: Box[] }

export function positions(design: Design): Positions {
  const s = new Scene(design), out: Position[] = [];
  for (const o of design.objects) {
    if (!isStock(o) || o.hidden) continue;
    const k = s.skuOf(o);
    if (!k) continue;
    const b = s.aabb(o);
    const w = o.type === 'array' && o.sm && o.sm.hs ? o.sm.hs : b.x1 - b.x0, dp = b.z1 - b.z0, n = o.type === 'array' ? arrayCount(o) : 1;
    out.push({ k, lin: w, fac: o.type === 'array' ? o.n.x : 1, are: w * dp, stk: n, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, id: o.id });
  }
  const shelves = design.objects.filter((o) => o.type === 'shelf').map((o) => s.aabb(o));
  return { pos: out, shelves };
}

export interface AggRow { key: string; lin: number; fac: number; are: number; stk: number; sku: number }
export interface Agg { rows: AggRow[]; T: { lin: number; fac: number; are: number; stk: number; sku: number } }
export interface Scope { dim: string; val: string }

export function aggregate(P: Positions, dim: string, scope: Scope | null): Agg {
  const g = new Map<string, { key: string; lin: number; fac: number; are: number; stk: number; set: Set<string> }>();
  const T = { lin: 0, fac: 0, are: 0, stk: 0, set: new Set<string>() };
  for (const p of P.pos) {
    if (scope && rpVal(p.k, scope.dim) !== scope.val) continue;
    const key = rpVal(p.k, dim);
    let r = g.get(key);
    if (!r) { r = { key, lin: 0, fac: 0, are: 0, stk: 0, set: new Set() }; g.set(key, r); }
    for (const m of ['lin', 'fac', 'are', 'stk'] as const) { r[m] += p[m]; T[m] += p[m]; }
    r.set.add(p.k.id); T.set.add(p.k.id);
  }
  const rows = [...g.values()].map((r) => ({ key: r.key, lin: r.lin, fac: r.fac, are: r.are, stk: r.stk, sku: r.set.size }));
  return { rows, T: { lin: T.lin, fac: T.fac, are: T.are, stk: T.stk, sku: T.set.size } };
}

export const share = (A: Agg, key: string, m: Metric) => { const r = A.rows.find((x) => x.key === key); return r && A.T[m] ? r[m] / A.T[m] : 0; };

/** Dimensions whose values actually vary across the given position sets (legacy: only these are offered). */
export function varyingDims(sets: Positions[]) {
  return DIMS.filter(([k]) => { const s = new Set<string>(); for (const P of sets) for (const p of P.pos) { s.add(rpVal(p.k, k)); if (s.size > 1) return true; } return false; });
}

/** Colour per group key: focus (own maker) gets the one data hue, the main competitor its own, the rest greys. */
export function groupColors(keys: string[], focus: string, competitor = 'KO') {
  const greys = ['#5b6573', '#8a94a3', '#aab2bd', '#c3c9d1', '#d6dbe1'];
  const m = new Map<string, string>();
  let gi = 0;
  for (const k of keys) {
    if (k === focus) m.set(k, 'var(--chart-1)');
    else if (k === competitor || (/^(KO|COCA)/.test(k) && !m.has(k) && competitor === 'KO')) m.set(k, 'var(--chart-competitor)');
    else if (/^(OTHER|OTHERS|KHÁC|\(TRỐNG\)|\(EMPTY\))$/.test(k)) m.set(k, 'var(--chart-other)');
    else m.set(k, greys[Math.min(gi++, greys.length - 1)]);
  }
  return m;
}

/** SKU changes between two POGs (legacy rpSkuChanges): new / removed / more / fewer facings. */
export interface SkuChange { code: string; k: Sku; a?: { fac: number; lin: number }; b?: { fac: number; lin: number }; st: 'new' | 'del' | 'up' | 'dn' }
export function skuChanges(A: Positions, B: Positions, scope: Scope | null): SkuChange[] {
  const agg = (P: Positions) => {
    const m = new Map<string, { k: Sku; fac: number; lin: number }>();
    for (const p of P.pos) { if (scope && rpVal(p.k, scope.dim) !== scope.val) continue; const c = poolKey(p.k.code); const r = m.get(c) || { k: p.k, fac: 0, lin: 0 }; r.fac += p.fac; r.lin += p.lin; m.set(c, r); }
    return m;
  };
  const a = agg(A), b = agg(B), codes = [...new Set([...a.keys(), ...b.keys()])];
  const order = 'newdelupdn';
  return codes.map((c) => {
    const x = a.get(c), y = b.get(c);
    const st = !x ? 'new' : !y ? 'del' : y.fac > x.fac ? 'up' : y.fac < x.fac ? 'dn' : 'eq';
    return { code: c, k: (y || x)!.k, a: x ? { fac: x.fac, lin: x.lin } : undefined, b: y ? { fac: y.fac, lin: y.lin } : undefined, st } as SkuChange | (Omit<SkuChange, 'st'> & { st: 'eq' });
  }).filter((r): r is SkuChange => r.st !== 'eq').sort((p, q) => order.indexOf(p.st) - order.indexOf(q.st));
}

/** Per-SKU summary of one design (facings and linear per SKU) — used by Phiếu Dựng and picking. */
export function skuSummary(design: Design) {
  const { pos } = positions(design), m = new Map<string, { k: Sku; fac: number; lin: number; stk: number }>();
  for (const p of pos) { const e = m.get(p.k.id); if (e) { e.fac += p.fac; e.lin += p.lin; e.stk += p.stk; } else m.set(p.k.id, { k: p.k, fac: p.fac, lin: p.lin, stk: p.stk }); }
  return [...m.values()];
}
