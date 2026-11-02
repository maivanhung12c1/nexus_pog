// Editing operations on a selection (legacy "commands on the selection", OPS and TOOLS sections).
// All functions mutate the scene; callers wrap them in a transaction.
import { arrayCount, quarter, skuDims, toWorld, unionBox } from '../geometry';
import { isStock, type Scene } from '../scene';
import type { ArrayObj, ArrayShape, SceneObject, SkuObj } from '../types';
import { clamp, deep, R2, uid } from '../util';
import { keepCorner } from './corner';

export function cloneObjs(os: SceneObject[], dx: number, dy: number, dz: number): SceneObject[] {
  return os.map((o) => { const c = deep(o); c.id = uid(); c.lock = false; c.pos = { x: R2(o.pos.x + dx), y: R2(o.pos.y + dy), z: R2(o.pos.z + dz) }; return c; });
}

export type DupDir = 'R' | 'L' | 'B' | 'F' | 'U';
export function duplicate(s: Scene, os: SceneObject[], dir: DupDir = 'R') {
  const b = unionBox(os.map((o) => s.aabb(o)))!, W = b.x1 - b.x0, H = b.y1 - b.y0, Dp = b.z1 - b.z0;
  const off = ({ R: [W, 0, 0], L: [-W, 0, 0], B: [0, 0, -Dp], F: [0, 0, Dp], U: [0, H, 0] } as Record<DupDir, number[]>)[dir] || [W, 0, 0];
  const cs = cloneObjs(os, off[0], off[1], off[2]);
  s.d.objects.push(...cs);
  s.invalidate();
  return cs.map((c) => c.id);
}

export function remove(s: Scene, ids: Set<string>) {
  s.d.objects = s.d.objects.filter((o) => !ids.has(o.id));
  s.invalidate();
}

export function nudge(s: Scene, os: SceneObject[], dx: number, dy: number, dz: number) {
  for (const o of os) { o.pos.x = R2(o.pos.x + dx); o.pos.y = R2(Math.max(0, o.pos.y + dy)); o.pos.z = R2(o.pos.z + dz); }
  s.invalidateGeom();
}

export type AlignMode = 'L' | 'C' | 'R' | 'B' | 'F' | 'DX';
export function align(s: Scene, os: SceneObject[], mode: AlignMode) {
  if (os.length < 2) return;
  const B = unionBox(os.map((o) => s.aabb(o)))!;
  for (const o of os) {
    const b = s.aabb(o);
    if (mode === 'L') o.pos.x += B.x0 - b.x0;
    if (mode === 'R') o.pos.x += B.x1 - b.x1;
    if (mode === 'C') o.pos.x += (B.x0 + B.x1) / 2 - (b.x0 + b.x1) / 2;
    if (mode === 'B') o.pos.z += B.z0 - b.z0;
    if (mode === 'F') o.pos.z += B.z1 - b.z1;
    o.pos.x = R2(o.pos.x); o.pos.z = R2(o.pos.z);
  }
  if (mode === 'DX') {
    const sorted = [...os].sort((a, b) => s.aabb(a).x0 - s.aabb(b).x0), tw = sorted.reduce((a, o) => { const b = s.aabb(o); return a + b.x1 - b.x0; }, 0), gap = (B.x1 - B.x0 - tw) / (sorted.length - 1);
    let x = B.x0;
    for (const o of sorted) { const b = s.aabb(o); o.pos.x = R2(o.pos.x + (x - b.x0)); x += b.x1 - b.x0 + gap; }
  }
  s.invalidateGeom();
}

