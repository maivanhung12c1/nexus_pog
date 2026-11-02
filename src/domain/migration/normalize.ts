// legacy project → normalised schema-8 Design + migration report.
// Accepts schema 7 ('smart-pallet-scene', 'nexus-pog') designs. Unknown top-level fields are preserved under
// `legacy` and listed; numeric fields are coerced; SKU forms and placeholder sizes are repaired as legacy did on load.
import { fixForm, unPlaceholder } from '../catalog/sku';
import { colorFor } from '../colors';
import { normaliseSheet } from '../operations/sheet';
import { SCHEMA, type Design, type SceneObject, type Sku } from '../types';
import { uid } from '../util';

export interface MigrationReport { from: number | string; notes: string[]; kept: string[]; repaired: number; dropped: string[] }

const KNOWN_TOP = new Set(['schema', 'meta', 'settings', 'skus', 'objects', 'sheet', 'legacy']);
const TYPES = new Set(['pallet', 'sku', 'array', 'posm', 'prop', 'fixture', 'shelf', 'struct']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normaliseDesign(raw: any): { design: Design; report: MigrationReport } {
  const rep: MigrationReport = { from: raw?.schema ?? 'unknown', notes: [], kept: [], repaired: 0, dropped: [] };
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.objects)) throw Error('Not a Nexus POG design (no objects array)');
  const legacy: Record<string, unknown> = { ...(raw.legacy || {}) };
  for (const k of Object.keys(raw)) if (!KNOWN_TOP.has(k)) { legacy[k] = raw[k]; rep.kept.push(k); }
  const meta = raw.meta || {};
  const d: Design = {
    schema: SCHEMA,
    meta: { name: String(meta.name ?? 'Display'), by: String(meta.by ?? ''), created: +meta.created || Date.now(), updated: +meta.updated || Date.now() },
    settings: Object.assign({ maxH: 150, overhang: 0, preset: 'custom' }, raw.settings || {}),
    skus: {},
    objects: [],
  };
  if (meta.preset !== undefined) { legacy['meta.preset'] = meta.preset; rep.kept.push('meta.preset'); }
  if (!d.settings.kind) d.settings.kind = raw.objects.some((o: SceneObject) => o && o.type === 'shelf') ? 'shelf' : 'pallet';
  d.settings.maxH = +d.settings.maxH || 150;
  d.settings.overhang = +d.settings.overhang || 0;
  for (const [id, k0] of Object.entries<Sku>(raw.skus || {})) {
    const k: Sku = { ...k0, id: k0.id || id, code: String(k0.code ?? ''), name: String(k0.name ?? ''), brand: k0.brand || '', maker: k0.maker || '', w: +k0.w || 1, d: +k0.d || 1, h: +k0.h || 1, units: +k0.units || 0, kg: +k0.kg || 0, color: k0.color || colorFor(k0.name, k0.brand), family: k0.family || '', faces: k0.faces || {}, ml: k0.ml ?? '', pkg: k0.pkg || '', cat: k0.cat || '', sub: k0.sub || '', form: (['carton', 'pack', 'unit'] as const).includes(k0.form) ? k0.form : 'carton' };
    if (k0.form && !['carton', 'pack', 'unit'].includes(k0.form)) rep.notes.push(`SKU ${k.code}: unknown pack form "${k0.form}" → carton`);
    if (fixForm(k)) rep.repaired++;
    if (unPlaceholder(k)) rep.repaired++;
    d.skus[k.id] = k;
  }
  const ids = new Set<string>();
  for (const o0 of raw.objects as SceneObject[]) {
    if (!o0 || !TYPES.has(o0.type)) { rep.dropped.push(String(o0 && (o0 as { type?: string }).type)); continue; }
    const o = { ...o0, pos: { x: +o0.pos?.x || 0, y: +o0.pos?.y || 0, z: +o0.pos?.z || 0 }, ry: +o0.ry || 0 } as SceneObject;
    if (!o.id || ids.has(o.id)) o.id = uid();
    ids.add(o.id);
    if ((o.type === 'sku' || o.type === 'array') && !d.skus[o.sku]) {
      // legacy drew such objects as a 10 cm cube; keep them with an explicit placeholder SKU so nothing is lost
      d.skus[o.sku] = { id: o.sku, code: String(o.sku).replace(/^c:/, ''), name: `(missing SKU ${o.sku})`, brand: '', maker: '', form: 'carton', w: 10, d: 10, h: 10, units: 0, kg: 0, color: '#9aa3ad', family: '', faces: {}, ml: '', pkg: '', cat: '', sub: '', est: true };
      rep.notes.push(`Object ${o.id}: SKU ${o.sku} missing from the file → placeholder 10×10×10 cm SKU created`);
    }
    if (o.type === 'array') { o.gap = o.gap || { x: 0, y: 0, z: 0 }; o.shape = o.shape || 'block'; o.step = o.step || 1; o.cellRy = o.cellRy || 0; }
    d.objects.push(o);
  }
  if (raw.sheet) d.sheet = normaliseSheet(raw.sheet, d);
  if (Object.keys(legacy).length) d.legacy = legacy;
  if (rep.dropped.length) rep.notes.push(`${rep.dropped.length} object(s) could not be migrated and were left out.`);
  return { design: d, report: rep };
}
