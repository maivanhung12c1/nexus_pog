// Bill of materials, counted from the scene model only (legacy computeBOM).
import { arrayCount } from './geometry';
import { skuLabel, type Scene } from './scene';
import type { PackForm, SceneObject, Sku } from './types';

export interface BomRow { k: Sku; n: number; units: number; conv: number | null }
export interface BomFamily { key: string; parts: BomRow[]; conv: number; unknown: boolean }
export interface Bom {
  rows: BomRow[];
  tot: { carton: number; pack: number; unit: number; conv: number; unknown: number };
  families: BomFamily[];
  posm: [string, number][];
  props: [string, number][];
  pallets: number;
}

const FORM_ORDER: Record<PackForm, number> = { carton: 0, pack: 1, unit: 2 };

export function computeBOM(s: Scene): Bom {
  const rows = new Map<string, BomRow>(), posm: SceneObject[] = [], props: SceneObject[] = [];
  let pallets = 0;
  for (const o of s.d.objects) {
    if (o.type === 'pallet') { if (o.subtype !== 'deck') pallets++; continue; }
    if (o.type === 'posm') { posm.push(o); continue; }
    if (o.type === 'prop') { props.push(o); continue; }
    const k = s.skuOf(o);
    if (!k) continue;
    const n = o.type === 'array' ? arrayCount(o) : 1;
    const r = rows.get(k.id) || { k, n: 0, units: 0, conv: null };
    r.n += n;
    rows.set(k.id, r);
  }
  const list = [...rows.values()].sort((a, b) => FORM_ORDER[a.k.form] - FORM_ORDER[b.k.form] || skuLabel(a.k).localeCompare(skuLabel(b.k)));
  const tot = { carton: 0, pack: 0, unit: 0, conv: 0, unknown: 0 };
  for (const r of list) {
    tot[r.k.form] = (tot[r.k.form] || 0) + r.n;
    const u = r.k.form === 'unit' ? 1 : +r.k.units || 0;
    r.units = u;
    r.conv = u ? r.n * u : null;
    if (u) tot.conv += r.conv!; else tot.unknown += r.n;
  }
  const fam = new Map<string, BomFamily>();
  for (const r of list) {
    const f = String(r.k.family || '').trim();
    if (!f) continue;
    const e = fam.get(f) || { key: f, parts: [], conv: 0, unknown: false };
    e.parts.push(r);
    if (r.conv == null) e.unknown = true; else e.conv += r.conv;
    fam.set(f, e);
  }
  const pm = new Map<string, number>();
  for (const o of posm) { const k = o.name || 'POSM'; pm.set(k, (pm.get(k) || 0) + 1); }
  const pr = new Map<string, number>();
  for (const o of props) { const k = o.name || 'Prop'; pr.set(k, (pr.get(k) || 0) + 1); }
  return { rows: list, tot, families: [...fam.values()].filter((f) => f.parts.length > 1), posm: [...pm], props: [...pr], pallets };
}
