// Project JSON files. Writes format 'nexus-pog' schema 8 with every used asset embedded. Reads schema 7
// ('smart-pallet-scene' / 'nexus-pog'), V6 projects ({version:6, project, images}) and V6 libraries ('smart-pallet-library').
import { migrateV6 } from '../domain/migration/v6';
import { normaliseDesign, type MigrationReport } from '../domain/migration/normalize';
import { SCHEMA, type Design } from '../domain/types';

export const APP_VERSION = '2.0.0-alpha.1';

export function usedAssets(d: Design) {
  const s = new Set<string>();
  for (const k of Object.values(d.skus)) for (const v of Object.values(k.faces || {})) if (v) s.add(v);
  for (const o of d.objects) { if ((o.type === 'posm' || o.type === 'prop') && o.asset) s.add(o.asset); if (o.type === 'posm' && o.backAsset) s.add(o.backAsset); }
  return s;
}

export function projectJSON(d: Design, assets: Map<string, string>) {
  const a: Record<string, string> = {};
  for (const id of usedAssets(d)) { const src = assets.get(id); if (src) a[id] = src; }
  return JSON.stringify({ format: 'nexus-pog', schema: SCHEMA, app: APP_VERSION, savedAt: Date.now(), axes: 'cm; X left→right, Y up, Z back→front; pos = bottom-center; ry = degrees about Y', design: d, assets: a });
}

export type OpenResult =
  | { kind: 'design'; design: Design; assets: Record<string, string>; report: MigrationReport }
  | { kind: 'v6'; design: Design; assets: Record<string, string>; report: MigrationReport; v6: { notes: string[]; v6: Record<string, number> } }
  | { kind: 'v6library'; items: { name: string; cartons?: number; height?: number; thumb?: string; project: unknown }[] };

/** Parse a project file's JSON text. putAsset stores data URLs (V6 images) and returns asset ids. */
export async function openProjectText(text: string, putAsset: (src: string) => Promise<string>): Promise<OpenResult> {
  const o = JSON.parse(text);
  if ((o.format === 'smart-pallet-scene' || o.format === 'nexus-pog') && o.design) {
    const { design, report } = normaliseDesign(o.design);
    return { kind: 'design', design, assets: o.assets || {}, report };
  }
  if (o.version === 6 && o.project) {
    const m = await migrateV6(o.project, o.images || {}, putAsset);
    const { design, report } = normaliseDesign(m.design);
    report.notes.unshift(...m.rep.notes);
    return { kind: 'v6', design, assets: {}, report, v6: m.rep };
  }
  if (o.format === 'smart-pallet-library' && Array.isArray(o.items)) return { kind: 'v6library', items: o.items };
  throw Error('Không nhận ra định dạng · Unknown file format');
}

export async function openV6LibraryItem(item: { project: { images?: Record<string, Record<string, string>> } }, putAsset: (src: string) => Promise<string>) {
  const m = await migrateV6(item.project, item.project.images || {}, putAsset);
  const { design, report } = normaliseDesign(m.design);
  report.notes.unshift(...m.rep.notes);
  return { design, report, v6: m.rep };
}
