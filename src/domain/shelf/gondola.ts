// Gondola / shelf system (legacy SHELF section). A bay = one 'fixture' (back panel + uprights + kick plate, not
// load-bearing) + several 'shelf' objects (load-bearing, linked by shelf.fixture, heights on the notch pitch).
// Products on a shelf are ordinary 'sku'/'array' objects: facings = n.x, stack = n.y, depth = n.z.
import { footOv, isRightAngle, ov1, quarter, skuDims, unionBox } from '../geometry';
import { L } from '../i18n';
import { keepCorner } from '../ops/corner';
import type { GondolaPreset } from '../presets';
import { isStock, type Scene } from '../scene';
import type { ArrayObj, Design, FixtureObj, SceneObject, ShelfObj, SkuObj } from '../types';
import { clamp, R2, uid } from '../util';
import { emptyShelfDesign } from '../design';

export type BayParams = Pick<GondolaPreset, 'w' | 'h' | 'd' | 'baseD' | 'kick' | 'n' | 'pitch' | 't'>;

export function shelfTops(p: BayParams) {
  const n = Math.max(1, p.n | 0), tops = [p.kick];
  if (n > 1) { const span = p.h - 30 - p.kick, step = span / (n - 1); for (let i = 1; i < n; i++) tops.push(p.kick + Math.round((i * step) / p.pitch) * p.pitch); }
  return tops;
}

/** One bay with its back-left corner at (x0, z0). */
export function bayObjects(p: BayParams, x0: number, z0: number, idx: number): SceneObject[] {
  const panel = 2, D0 = p.baseD + panel;
  const fx: FixtureObj = { id: uid('f'), type: 'fixture', name: 'Bay ' + idx, size: { w: p.w, d: D0, h: p.h }, pos: { x: R2(x0 + p.w / 2), y: 0, z: R2(z0 + D0 / 2) }, ry: 0, lock: true, fx: { pitch: p.pitch, panel, kick: p.kick } };
  const out: SceneObject[] = [fx];
  shelfTops(p).forEach((top, i) => {
    const d = i === 0 ? p.baseD : p.d;
    out.push({ id: uid('s'), type: 'shelf', name: (i === 0 ? L('Đế', 'Base') : L('Kệ ', 'Shelf ') + (i + 1)) + ' · ' + fx.name, fixture: fx.id, size: { w: p.w, d, h: p.t }, pos: { x: R2(x0 + p.w / 2), y: R2(top - p.t), z: R2(z0 + panel + d / 2) }, ry: 0 } as ShelfObj);
  });
  return out;
}

/** Adds `bays` bays to the right of the existing run (mutates). */
export function addGondola(s: Scene, p: BayParams, bays: number) {
  const D = s.d;
  const sb = D.objects.filter((o) => o.type === 'fixture').map((o) => s.aabb(o));
  const u = unionBox(sb), x0 = u ? u.x1 : 0, z0 = u ? u.z0 : 0, n0 = D.objects.filter((o) => o.type === 'fixture').length;
  for (let i = 0; i < bays; i++) D.objects.push(...bayObjects(p, x0 + i * p.w, z0, n0 + i + 1));
  D.settings.maxH = Math.max(D.settings.maxH || 0, p.h);
  s.invalidate();
}

export function newShelfDesign(p: BayParams, bays: number): Design {
  const d = emptyShelfDesign();
  d.settings.maxH = p.h;
  for (let i = 0; i < bays; i++) d.objects.push(...bayObjects(p, i * p.w, 0, i + 1));
  return d;
}

/** Notch snapping for a shelf: returns the snapped bottom y. */
export function notchY(s: Scene, sh: ShelfObj, y: number) {
  const f = sh.fixture ? (s.get(sh.fixture) as FixtureObj | undefined) : undefined;
  if (!f || !f.fx || !(f.fx.pitch > 0)) return y;
  const top = y + sh.size.h, k = Math.round((top - f.fx.kick) / f.fx.pitch);
  return Math.max(0, f.fx.kick + k * f.fx.pitch) - sh.size.h;
}