/** Rotate the selection about its centre by th degrees. */
export function rotate(s: Scene, os: SceneObject[], th: number) {
  const a = (th * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
  const b = unionBox(os.map((o) => s.aabb(o)))!, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  for (const o of os) {
    const x = o.pos.x - cx, z = o.pos.z - cz;
    o.pos.x = R2(cx + x * c + z * sn); o.pos.z = R2(cz - x * sn + z * c);
    o.ry = R2(((((o.ry || 0) + th) % 360) + 360) % 360);
  }
  s.invalidateGeom();
}

export function setAngle(s: Scene, os: SceneObject[], deg: number) {
  deg = ((+deg % 360) + 360) % 360;
  if (os.length === 1) { os[0].ry = R2(deg); s.invalidateGeom(); return; }
  rotate(s, os, deg - (os[0].ry || 0));
}

// ---------- quick build (row / grid / block) ----------
export interface BuildParams { nx: number; ny: number; nz: number; gx: number; gy: number; gz: number; shape: ArrayShape; step: number; dirX: 1 | -1; dirZ: 1 | -1 }
export function arrayFromItem(s: Scene, it: SkuObj, p: BuildParams): ArrayObj {
  const b = s.aabb(it);
  const a: ArrayObj = {
    id: it.id, type: 'array', sku: it.sku, n: { x: p.nx, y: p.ny, z: p.nz }, gap: { x: +p.gx || 0, y: +p.gy || 0, z: +p.gz || 0 }, shape: p.shape || 'block',
    step: Math.max(1, p.step | 0 || 1), cellRy: quarter(it.ry || 0) * 90, ry: 0, anchor: { x: p.dirX > 0 ? -1 : 1, z: p.dirZ < 0 ? 1 : -1 }, pos: { x: 0, y: it.pos.y, z: 0 }, lock: false,
  };
  const S = s.localSize(a);
  a.pos.x = R2(p.dirX > 0 ? b.x0 + S.w / 2 : b.x1 - S.w / 2);
  a.pos.z = R2(p.dirZ < 0 ? b.z1 - S.d / 2 : b.z0 + S.d / 2);
  return a;
}
export function defaultBuild(mode: 'row' | 'grid' | 'block'): BuildParams {
  return { nx: mode === 'row' ? 6 : 3, nz: mode === 'row' ? 1 : 2, ny: mode === 'block' ? 3 : 1, gx: 0, gy: 0, gz: 0, shape: 'block', step: 1, dirX: 1, dirZ: -1 };
}
export function applyBuild(s: Scene, it: SkuObj, p: BuildParams) {
  const a = arrayFromItem(s, it, p);
  s.d.objects[s.d.objects.indexOf(it)] = a;
  s.invalidate();
  return a;
}

/** Change array parameters keeping the anchor corner (non-shelf case; shelf facings go through setCount). */
export function setArrayParam(s: Scene, o: ArrayObj, key: string, val: number | string) {
  const an = o.anchor || { x: -1, z: 1 };
  keepCorner(s, o, an.x, an.z, () => {
    const v = +val;
    if (key === 'nx') o.n.x = clamp(v | 0, 1, 200);
    else if (key === 'ny') o.n.y = clamp(v | 0, 1, 100);
    else if (key === 'nz') o.n.z = clamp(v | 0, 1, 200);
    else if (key === 'gx') o.gap.x = clamp(v || 0, 0, 100);
    else if (key === 'gy') o.gap.y = clamp(v || 0, 0, 100);
    else if (key === 'gz') o.gap.z = clamp(v || 0, 0, 100);
    else if (key === 'shape') o.shape = val as ArrayShape;
    else if (key === 'step') o.step = clamp(v | 0, 1, 50);
    else if (key === 'cellRy') o.cellRy = ((o.cellRy || 0) + 90) % 360;
  });
  s.invalidateGeom();
}

/** Split an array into single items (same undo step). */
export function explodeArray(s: Scene, o: ArrayObj) {
  const items: SkuObj[] = s.arrayCells(o).map((c) => {
    const p = toWorld(o, c.x, c.y, c.z);
    const ry = (((Math.round(((o.ry || 0) + (o.cellRy || 0)) / 90) * 90) % 360) + 360) % 360;
    return { id: uid(), type: 'sku', sku: o.sku, pos: { x: R2(p.x), y: R2(p.y), z: R2(p.z) }, ry: ry === 0 ? 0 : ry };
  });
  const i = s.d.objects.indexOf(o);
  s.d.objects.splice(i, 1, ...items);
  s.invalidate();
  return items.map((x) => x.id);
}

export function splitLevels(s: Scene, o: ArrayObj) {
  const n = o.n, c = skuDims(s.skuOf(o), o.cellRy || 0), g = o.gap, S = s.localSize(o), st = Math.max(1, o.step | 0 || 1), py = c.h + g.y, out: ArrayObj[] = [];
  for (let k = 0; k < n.y; k++) {
    let nx = n.x, nz = n.z, lx0 = -S.w / 2, lz0 = -S.d / 2;
    if (o.shape === 'steps') { nz = n.z - k * st; if (nz < 1) break; }
    else if (o.shape === 'pyramid') { nx = n.x - k; nz = n.z - k; if (nx < 1 || nz < 1) break; lx0 += (k / 2) * (c.w + g.x); lz0 += (k / 2) * (c.d + g.z); }
    const W = nx * c.w + (nx - 1) * g.x, Dp = nz * c.d + (nz - 1) * g.z, ctr = toWorld(o, lx0 + W / 2, 0, lz0 + Dp / 2);
    out.push({ id: uid(), type: 'array', sku: o.sku, n: { x: nx, y: 1, z: nz }, gap: { x: g.x, y: 0, z: g.z }, shape: 'block', step: 1, cellRy: o.cellRy || 0, ry: o.ry || 0, anchor: o.anchor || { x: -1, z: 1 }, pos: { x: R2(ctr.x), y: R2(o.pos.y + k * py), z: R2(ctr.z) } });
  }
  const i = s.d.objects.indexOf(o);
  s.d.objects.splice(i, 1, ...out);
  s.invalidate();
  return out.map((x) => x.id);
}

// ---------- replace SKU ----------
export type ReplaceFit = 'center' | 'corner' | 'front' | 'fill';
/** ensureSku must put the target SKU into s.d.skus (legacy ensureProjectSku). */
export function replaceCore(s: Scene, ids: string[], toId: string, fit: ReplaceFit, swapFrom: string | null, scope: string[] | null) {
  const all = new Set(ids);
  const jobs: [string, string][] = ids.map((id) => [id, toId]);
  if (swapFrom) for (const id of scope || []) { const o = s.get(id); if (o && isStock(o) && o.sku === toId && !all.has(id)) jobs.push([id, swapFrom]); }
  for (const [id, to] of jobs) {
    const o = s.get(id);
    if (!o || !isStock(o)) continue;
    const b0 = s.aabb(o);
    if (fit === 'fill' && o.type === 'array') {
      const old = s.localSize(o), an = o.anchor || { x: -1, z: 1 };
      keepCorner(s, o, an.x, an.z, () => {
        o.sku = to;
        const c = skuDims(s.skuOf(o), o.cellRy || 0), g = o.gap;
        const per = (len: number, sz: number, gg: number) => Math.max(1, Math.floor((len + gg + 1e-6) / (sz + gg)));
        o.n = { x: per(old.w, c.w, g.x), y: per(old.h, c.h, g.y), z: per(old.d, c.d, g.z) };
      });
      continue;
    }
    o.sku = to;
    const b1 = s.aabb(o);
    if (fit === 'corner') { o.pos.x = R2(o.pos.x + b0.x0 - b1.x0); o.pos.z = R2(o.pos.z + b0.z0 - b1.z0); }
    else if (fit === 'front') { o.pos.x = R2(o.pos.x + b0.x0 - b1.x0); o.pos.z = R2(o.pos.z + b0.z1 - b1.z1); }
    else { o.pos.x = R2(o.pos.x + (b0.x0 + b0.x1 - b1.x0 - b1.x1) / 2); o.pos.z = R2(o.pos.z + (b0.z0 + b0.z1 - b1.z0 - b1.z1) / 2); }
  }
  for (const k of Object.keys(s.d.skus)) if (!s.d.objects.some((o) => isStock(o) && o.sku === k)) delete s.d.skus[k];
  s.invalidate();
}

// ---------- selection helpers (legacy selectSame*) ----------
export function sameLevel(s: Scene, os: SceneObject[]) {
  const ys = new Set(os.map((o) => Math.round(s.aabb(o).y0 * 2) / 2));
  return s.d.objects.filter((o) => !o.lock && !o.hidden && ys.has(Math.round(s.aabb(o).y0 * 2) / 2)).map((o) => o.id);
}
export function sameSku(s: Scene, os: SceneObject[]) {
  const ks = new Set(os.filter(isStock).map((o) => o.sku));
  return s.d.objects.filter((o) => !o.lock && !o.hidden && isStock(o) && ks.has(o.sku)).map((o) => o.id);
}
export function sameColumn(s: Scene, os: SceneObject[]) {
  const xs = os.map((o) => { const b = s.aabb(o); return (b.x0 + b.x1) / 2; }), zs = os.map((o) => { const b = s.aabb(o); return (b.z0 + b.z1) / 2; });
  return s.d.objects.filter((o) => {
    if (o.lock || o.hidden) return false;
    const b = s.aabb(o), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    return xs.some((x) => Math.abs(cx - x) < 1) || zs.some((z) => Math.abs(cz - z) < 1);
  }).map((o) => o.id);
}

export const stockUnits = (s: Scene, ids: string[]) => ids.reduce((a, id) => { const o = s.get(id); return a + (o && o.type === 'array' ? arrayCount(o) : 1); }, 0);
