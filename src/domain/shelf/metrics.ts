// Shelf metrics (legacy shelfMetrics / metricsOf): linear, facings, capacity, converted units, sales, days of supply,
// share by brand and maker, per-shelf usage.
import { arrayCount } from '../geometry';
import { L } from '../i18n';
import { isStock, Scene } from '../scene';
import type { Design, SceneObject, Sku } from '../types';
import { poolKey } from '../util';
import { shelfDirect } from './gondola';

export interface MetricRow { k: Sku; facings: number; linear: number; count: number; conv: number; unknown: boolean; sales: number; dos: number | null; share: number }
export interface GroupRow { key: string; linear: number; facings: number; share: number; shareTotal: number }
export interface ShelfMetrics {
  totalLinear: number; usedLinear: number; rows: MetricRow[]; brands: GroupRow[]; makers: GroupRow[];
  shelves: { o: SceneObject; top: number; width: number; used: number }[]; minDos: number;
}

export function shelfMetrics(s: Scene): ShelfMetrics {
  const D = s.d, shelves = D.objects.filter((o) => o.type === 'shelf'), sales = (D.settings && D.settings.sales) || {};
  const totalLinear = shelves.reduce((a, x) => { const b = s.aabb(x); return a + (b.x1 - b.x0); }, 0);
  const rows = new Map<string, MetricRow>();
  const row = (k: Sku) => { let r = rows.get(k.id); if (!r) { r = { k, facings: 0, linear: 0, count: 0, conv: 0, unknown: false, sales: 0, dos: null, share: 0 }; rows.set(k.id, r); } return r; };
  const perShelf: ShelfMetrics['shelves'] = [];
  // A block standing across two shelf segments (e.g. over the joint of two bays) is split by width for linear, but its
  // facings count once — on the segment it overlaps most. (Legacy counted them once per segment: defect #11 in the audit.)
  const facingShelf = new Map<string, { sh: string; w: number }>();
  for (const x of shelves) { const t = s.aabb(x); for (const o of shelfDirect(s, x)) { const b = s.aabb(o), w = Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0); const cur = facingShelf.get(o.id); if (w > 0 && (!cur || w > cur.w + 1e-9)) facingShelf.set(o.id, { sh: x.id, w }); } }
  for (const x of shelves) {
    const t = s.aabb(x);
    let used = 0;
    for (const o of shelfDirect(s, x)) {
      const k = s.skuOf(o), b = s.aabb(o), w = Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0);
      if (w <= 0) continue;
      used += w;
      if (!k) continue;
      const r = row(k);
      r.linear += w;
      if (facingShelf.get(o.id)?.sh === x.id) r.facings += o.type === 'array' ? o.n.x : 1;
    }
    perShelf.push({ o: x, top: t.y1, width: t.x1 - t.x0, used });
  }
  for (const o of D.objects) {
    if (!isStock(o)) continue;
    const k = s.skuOf(o);
    if (!k) continue;
    const r = row(k), n = o.type === 'array' ? arrayCount(o) : 1, u = k.form === 'unit' ? 1 : +k.units || 0;
    r.count += n;
    if (u) r.conv += n * u; else r.unknown = true;
  }
  const usedLinear = [...rows.values()].reduce((a, r) => a + r.linear, 0);
  for (const r of rows.values()) {
    const sw = +sales[poolKey(r.k.code)] || 0;
    r.sales = sw;
    r.dos = sw > 0 && !r.unknown ? r.conv / (sw / 7) : null;
    r.share = usedLinear ? r.linear / usedLinear : 0;
  }
  const group = (f: (k: Sku) => string): GroupRow[] => {
    const m = new Map<string, { key: string; linear: number; facings: number }>();
    for (const r of rows.values()) {
      const key = (f(r.k) || '').trim() || L('(chưa có)', '(none)');
      const e = m.get(key) || { key, linear: 0, facings: 0 };
      e.linear += r.linear; e.facings += r.facings;
      m.set(key, e);
    }
    return [...m.values()].map((e) => ({ ...e, share: usedLinear ? e.linear / usedLinear : 0, shareTotal: totalLinear ? e.linear / totalLinear : 0 })).sort((a, b) => b.linear - a.linear);
  };
  return {
    totalLinear, usedLinear, rows: [...rows.values()].sort((a, b) => b.linear - a.linear),
    brands: group((k) => k.brand), makers: group((k) => k.maker), shelves: perShelf, minDos: +(D.settings && D.settings.minDos!) || 3,
  };
}

export const metricsOf = (design: Design) => shelfMetrics(new Scene(design));
