// Pallet displays: "Xếp viền rỗng ruột" hollow shell, core fill, pallet resize (legacy SHELL section, unchanged maths).
// Each exposed side of a pallet gets a 1-carton-deep wall (front face of the carton outward, rotated cartons only to
// close the gap), the inside stays empty. Sides touching another pallet are left open (an island is hollow inside).
// Optional top layer: a 1.2 cm deck board on the walls and one full layer of cartons on it.
import { arrayCount, footOv, ov1 } from '../geometry';
import { L } from '../i18n';
import { keepCorner } from '../ops/corner';
import { isDeck, isStock, Scene } from '../scene';
import type { ArrayObj, Box, PalletObj, SceneObject, Sku } from '../types';
import { R2, uid } from '../util';

export const DECK_T = 1.2;

/** Pallets the shell applies to: the selected pallets, or pallets under the selected products, else all pallets. */
export function shellPallets(s: Scene, sel: SceneObject[]): PalletObj[] {
  const all = s.d.objects.filter((o): o is PalletObj => o.type === 'pallet' && !isDeck(o));
  const picked = new Set<PalletObj>();
  for (const o of sel) {
    if (o.type === 'pallet' && !isDeck(o)) picked.add(o);
    else { const b = s.aabb(o), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; for (const p of all) { const q = s.aabb(p); if (cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1) picked.add(p); } }
  }
  return picked.size ? [...picked] : all;
}

/** Stock (and decks) standing on a pallet: footprint centre inside the pallet, bottom at or above its top. */
export function onPallet(s: Scene, p: PalletObj) {
  const q = s.aabb(p);
  return s.d.objects.filter((o) => (isStock(o) || isDeck(o)) && o !== p && (() => { const b = s.aabb(o), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2; return cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1 && b.y0 >= q.y1 - 1; })());
}

export function exposedSides(s: Scene, p: PalletObj, others: PalletObj[]) {
  const b = s.aabb(p), X = b.x1 - b.x0, Z = b.z1 - b.z0, out = { front: true, back: true, left: true, right: true };
  for (const o of others) {
    if (o === p) continue;
    const q = s.aabb(o);
    if (ov1(b.x0, b.x1, q.x0, q.x1) > X * 0.5) { if (Math.abs(q.z0 - b.z1) < 2) out.front = false; if (Math.abs(q.z1 - b.z0) < 2) out.back = false; }
    if (ov1(b.z0, b.z1, q.z0, q.z1) > Z * 0.5) { if (Math.abs(q.x0 - b.x1) < 2) out.right = false; if (Math.abs(q.x1 - b.x0) < 2) out.left = false; }
  }
  return out;
}

/** Best mix of front-out cells (length fw) and side-out cells (length sw) along a run of length L. */
export function runMix(Ln: number, fw: number, sw: number) {
  let best: { a: number; b: number; len: number } | null = null;
  for (let a = Math.floor((Ln + 0.01) / fw); a >= 0; a--) {
    const b = Math.max(0, Math.floor((Ln - a * fw + 0.01) / sw)), len = a * fw + b * sw;
    if (!best || len > best.len + 1) best = { a, b, len };
  }
  return best!;
}

type Side = 'front' | 'back' | 'left' | 'right';
const SIDE_LABEL: Record<Side, [string, string]> = { front: ['trước', 'front'], back: ['sau', 'back'], left: ['trái', 'left'], right: ['phải', 'right'] };