/** Everything that rides on the given objects: shelves of a moved fixture, then whatever rests on them (recursively). */
export function ridersOf(s: Scene, seed: Iterable<string>) {
  const set = new Set(seed);
  for (const o of s.d.objects) if (o.type === 'shelf' && o.fixture && set.has(o.fixture)) set.add(o.id);
  const cand = s.d.objects.filter((o) => !set.has(o.id) && o.type !== 'fixture' && o.type !== 'pallet').map((o) => ({ o, b: s.aabb(o) })).filter((c) => c.b.y0 > 0.3);
  let grown = true;
  const tops = () => { const a = []; for (const id of set) { const x = s.get(id); if (x) for (const q of s.solids(x)) a.push(q); } return a; };
  while (grown) {
    grown = false;
    const T = tops();
    for (const c of cand) { if (set.has(c.o.id)) continue; if (T.some((q) => Math.abs(q.y1 - c.b.y0) < 0.6 && footOv(c.b, q) > 0.25)) { set.add(c.o.id); grown = true; } }
  }
  return set;
}

/** Products standing directly on a shelf (sorted left → right). */
export function shelfDirect(s: Scene, sh: SceneObject) {
  const t = s.aabb(sh);
  return s.d.objects.filter((o) => o !== sh && (isStock(o) || o.type === 'prop') && (() => { const b = s.aabb(o); return Math.abs(b.y0 - t.y1) < 0.6 && footOv(b, t) > 0.25; })())
    .sort((a, b) => s.aabb(a).x0 - s.aabb(b).x0);
}

export function shiftWithRiders(s: Scene, o: SceneObject, dx: number, dz = 0) {
  for (const id of ridersOf(s, [o.id])) { const q = s.get(id)!; q.pos.x = R2(q.pos.x + dx); q.pos.z = R2(q.pos.z + dz); }
  s.invalidateGeom();
}

export function packShelf(s: Scene, sh: SceneObject, mode: 'L' | 'R' | 'D') {
  const items = shelfDirect(s, sh);
  if (!items.length) return;
  const t = s.aabb(sh);
  const ws = items.map((o) => { const b = s.aabb(o); return b.x1 - b.x0; }), tot = ws.reduce((a, b) => a + b, 0);
  let x = mode === 'R' ? t.x1 - tot : t.x0;
  const gap = mode === 'D' ? Math.max(0, (t.x1 - t.x0 - tot) / (items.length + 1)) : 0;
  if (mode === 'D') x += gap;
  items.forEach((o, i) => { const b = s.aabb(o); shiftWithRiders(s, o, x - b.x0); x += ws[i] + gap; });
}

/** Single product → a 1×1×1 facing block (same id, same place) so it can take facings/stack. */
export function toArray(o: SkuObj): ArrayObj {
  return { id: o.id, type: 'array', sku: o.sku, n: { x: 1, y: 1, z: 1 }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: quarter(o.ry || 0) * 90, ry: 0, anchor: { x: -1, z: 1 }, pos: { ...o.pos } };
}

export function asArray(s: Scene, o: SceneObject): ArrayObj | null {
  if (o.type === 'array') return o;
  if (o.type !== 'sku' || !isRightAngle(o.ry || 0)) return null;
  const a = toArray(o);
  s.d.objects[s.d.objects.indexOf(o)] = a;
  s.invalidate();
  return a;
}

/** Fill the shelf depth: every product on the shelf becomes a facing block whose rows reach the shelf depth, front-aligned. */
export function fillDepth(s: Scene, sh: SceneObject) {
  const items = shelfDirect(s, sh).filter(isStock);
  if (!items.length) return;
  const t = s.aabb(sh);
  for (let o0 of items) {
    let o: SceneObject = o0;
    if (o.type === 'sku') { if (!isRightAngle(o.ry || 0)) continue; const a = toArray(o); s.d.objects[s.d.objects.indexOf(o)] = a; s.invalidate(); o = a; }
    const a = o as ArrayObj;
    const c = skuDims(s.skuOf(a), a.cellRy || 0), gz = a.gap.z || 0, nz = Math.max(1, Math.floor((t.z1 - t.z0 + gz) / (c.d + gz)));
    const b0 = s.aabb(a);
    a.n.z = nz;
    const b1 = s.aabb(a);
    a.pos.x = R2(a.pos.x + b0.x0 - b1.x0);
    a.pos.z = R2(a.pos.z + t.z1 - b1.z1);
  }
  s.invalidateGeom();
}

/** Fill depth for one block standing on a shelf. */
export function fillOne(s: Scene, o: ArrayObj) {
  const sh = shelfUnder(s, o);
  if (!sh) return;
  const t0 = s.aabb(sh), c = skuDims(s.skuOf(o), o.cellRy || 0), gz = o.gap.z || 0;
  const b0 = s.aabb(o);
  o.n.z = Math.max(1, Math.floor((t0.z1 - t0.z0 + gz) / (c.d + gz)));
  const b1 = s.aabb(o);
  o.pos.x = R2(o.pos.x + b0.x0 - b1.x0);
  o.pos.z = R2(o.pos.z + t0.z1 - b1.z1);
}

