// Geometry that does not need the design (ported verbatim from legacy GEOMETRY section).
import type { ArrayObj, Box, Sku } from './types';

export const quarter = (ry: number) => (((Math.round(ry / 90)) % 4) + 4) % 4;
export const isRightAngle = (ry: number) => Math.abs(ry / 90 - Math.round(ry / 90)) < 1e-6;

/** Footprint of one product cell; a quarter turn swaps width and depth. Unknown SKU → 10 cm cube (legacy). */
export function skuDims(k: Sku | null | undefined, cellRy = 0) {
  if (!k) return { w: 10, d: 10, h: 10 };
  return quarter(cellRy) % 2 ? { w: +k.d, d: +k.w, h: +k.h } : { w: +k.w, d: +k.d, h: +k.h };
}

export function rotExt(w: number, d: number, ry: number) {
  if (isRightAngle(ry)) return quarter(ry) % 2 ? { w: d, d: w } : { w, d };
  const a = (ry * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { w: w * c + d * s, d: w * s + d * c };
}

/** Local point (relative to the bottom-centre pivot) → world. */
export function toWorld(o: { pos: { x: number; y: number; z: number }; ry?: number }, lx: number, ly: number, lz: number) {
  const a = ((o.ry || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: o.pos.x + lx * c + lz * s, y: o.pos.y + ly, z: o.pos.z - lx * s + lz * c };
}

/** Local box → world AABB. */
export function boxAABB(o: { pos: { x: number; y: number; z: number }; ry?: number }, lx0: number, lx1: number, ly0: number, ly1: number, lz0: number, lz1: number): Box {
  const cx = (lx0 + lx1) / 2, cz = (lz0 + lz1) / 2, e = rotExt(lx1 - lx0, lz1 - lz0, o.ry || 0), p = toWorld(o, cx, 0, cz);
  return { x0: p.x - e.w / 2, x1: p.x + e.w / 2, y0: o.pos.y + ly0, y1: o.pos.y + ly1, z0: p.z - e.d / 2, z1: p.z + e.d / 2 };
}

/** Size of an array from a given SKU (legacy `localSizeWith`). */
export function arraySizeWith(o: Pick<ArrayObj, 'n' | 'gap' | 'cellRy'>, k: Sku | null | undefined) {
  const c = skuDims(k, o.cellRy || 0), n = o.n, g = o.gap || { x: 0, y: 0, z: 0 };
  return { w: n.x * c.w + (n.x - 1) * g.x, h: n.y * c.h + (n.y - 1) * g.y, d: n.z * c.d + (n.z - 1) * g.z };
}

export function arrayCount(o: Pick<ArrayObj, 'n' | 'shape' | 'step'>) {
  const n = o.n, shape = o.shape || 'block';
  if (shape === 'block') return n.x * n.y * n.z;
  let s = 0;
  const st = Math.max(1, o.step | 0 || 1);
  for (let k = 0; k < n.y; k++) {
    if (shape === 'steps') { const r = n.z - k * st; if (r < 1) break; s += r * n.x; }
    else { const a = n.x - k, b = n.z - k; if (a < 1 || b < 1) break; s += a * b; }
  }
  return s;
}

export function arrayLevels(o: Pick<ArrayObj, 'n' | 'shape' | 'step'>) {
  const n = o.n, shape = o.shape || 'block';
  let L = 0;
  const st = Math.max(1, o.step | 0 || 1);
  for (let k = 0; k < n.y; k++) {
    if (shape === 'steps' && n.z - k * st < 1) break;
    if (shape === 'pyramid' && (n.x - k < 1 || n.z - k < 1)) break;
    L++;
  }
  return L;
}

export const ov1 = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
export const footOv = (a: Box, b: Box) => ov1(a.x0, a.x1, b.x0, b.x1) * ov1(a.z0, a.z1, b.z0, b.z1);

export function unionBox(list: Box[]): Box | null {
  let b: Box | null = null;
  for (const a of list) {
    if (!b) b = { ...a };
    else {
      b.x0 = Math.min(b.x0, a.x0); b.x1 = Math.max(b.x1, a.x1);
      b.y0 = Math.min(b.y0, a.y0); b.y1 = Math.max(b.y1, a.y1);
      b.z0 = Math.min(b.z0, a.z0); b.z1 = Math.max(b.z1, a.z1);
    }
  }
  return b;
}

export const overlaps3 = (a: Box, b: Box, t = 0.3) =>
  ov1(a.x0, a.x1, b.x0, b.x1) > t && ov1(a.y0, a.y1, b.y0, b.y1) > t && ov1(a.z0, a.z1, b.z0, b.z1) > t;