/** Lay one wall. u0..u1 = run along the wall; edge = outer coordinate. */
export function wallRun(k: Sku, side: Side, u0: number, u1: number, edge: number, y: number, ny: number) {
  const base = { front: 0, right: 90, back: 180, left: 270 }[side], along = side === 'front' || side === 'back', out = side === 'front' || side === 'right' ? 1 : -1;
  const fw = +k.w, fd = +k.d, Ln = u1 - u0, m = runMix(Ln, fw, fd);
  if (!m.a && !m.b) return { objs: [] as ArrayObj[], d0: 0, d1: 0 };
  const a1 = Math.ceil(m.a / 2), a2 = m.a - a1, segs: [number, boolean][] = [];
  if (a1) segs.push([a1, true]);
  if (m.b) segs.push([m.b, false]);
  if (a2) segs.push([a2, true]);
  const len = (sg: [number, boolean]) => sg[0] * (sg[1] ? fw : fd), dep = (sg: [number, boolean]) => (sg[1] ? fd : fw), objs: ArrayObj[] = [];
  const pos: number[] = [];
  if (segs.length === 1) pos.push(u0);
  else { pos[0] = u0; pos[segs.length - 1] = u1 - len(segs[segs.length - 1]); if (segs.length === 3) pos[1] = (pos[0] + len(segs[0]) + pos[2]) / 2 - len(segs[1]) / 2; }
  segs.forEach((sg, i) => {
    const n = sg[0], d = dep(sg), l = len(sg), cu = pos[i] + l / 2, cn = edge - (out * d) / 2, cellRy = (base + (sg[1] ? 0 : 90)) % 360;
    objs.push({
      id: uid(), type: 'array', sku: k.id, n: along ? { x: n, y: ny, z: 1 } : { x: 1, y: ny, z: n }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy, ry: 0, anchor: { x: -1, z: 1 },
      pos: along ? { x: R2(cu), y: R2(y), z: R2(cn) } : { x: R2(cn), y: R2(y), z: R2(cu) }, name: L('Viền ', 'Wall ') + L(SIDE_LABEL[side][0], SIDE_LABEL[side][1]),
    });
  });
  const band = Math.max(fw, fd);
  let d0 = 0, d1 = 0;
  segs.forEach((sg, i) => { const a = pos[i], e = a + len(sg); if (a < u0 + band - 0.01) d0 = Math.max(d0, dep(sg)); if (e > u1 - band + 0.01) d1 = Math.max(d1, dep(sg)); });
  return { objs, d0, d1 };
}

/** One full layer of cartons on top. */
export function lidLayer(k: Sku, b: Box, y: number, ex: Record<Side, boolean>) {
  const X = b.x1 - b.x0, Z = b.z1 - b.z0, back = ex.back && !ex.front, r0 = back ? 180 : 0;
  const m = runMix(X, +k.w, +k.d), out: ArrayObj[] = [];
  const nzA = Math.floor((Z + 0.01) / k.d), nzB = Math.floor((Z + 0.01) / k.w);
  const zOf = (depth: number) => (ex.front && !ex.back ? b.z1 - depth / 2 : back ? b.z0 + depth / 2 : (b.z0 + b.z1) / 2);
  const leftFirst = !(ex.right && !ex.left);
  let x = leftFirst ? b.x0 : b.x1;
  const put = (n: number, cellRy: number, cw: number, nz: number, cd: number) => {
    if (!n || !nz) return;
    const w = n * cw, cx = leftFirst ? x + w / 2 : x - w / 2;
    x += leftFirst ? w : -w;
    out.push({ id: uid(), type: 'array', sku: k.id, n: { x: n, y: 1, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: R2(cx), y: R2(y), z: R2(zOf(nz * cd)) }, name: L('Nắp tầng trên', 'Top layer') });
  };
  put(m.a, r0, +k.w, nzA, +k.d);
  put(m.b, (r0 + 90) % 360, +k.d, nzB, +k.w);
  return out;
}

export interface ShellOptions { skuPerSide?: Partial<Record<Side | 'lid', string>> | null; sku?: string | null; levels: number; lid: boolean; sides: 'outer' | 'all'; replace?: boolean }

