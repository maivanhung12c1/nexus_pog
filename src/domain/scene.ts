// Scene: one Design plus the derived caches the legacy app kept in globals (_objIdx, _solidCache).
// Every legacy function that read the global `D` takes a Scene instead. Running an algorithm on another design
// (legacy metricsOf / rpPositions / withDesign) = new Scene(otherDesign).
import { arrayCount, arraySizeWith, boxAABB, skuDims, unionBox } from './geometry';
import type { ArrayObj, Box, Design, SceneObject, Sku, StockObj } from './types';

export const isStock = (o: SceneObject | null | undefined): o is StockObj => !!o && (o.type === 'sku' || o.type === 'array');
export const isSupport = (o: SceneObject) => o.type === 'pallet' || o.type === 'sku' || o.type === 'array' || o.type === 'shelf';
export const isRigid = (o: SceneObject) => o.type === 'pallet' || o.type === 'shelf' || o.type === 'fixture';
export const isDeck = (o: SceneObject) => o.type === 'pallet' && o.subtype === 'deck';
export const skuLabel = (k: Sku | null | undefined) => (k ? k.name || k.code || '?' : '?');

export interface Solid { id: string; box: Box }

export class Scene {
  d: Design;
  private idx: Map<string, SceneObject> | null = null;
  private solidCache: Solid[] | null = null;

  constructor(d: Design) { this.d = d; }

  get objects() { return this.d.objects; }
  get isShelfMode() { return this.d.settings?.kind === 'shelf'; }

  invalidate() { this.idx = null; this.solidCache = null; }
  invalidateIndex() { this.idx = null; }
  invalidateGeom() { this.solidCache = null; }

  get(id: string | null | undefined): SceneObject | undefined {
    if (!id) return undefined;
    if (!this.idx) { this.idx = new Map(); for (const o of this.d.objects) this.idx.set(o.id, o); }
    return this.idx.get(id);
  }

  skuOf(o: SceneObject | null | undefined): Sku | null {
    return o && (o.type === 'sku' || o.type === 'array') && o.sku ? this.d.skus[o.sku] || null : null;
  }

  /** Local (unrotated) size of an object. */
  localSize(o: SceneObject) {
    if (o.type === 'sku') return skuDims(this.skuOf(o));
    if (o.type === 'array') return arraySizeWith(o, this.skuOf(o));
    return { w: +o.size.w, d: +o.size.d, h: +o.size.h };
  }

  aabb(o: SceneObject): Box {
    const s = this.localSize(o);
    return boxAABB(o, -s.w / 2, s.w / 2, 0, s.h, -s.d / 2, s.d / 2);
  }

  /** Cells of an array (local, relative to the block's bottom-centre): cell bottom-centres. */
  arrayCells(o: ArrayObj) {
    const c = skuDims(this.skuOf(o), o.cellRy || 0), n = o.n, g = o.gap || { x: 0, y: 0, z: 0 }, S = this.localSize(o), out: { x: number; y: number; z: number; lv: number }[] = [];
    const px = c.w + g.x, py = c.h + g.y, pz = c.d + g.z, x0 = -S.w / 2 + c.w / 2, z0 = -S.d / 2 + c.d / 2, shape = o.shape || 'block', st = Math.max(1, o.step | 0 || 1);
    for (let k = 0; k < n.y; k++) {
      if (shape === 'block') { for (let j = 0; j < n.z; j++) for (let i = 0; i < n.x; i++) out.push({ x: x0 + i * px, y: k * py, z: z0 + j * pz, lv: k }); }
      else if (shape === 'steps') { const rows = n.z - k * st; if (rows < 1) break; for (let j = 0; j < rows; j++) for (let i = 0; i < n.x; i++) out.push({ x: x0 + i * px, y: k * py, z: z0 + j * pz, lv: k }); }
      else if (shape === 'pyramid') { const a = n.x - k, b = n.z - k; if (a < 1 || b < 1) break; for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) out.push({ x: x0 + (i + k / 2) * px, y: k * py, z: z0 + (j + k / 2) * pz, lv: k }); }
    }
    return out;
  }

  /** Load-bearing solids (world AABBs). A stepped/pyramid array gives one solid per level. */
  solids(o: SceneObject): Box[] {
    if (o.type !== 'array' || (o.shape || 'block') === 'block') return [this.aabb(o)];
    const c = skuDims(this.skuOf(o), o.cellRy || 0), n = o.n, g = o.gap || { x: 0, y: 0, z: 0 }, S = this.localSize(o), out: Box[] = [], st = Math.max(1, o.step | 0 || 1), py = c.h + g.y;
    for (let k = 0; k < n.y; k++) {
      let lx0: number, lx1: number, lz0: number, lz1: number;
      if (o.shape === 'steps') { const rows = n.z - k * st; if (rows < 1) break; lx0 = -S.w / 2; lx1 = S.w / 2; lz0 = -S.d / 2; lz1 = lz0 + rows * c.d + (rows - 1) * g.z; }
      else { const a = n.x - k, b = n.z - k; if (a < 1 || b < 1) break; lx0 = -S.w / 2 + (k / 2) * (c.w + g.x); lx1 = lx0 + a * c.w + (a - 1) * g.x; lz0 = -S.d / 2 + (k / 2) * (c.d + g.z); lz1 = lz0 + b * c.d + (b - 1) * g.z; }
      out.push(boxAABB(o, lx0, lx1, k * py, k * py + c.h, lz0, lz1));
    }
    return out;
  }

  /** Candidate support solids (cached until the next invalidate). */
  supportSolids(): Solid[] {
    if (this.solidCache) return this.solidCache;
    const out: Solid[] = [];
    for (const o of this.d.objects) { if (!(o.type === 'pallet' || o.type === 'sku' || o.type === 'array' || o.type === 'shelf')) continue; for (const b of this.solids(o)) out.push({ id: o.id, box: b }); }
    this.solidCache = out;
    return out;
  }

  snapTargets(exclude: Set<string>): Solid[] {
    const out: Solid[] = [];
    for (const o of this.d.objects) { if (o.hidden || exclude.has(o.id)) continue; out.push({ id: o.id, box: this.aabb(o) }); }
    return out;
  }

  count(o: SceneObject) { return o.type === 'array' ? arrayCount(o) : 1; }

  objName(o: SceneObject | null | undefined): string {
    if (!o) return '?';
    if (o.type === 'sku' || o.type === 'array') { const k = this.skuOf(o); return (o.type === 'array' ? '[' + arrayCount(o) + '] ' : '') + skuLabel(k); }
    return o.name || o.type;
  }

  sceneBox(includePallet = true) {
    return unionBox(this.d.objects.filter((o) => includePallet || o.type !== 'pallet').map((o) => this.aabb(o)));
  }

  stock() { return this.d.objects.filter(isStock); }
}
