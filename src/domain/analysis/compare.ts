// Current ↔ proposal comparison (legacy showCompare calc): KPIs, share by maker/brand, SKU change list.
import { metricsOf, type ShelfMetrics } from '../shelf/metrics';
import type { Design, Sku } from '../types';
import { norm } from '../util';

export type ChangeStatus = 'add' | 'del' | 'up' | 'down' | 'move' | 'same';
export interface CompareRow { k: Sku; fc: number; fp: number; lc: number; lp: number; st: ChangeStatus }
export interface CompareResult { cur: ShelfMetrics; prop: ShelfMetrics; rows: CompareRow[]; focusCur: number; focusProp: number }

export function compareDesigns(current: Design, proposal: Design, focus = 'SPVB'): CompareResult {
  const cur = metricsOf(current), prop = metricsOf(proposal);
  const sku = new Map<string, { k: Sku; c?: (typeof cur.rows)[number]; p?: (typeof cur.rows)[number] }>();
  for (const r of cur.rows) sku.set(r.k.code, { k: r.k, c: r });
  for (const r of prop.rows) { const x = sku.get(r.k.code) || { k: r.k }; x.p = r; sku.set(r.k.code, x); }
  const rows = [...sku.values()].map((x) => {
    const fc = x.c ? x.c.facings : 0, fp = x.p ? x.p.facings : 0, lc = x.c ? x.c.linear : 0, lp = x.p ? x.p.linear : 0;
    const st: ChangeStatus = !x.c ? 'add' : !x.p ? 'del' : fp > fc ? 'up' : fp < fc ? 'down' : Math.abs(lp - lc) > 0.5 ? 'move' : 'same';
    return { k: x.k, fc, fp, lc, lp, st };
  }).sort((a, b) => Math.abs(b.lp - b.lc) - Math.abs(a.lp - a.lc));
  const sh = (m: ShelfMetrics) => { const e = m.makers.find((g) => norm(g.key).includes(norm(focus))); return e ? e.share : 0; };
  return { cur, prop, rows, focusCur: sh(cur), focusProp: sh(prop) };
}