/** Build the shell objects for one pallet. getSku resolves (and snapshots) a SKU id into the design. */
export function shellFor(s: Scene, p: PalletObj, opt: ShellOptions, others: PalletObj[], getSkuById: (id: string) => Sku | null) {
  const getSku = (face: Side | 'lid') => { const id = (opt.skuPerSide && opt.skuPerSide[face]) || opt.sku; return id ? getSkuById(id) : null; };
  const kFront = getSku('front'), kBack = getSku('back'), kLeft = getSku('left'), kRight = getSku('right'), kLid = getSku('lid');
  const kAny = kFront || kBack || kLeft || kRight;
  if (!kAny) return { objs: [] as SceneObject[], n: 0, top: 0 };
  const b = s.aabb(p), y = b.y1;
  const ex = opt.sides === 'all' ? { front: true, back: true, left: true, right: true } : exposedSides(s, p, others);
  const hRef = Math.max(...[kFront, kBack, kLeft, kRight].filter((k): k is Sku => !!k).map((k) => +k.h));
  const lid = opt.lid && opt.levels > 1, ny = lid ? opt.levels - 1 : opt.levels, objs: SceneObject[] = [];
  let dF = { d0: 0, d1: 0 }, dB = { d0: 0, d1: 0 };
  if (ex.front && kFront) { const r = wallRun(kFront, 'front', b.x0, b.x1, b.z1, y, ny); objs.push(...r.objs); dF = r; }
  if (ex.back && kBack) { const r = wallRun(kBack, 'back', b.x0, b.x1, b.z0, y, ny); objs.push(...r.objs); dB = r; }
  if (ex.left && kLeft) { const r = wallRun(kLeft, 'left', b.z0 + dB.d0, b.z1 - dF.d0, b.x0, y, ny); objs.push(...r.objs); }
  if (ex.right && kRight) { const r = wallRun(kRight, 'right', b.z0 + dB.d1, b.z1 - dF.d1, b.x1, y, ny); objs.push(...r.objs); }
  if (lid && kLid) {
    const top = y + ny * hRef;
    objs.push({ id: uid('p'), type: 'pallet', subtype: 'deck', name: L('Tấm ván đỡ nắp (ruột rỗng)', 'Deck board (hollow core)'), size: { w: R2(b.x1 - b.x0), d: R2(b.z1 - b.z0), h: DECK_T }, pos: { x: R2((b.x0 + b.x1) / 2), y: R2(top), z: R2((b.z0 + b.z1) / 2) }, ry: 0, lock: true });
    objs.push(...lidLayer(kLid, b, top + DECK_T, ex));
  }
  // count / top need the objects' geometry: evaluate with a temporary scene view
  const n = objs.filter(isStock).reduce((a, o) => a + (o.type === 'array' ? arrayCount(o) : 1), 0);
  const tmp = new Scene({ ...s.d, objects: objs });
  const top = objs.length ? Math.max(...objs.map((o) => tmp.aabb(o).y1)) : y;
  return { objs, n, top };
}

export function dominantSku(s: Scene, p: PalletObj) {
  const by = new Map<string, number>();
  for (const o of onPallet(s, p)) if (isStock(o)) by.set(o.sku, (by.get(o.sku) || 0) + (o.type === 'array' ? arrayCount(o) : 1));
  let best: string | null = null, n = -1;
  for (const [k, c] of by) if (c > n) { best = k; n = c; }
  return best;
}
export function curLevels(s: Scene, p: PalletObj, k: Sku | null) {
  const st = onPallet(s, p).filter(isStock);
  if (!st.length || !k) return 0;
  const top = Math.max(...st.map((o) => s.aabb(o).y1));
  return Math.max(1, Math.round((top - s.aabb(p).y1) / k.h));
}
export function maxLevels(s: Scene, p: PalletObj, k: Sku | null, lid: boolean) {
  const b = s.aabb(p), room = (+s.d.settings.maxH || 200) - b.y1;
  if (!k) return 1;
  return Math.max(1, Math.floor((room - (lid ? DECK_T : 0) + 0.01) / k.h));
}