/** A fresh product dropped on a shelf becomes a 1-facing block that fills the depth (front-aligned). */
export function shelfBlock(s: Scene, o: SkuObj, sh: SceneObject): SceneObject {
  const k = s.skuOf(o);
  if (!k || !sh) return o;
  const t = s.aabb(sh), c = skuDims(k, o.ry || 0), nz = Math.max(1, Math.floor((t.z1 - t.z0) / c.d));
  const a: ArrayObj = { id: o.id, type: 'array', sku: o.sku, n: { x: 1, y: 1, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: quarter(o.ry || 0) * 90, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: o.pos.x, y: o.pos.y, z: 0 } };
  const S = s.localSize(a);
  a.pos.z = R2(t.z1 - S.d / 2);
  return a;
}

export function shelfUnder(s: Scene, o: SceneObject): ShelfObj | null {
  const b = s.aabb(o);
  let best: ShelfObj | null = null, bo = 0.25;
  for (const x of s.d.objects) {
    if (x.type !== 'shelf') continue;
    const t = s.aabb(x);
    if (Math.abs(t.y1 - b.y0) < 0.6) { const v = footOv(b, t); if (v > bo) { bo = v; best = x; } }
  }
  return best;
}

// ---------- physical limits on a shelf: facings / stack / depth never pass the next product, the shelf end,
// the shelf above (or the top of the bay) and the back panel ----------
export function shelfRun(s: Scene, sh: ShelfObj) {
  const t = s.aabb(sh);
  let x0 = t.x0, x1 = t.x1, grown = true;
  const same = s.d.objects.filter((x) => x.type === 'shelf' && x !== sh).map((x) => s.aabb(x)).filter((q) => Math.abs(q.y1 - t.y1) < 0.6 && ov1(q.z0, q.z1, t.z0, t.z1) > 1);
  while (grown) {
    grown = false;
    for (const q of same) {
      if (q.x0 < x1 + 1.01 && q.x0 > x1 - 1 && q.x1 > x1) { x1 = q.x1; grown = true; }
      if (q.x1 > x0 - 1.01 && q.x1 < x0 + 1 && q.x0 < x0) { x0 = q.x0; grown = true; }
    }
  }
  return { x0, x1, y: t.y1 };
}

export function shelfLimits(s: Scene, o: SceneObject) {
  const sh = shelfUnder(s, o);
  if (!sh) return null;
  const t = s.aabb(sh), b = s.aabb(o), c = skuDims(s.skuOf(o), o.type === 'array' ? o.cellRy || 0 : o.ry || 0), g = (o as ArrayObj).gap || { x: 0, y: 0, z: 0 };
  let ceil = Infinity, ceilBy: SceneObject | null = null;
  for (const x of s.d.objects) {
    if (x.type !== 'shelf' || x === sh) continue;
    const q = s.aabb(x);
    if (q.y0 >= t.y1 - 0.1 && footOv(b, q) > 0.25 && q.y0 < ceil) { ceil = q.y0; ceilBy = x; }
  }
  if (ceil === Infinity) { const f = sh.fixture ? s.get(sh.fixture) : undefined; ceil = f ? s.aabb(f).y1 : s.d.settings.maxH || 250; }
  const run = shelfRun(s, sh), mid = (b.x0 + b.x1) / 2;
  let right = run.x1, left = run.x0;
  for (const q of s.d.objects) {
    if (q === o || !(isStock(q) || q.type === 'prop')) continue;
    const a = s.aabb(q);
    if (Math.abs(a.y0 - t.y1) > 0.6 || a.x1 < run.x0 - 1 || a.x0 > run.x1 + 1 || ov1(a.z0, a.z1, b.z0, b.z1) <= 0) continue;
    const m = (a.x0 + a.x1) / 2;
    if (m > mid) right = Math.min(right, a.x0); else left = Math.max(left, a.x1);
  }
  const an = ((o as ArrayObj).anchor || { x: -1 }).x, availX = an > 0 ? b.x1 - left : right - b.x0;
  const per = (len: number, sz: number, gg: number) => Math.max(1, Math.floor((len + gg + 1e-6) / (sz + gg)));
  return { x: per(availX, c.w, g.x), y: per(ceil - b.y0, c.h, g.y), z: per(t.z1 - t.z0, c.d, g.z), ceilBy };
}

/** Change facings / stack / depth of products; clamps at the physical limit and returns why (or null). */
export function setCount(s: Scene, ids: string[], axis: 'x' | 'y' | 'z', fn: (cur: number) => number): string | null {
  let msg: string | null = null;
  for (const id of ids) {
    let o = s.get(id);
    if (!o || !isStock(o) || o.lock) continue;
    const a = asArray(s, o);
    if (!a) continue;
    const an = a.anchor || { x: -1, z: 1 };
    const cur = a.n[axis];
    let want = clamp(Math.round(fn(cur)), 1, axis === 'y' ? 100 : 200);
    const lim = shelfLimits(s, a);
    if (lim && want > cur && want > lim[axis]) {
      want = Math.max(cur, lim[axis]);
      msg = axis === 'x' ? L(`Tối đa ${lim.x} facing – hết chỗ trên kệ`, `Max ${lim.x} facings – no more room on the shelf`)
        : axis === 'y' ? L(`Tối đa ${lim.y} tầng – chạm ${lim.ceilBy ? lim.ceilBy.name : 'đỉnh bay'}`, `Max ${lim.y} levels – would hit ${lim.ceilBy ? lim.ceilBy.name : 'the top of the bay'}`)
        : L(`Tối đa ${lim.z} hàng sâu – chạm tấm lưng kệ`, `Max ${lim.z} rows deep – would hit the back panel`);
    }
    keepCorner(s, a, an.x, an.z, () => { a.n[axis] = want; });
    s.invalidateGeom();
  }
  return msg;
}

/** Bay width change: shelves of the bay follow; everything to the right of the bay shifts so bays stay touching. */
export function resizeBay(s: Scene, f: FixtureObj, w: number) {
  const b = s.aabb(f), dw = w - f.size.w;
  if (Math.abs(dw) < 1e-6) return;
  const right = s.d.objects.filter((o) => o !== f && s.aabb(o).x0 >= b.x1 - 0.5).map((o) => o.id), move = ridersOf(s, right);
  for (const id of move) { const o = s.get(id)!; if (o.type === 'shelf' && o.fixture === f.id) continue; o.pos.x = R2(o.pos.x + dw); }
  keepCorner(s, f, -1, -1, () => { f.size.w = w; });
  for (const x of s.d.objects) if (x.type === 'shelf' && x.fixture === f.id) keepCorner(s, x, -1, -1, () => { x.size.w = w; });
  s.invalidate();
}

export function deleteBay(s: Scene, f: FixtureObj) {
  const b = s.aabb(f), gone = ridersOf(s, [f.id]), w = b.x1 - b.x0;
  s.d.objects = s.d.objects.filter((o) => !gone.has(o.id));
  s.invalidate();
  for (const o of s.d.objects) if (s.aabb(o).x0 >= b.x1 - 0.5) o.pos.x = R2(o.pos.x - w);
  s.invalidate();
}

/** New shelf in the largest vertical gap of a bay, snapped to the notch pitch. Returns the shelf. */
export function addShelf(s: Scene, f: FixtureObj, depth = 45, thick = 2.5): ShelfObj {
  const sh = s.d.objects.filter((q): q is ShelfObj => q.type === 'shelf' && q.fixture === f.id).map((q) => s.aabb(q).y1).sort((x, y) => x - y), ex = [...sh, f.size.h];
  let best = 0, at = f.size.h / 2;
  for (let i = 0; i < ex.length - 1; i++) { const g = ex[i + 1] - ex[i]; if (g > best) { best = g; at = (ex[i] + ex[i + 1]) / 2; } }
  const b = s.aabb(f), P = (f.fx && f.fx.panel) || 2;
  const ns: ShelfObj = { id: uid('s'), type: 'shelf', name: L('Kệ mới', 'New shelf') + ' · ' + f.name, fixture: f.id, size: { w: f.size.w, d: depth, h: thick }, pos: { x: R2((b.x0 + b.x1) / 2), y: 0, z: R2(b.z0 + P + depth / 2) }, ry: 0 };
  ns.pos.y = R2(notchY(s, ns, at - thick));
  s.d.objects.push(ns);
  s.invalidate();
  return ns;
}

/** Move a shelf to a top height (snapped); riders follow when carry is on. Returns false when nothing changed. */
export function setShelfTop(s: Scene, o: ShelfObj, top: number, carry: boolean) {
  const ny = notchY(s, o, (+top || 0) - o.size.h), dy = ny - o.pos.y;
  if (Math.abs(dy) < 1e-6) return false;
  const ids = carry ? ridersOf(s, [o.id]) : new Set([o.id]);
  for (const id of ids) { const q = s.get(id)!; q.pos.y = R2(q.pos.y + dy); }
  s.invalidateGeom();
  return true;
}