export interface ShellPlanItem { pid: string; sku: string | null; skuPerSide?: ShellOptions['skuPerSide']; levels: number }
/** Replace what stands on each pallet by its shell. Returns ids of created stock. */
export function applyShell(s: Scene, plan: ShellPlanItem[], opt: Omit<ShellOptions, 'levels' | 'sku' | 'skuPerSide'>, getSkuById: (id: string) => Sku | null) {
  const all = s.d.objects.filter((o): o is PalletObj => o.type === 'pallet' && !isDeck(o));
  const made: string[] = [], lifted = new Set<string>();
  for (const it of plan) {
    const p = s.get(it.pid) as PalletObj | undefined;
    if (!p) continue;
    const old = onPallet(s, p), oldTop = old.length ? Math.max(...old.map((o) => s.aabb(o).y1)) : s.aabb(p).y1;
    const r = shellFor(s, p, { ...opt, sku: it.sku, skuPerSide: it.skuPerSide || null, levels: it.levels }, all, getSkuById);
    if (!r.objs.length) continue;
    if (opt.replace) { const rm = new Set(old.map((o) => o.id)); s.d.objects = s.d.objects.filter((o) => !rm.has(o.id)); s.invalidate(); }
    const dy = r.top - oldTop, q = s.aabb(p);
    if (opt.replace && Math.abs(dy) > 0.05) for (const o of s.d.objects) {
      if (o.type !== 'posm' && o.type !== 'prop') continue;
      const b = s.aabb(o);
      if (b.y0 >= oldTop - 0.6 && ov1(b.x0, b.x1, q.x0, q.x1) > 0.1 && ov1(b.z0, b.z1, q.z0, q.z1) > 0.1 && !lifted.has(o.id)) { o.pos.y = R2(o.pos.y + dy); lifted.add(o.id); }
    }
    s.d.objects.push(...r.objs);
    s.invalidate();
    made.push(...r.objs.map((o) => o.id));
  }
  return made.filter((id) => { const o = s.get(id); return o && !isDeck(o); });
}

/** Fill the hollow core of shell pallets with a SKU (legacy autoFillPallet). Returns created objects (not yet added). */
export function autoFillCore(s: Scene, pallets: PalletObj[], inner: Sku, outer: Sku | null): ArrayObj[] {
  const all = s.d.objects.filter((o): o is PalletObj => o.type === 'pallet' && !isDeck(o));
  const made: ArrayObj[] = [];
  for (const p of pallets) {
    const b = s.aabb(p);
    const walls = onPallet(s, p).filter(isStock);
    if (!walls.length) continue;
    const ex = exposedSides(s, p, all), shellD = outer ? +outer.d : +inner.d;
    const x0 = R2(b.x0 + (ex.left ? shellD : 0)), x1 = R2(b.x1 - (ex.right ? shellD : 0)), z0 = R2(b.z0 + (ex.back ? shellD : 0)), z1 = R2(b.z1 - (ex.front ? shellD : 0));
    const W = R2(x1 - x0), Dp = R2(z1 - z0);
    if (W <= 0 || Dp <= 0) continue;
    const nx = Math.floor((W + 0.01) / +inner.w), nz = Math.floor((Dp + 0.01) / +inner.d);
    if (!nx || !nz) continue;
    const topWall = Math.max(...walls.map((o) => s.aabb(o).y1));
    const ny = Math.max(1, Math.round((topWall - b.y1) / +inner.h));
    made.push({ id: uid(), type: 'array', sku: inner.id, n: { x: nx, y: ny, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: 0, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: R2(x0 + (nx * inner.w) / 2), y: R2(b.y1), z: R2(z0 + (nz * inner.d) / 2) }, name: L('Ruột pallet', 'Pallet core') });
  }
  return made;
}

/** Pallet resize keeps its back-left corner; products standing on top follow a height change when `follow`. */
export function resizePallet(s: Scene, p: PalletObj, w: number, d: number, h: number, follow: boolean) {
  const oldTop = p.pos.y + p.size.h, dh = h - p.size.h, b0 = s.aabb(p);
  keepCorner(s, p, -1, -1, () => { p.size = { w, d, h }; });
  if (follow && Math.abs(dh) > 1e-6) for (const o of s.d.objects) {
    if (o === p || o.lock) continue;
    const b = s.aabb(o);
    if (b.y0 >= oldTop - 0.6 && footOv(b, b0) > 0) o.pos.y = R2(o.pos.y + dh);
  }
  s.invalidate();
}
