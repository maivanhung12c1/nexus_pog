// AUTO POG PROPOSAL (legacy apShelves / apCurrent / apShares / apOrder / apBounds / apLayBlock / apBuild), unchanged rules:
// Decision tree: Zone (level 1, e.g. sub-category) → Block (level 2, e.g. maker or brand) → products inside the block.
// Every block is a VERTICAL block: one x-range of the gondola through all shelves, wide enough for its target share of
// shelf cm. Inside a block: big packs to the bottom shelves, priority products to the golden zone, the rest by size;
// facings follow the chosen weight (sales / current / equal) within min–max, then each shelf is filled edge to edge.
import { fmt, L } from '../i18n';
import { isStock, Scene } from '../scene';
import { shelfLayout } from '../shelf/layout';
import type { ArrayObj, Design, ShelfObj, Sku } from '../types';
import { deep, norm, poolKey, R2, uid } from '../util';
import { ov1 } from '../geometry';
import { positions, rpVal } from './spaceShare';

export interface AutoPogConfig {
  zone: string;          // 'none' | dim
  block: string;         // dim
  order: 'cdt' | 'cur';
  flow: 'ltr' | 'rtl';
  focus: string;
  focusAt: 'first' | 'share';
  gz0: number; gz1: number;
  big: number;
  weight: 'sales' | 'cur' | 'eq';
  fmin: number; fmax: number;
  snap: boolean;
  stack: boolean;
  scen: { cur: boolean; sales: boolean; target: boolean };
  target: Record<string, number>; // block key → target %
}

export const AUTO_POG_DEFAULTS: AutoPogConfig = {
  zone: 'sub', block: 'maker', order: 'cdt', flow: 'ltr', focus: 'SPVB', focusAt: 'first', gz0: 100, gz1: 160, big: 28, weight: 'sales',
  fmin: 1, fmax: 12, snap: true, stack: false, scen: { cur: true, sales: false, target: true }, target: {},
};

export type ScenarioMode = 'cur' | 'sales' | 'target';
export const SCENARIO_LABEL: Record<ScenarioMode, string> = { cur: 'ĐỀ XUẤT A (giữ share)', sales: 'ĐỀ XUẤT B (fair share)', target: 'ĐỀ XUẤT C (share mục tiêu)' };

const apKey = (k: Sku, f: string) => (f === 'none' ? '—' : rpVal(k, f));

export interface Seg { sh: ShelfObj; bay: number; seg: number; x0: number; x1: number; top: number; clear: number; depth: number; z0: number; z1: number }
export interface ShelfSegs { segs: Seg[]; total: number; X0: number; X1: number; bayEdges: number[] }

/** Shelves of the design as segments, with the clearance above each. */
export function apShelves(s: Scene): ShelfSegs | null {
  const M = shelfLayout(s);
  if (!M) return null;
  const segs: Seg[] = [];
  for (const y of M.bays) y.shelves.forEach((e, i) => {
    const b = e.b, up = y.shelves[i + 1];
    const clear = up ? up.b.y0 - b.y1 : Math.max(15, Math.max(y.b.y1, s.d.settings.maxH || 0) - b.y1);
    segs.push({ sh: e.s, bay: y.num, seg: y.seg, x0: b.x0, x1: b.x1, top: b.y1, clear, depth: b.z1 - b.z0, z0: b.z0, z1: b.z1 });
  });
  // clearance = room up to the nearest shelf above that overlaps in x (bays may not be modelled as fixtures)
  const all = segs.map((g) => ({ g, b: s.aabb(g.sh) }));
  for (const g of segs) { const b = s.aabb(g.sh); const ups = all.filter((o) => o.g !== g && o.b.y0 > b.y1 - 0.5 && ov1(o.b.x0, o.b.x1, b.x0, b.x1) > 5).map((o) => o.b.y0 - b.y1); if (ups.length) g.clear = Math.min(...ups); }
  return { segs, total: segs.reduce((a, g) => a + g.x1 - g.x0, 0), X0: Math.min(...segs.map((g) => g.x0)), X1: Math.max(...segs.map((g) => g.x1)), bayEdges: [...new Set(M.bays.flatMap((y) => [y.b.x0, y.b.x1]))].sort((a, b) => a - b) };
}

export interface CurItem { k: Sku; lin: number; fac: number; x: number }
/** What is on the shelf now: per SKU facings / linear / mean x (for "keep the current order"). */
export function apCurrent(d: Design): CurItem[] {
  const P = positions(d), by = new Map<string, { k: Sku; lin: number; fac: number; xs: number; n: number }>();
  for (const p of P.pos) { const r = by.get(p.k.id) || { k: p.k, lin: 0, fac: 0, xs: 0, n: 0 }; r.lin += p.lin; r.fac += p.fac; r.xs += ((p.x0 + p.x1) / 2) * p.lin; r.n += p.lin; by.set(p.k.id, r); }
  return [...by.values()].map((r) => ({ k: r.k, lin: r.lin, fac: r.fac, x: r.n ? r.xs / r.n : 0 }));
}

export const apSales = (d: Design, k: Sku) => { const sl = (d.settings && d.settings.sales) || {}; return +sl[poolKey(k.code)] || 0; };

/** Target share per block key for a scenario. */
export function apShares(d: Design, cfg: AutoPogConfig, items: CurItem[], mode: ScenarioMode): Record<string, number> {
  const keys = [...new Set(items.map((r) => apKey(r.k, cfg.block)))], out: Record<string, number> = {};
  if (mode === 'cur') { const t = items.reduce((a, r) => a + r.lin, 0) || 1; for (const k of keys) out[k] = items.filter((r) => apKey(r.k, cfg.block) === k).reduce((a, r) => a + r.lin, 0) / t; }
  else if (mode === 'sales') { const t = items.reduce((a, r) => a + apSales(d, r.k), 0); if (!t) return apShares(d, cfg, items, 'cur'); for (const k of keys) out[k] = items.filter((r) => apKey(r.k, cfg.block) === k).reduce((a, r) => a + apSales(d, r.k), 0) / t; }
  else {
    const cur = apShares(d, cfg, items, 'cur');
    let set = 0, rest = 0;
    for (const k of keys) { if (cfg.target[k] > 0) set += cfg.target[k] / 100; else rest += cur[k]; }
    for (const k of keys) out[k] = cfg.target[k] > 0 ? cfg.target[k] / 100 : rest ? (cur[k] / rest) * Math.max(0, 1 - set) : 0;
  }
  const t = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  for (const k in out) out[k] /= t;
  return out;
}

export interface Block { b: string; rs: CurItem[]; x: number; focus: boolean; zone: string; share: number; mixed?: boolean }

/** Order of zones and blocks along the traffic flow; narrow blocks merged with neighbours. */
export function apOrder(d: Design, cfg: AutoPogConfig, items: CurItem[], shares: Record<string, number>, S: ShelfSegs | null, mode: ScenarioMode): Block[] {
  const zones = new Map<string, Map<string, CurItem[]>>();
  for (const r of items) { const z = apKey(r.k, cfg.zone), b = apKey(r.k, cfg.block); if (!zones.has(z)) zones.set(z, new Map()); const m = zones.get(z)!; if (!m.has(b)) m.set(b, []); m.get(b)!.push(r); }
  const posX = (rs: CurItem[]) => { const n = rs.reduce((a, r) => a + r.lin, 0); return n ? rs.reduce((a, r) => a + r.x * r.lin, 0) / n : 0; }, isF = (b: string) => norm(b).includes(norm(cfg.focus));
  const zl = [...zones].map(([z, m]) => ({ z, x: posX([...m.values()].flat()), lin: [...m.values()].flat().reduce((a, r) => a + r.lin, 0), blocks: [...m].map(([b, rs]) => ({ b, rs, x: posX(rs), focus: isF(b) })) }));
  const zFocus = (z: (typeof zl)[number]) => z.blocks.some((b) => b.focus);
  if (cfg.order === 'cur') zl.sort((a, b) => a.x - b.x);
  else zl.sort((a, b) => (cfg.focusAt === 'first' ? +zFocus(b) - +zFocus(a) : 0) || b.lin - a.lin);
  for (const z of zl) { if (cfg.order === 'cur') z.blocks.sort((a, b) => a.x - b.x); else z.blocks.sort((a, b) => (cfg.focusAt === 'first' ? +b.focus - +a.focus : 0) || (shares[b.b] || 0) - (shares[a.b] || 0)); }
  const seq: Block[] = zl.flatMap((z) => z.blocks.map((b) => ({ ...b, zone: z.z, share: 0 })));
  // a block key can appear in several zones: its share is split over them by its current cm (or sales) in each zone
  const base = (b: Block) => (mode === 'sales' ? b.rs.reduce((a, r) => a + apSales(d, r.k), 0) : b.rs.reduce((a, r) => a + r.lin, 0)), tot = new Map<string, number>();
  for (const b of seq) tot.set(b.b, (tot.get(b.b) || 0) + base(b));
  const cnt = new Map<string, number>();
  for (const b of seq) cnt.set(b.b, (cnt.get(b.b) || 0) + 1);
  for (const b of seq) { const t = tot.get(b.b)!; b.share = (shares[b.b] || 0) * (t > 0 ? base(b) / t : 1 / cnt.get(b.b)!); }
  // blocks too narrow for a vertical column (less than ~2 facings of their widest product) are merged with neighbours
  const per = S ? S.total / Math.max(1, S.X1 - S.X0) : 5, out: Block[] = [];
  const wOf = (b: Block) => (b.share * (S ? S.total : 1)) / per, minW = (b: Block) => { const ws = b.rs.map((r) => +r.k.w || 5).sort((x, y) => x - y); return Math.max(15, 1.6 * ws[ws.length >> 1]); };
  for (const z of [...new Set(seq.map((b) => b.zone))]) {
    const bl = seq.filter((b) => b.zone === z), res: Block[] = [];
    let pend: Block | null = null;
    for (const b of bl) {
      if (wOf(b) >= minW(b)) { if (pend) { res.push(pend); pend = null; } res.push(b); }
      else pend = pend ? { ...(pend as Block), b: pend.b + ' + ' + b.b, rs: [...pend.rs, ...b.rs], share: pend.share + b.share, mixed: true, focus: pend.focus || b.focus } : { ...b };
    }
    if (pend) {
      if (wOf(pend) >= minW(pend) || !res.length) res.push(pend);
      else { const t = res[res.length - 1]; res[res.length - 1] = { ...t, b: t.b + ' + ' + pend.b, rs: [...t.rs, ...pend.rs], share: t.share + pend.share, mixed: true }; }
    }
    out.push(...res);
  }
  return cfg.flow === 'rtl' ? out.reverse() : out;
}

/** x boundaries: walk the cumulative shelf length left→right; optionally snap to a bay edge. */
export function apBounds(cfg: AutoPogConfig, S: ShelfSegs, seq: Block[]) {
  const cap = (x: number) => S.segs.reduce((a, g) => a + Math.max(0, Math.min(g.x1, x) - g.x0), 0), total = cap(S.X1);
  const inv = (c: number) => { let lo = S.X0, hi = S.X1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (cap(m) < c) lo = m; else hi = m; } return (lo + hi) / 2; };
  let acc = 0;
  const xs = [S.X0];
  for (const b of seq.slice(0, -1)) {
    acc += (b.share || 0) * total;
    let x = inv(acc);
    if (cfg.snap) { const e = S.bayEdges.find((e2) => Math.abs(e2 - x) < 12); if (e !== undefined && e - xs[xs.length - 1] >= 15) x = e; }
    xs.push(Math.max(xs[xs.length - 1], x));
  }
  xs.push(S.X1);
  return xs;
}

interface LayItem { k: Sku; w: number; h: number; d: number; wt: number; fac: number; place: { s: Seg; n: number }[] }
type LayList = LayItem[] & { free?: Map<Seg, number> };

/** Lay one block into its segments. */
export function apLayBlock(d: Design, cfg: AutoPogConfig, blk: Block, segs: Seg[], warn: string[]): LayList {
  const its: LayList = blk.rs.map((r) => ({ k: r.k, w: +r.k.w, h: +r.k.h, d: +r.k.d, wt: cfg.weight === 'sales' ? apSales(d, r.k) || 0 : 1, fac: 0, place: [] }));
  if (cfg.weight === 'sales' && its.every((i) => !i.wt)) its.forEach((i) => (i.wt = 1));
  if (cfg.weight === 'cur') its.forEach((i, j) => (i.wt = blk.rs[j].fac || 1));
  const cap = segs.reduce((a, g) => a + g.x1 - g.x0, 0);
  if (cap <= 0) { warn.push(L(`Khối ${blk.b}: không còn chỗ`, `Block ${blk.b}: no room`)); return []; }
  // facings: min first, then by weight until the block is full
  its.forEach((i) => (i.fac = cfg.fmin));
  let used = its.reduce((a, i) => a + i.fac * i.w, 0);
  while (used > cap + 0.5 && its.some((i) => i.fac > 1)) { const i = its.filter((x) => x.fac > 1).sort((a, b) => a.wt / a.fac - b.wt / b.fac)[0]; i.fac--; used -= i.w; }
  const wsum = its.reduce((a, i) => a + i.wt, 0) || 1;
  for (const i of its) { const want = Math.min(cfg.fmax, Math.max(cfg.fmin, Math.floor((cap * (i.wt / wsum)) / i.w))); if (used + (want - i.fac) * i.w <= cap + 0.5) { used += (want - i.fac) * i.w; i.fac = want; } }
  // order: big packs bottom, priority to the golden zone, then by height
  const gz = (g: Seg) => { const mid = g.top + Math.min(g.clear, 40) / 2; return mid >= cfg.gz0 && mid <= cfg.gz1 ? 0 : Math.min(Math.abs(mid - cfg.gz0), Math.abs(mid - cfg.gz1)); };
  const bottomUp = [...segs].sort((a, b) => a.top - b.top), golden = [...segs].sort((a, b) => gz(a) - gz(b) || b.top - a.top);
  const big = its.filter((i) => i.h >= cfg.big || i.k.form === 'carton').sort((a, b) => b.h * b.w * b.d - a.h * a.w * a.d), grpOf = (i: LayItem) => (blk.mixed ? apKey(i.k, cfg.block) : '');
  const rest = its.filter((i) => !big.includes(i)).sort((a, b) => grpOf(a).localeCompare(grpOf(b)) || b.wt - a.wt || b.h - a.h);
  const free = new Map(segs.map((g) => [g, g.x1 - g.x0]));
  const put = (i: LayItem, order: Seg[]) => {
    let need = i.fac;
    for (const g of order) { if (!need) break; if (i.h > g.clear + 0.2) continue; const n = Math.min(need, Math.floor((free.get(g)! + 0.05) / i.w)); if (n < 1) continue; i.place.push({ s: g, n }); free.set(g, free.get(g)! - n * i.w); need -= n; }
    if (need === i.fac) { const g = segs.filter((x) => i.h <= x.clear + 0.2 && free.get(x)! >= i.w - 0.05)[0]; if (g) { i.place.push({ s: g, n: 1 }); free.set(g, free.get(g)! - i.w); need = i.fac - 1; } }
    if (need === i.fac) warn.push(L(`${i.k.name}: không xếp được (cao ${fmt(i.h)} cm / thiếu chỗ)`, `${i.k.name}: could not be placed`));
    i.fac -= need;
  };
  for (const i of big) put(i, bottomUp);
  for (const i of rest) put(i, golden);
  // fill each shelf edge to edge: extra facings to what is already on it (heaviest first)
  for (const g of segs) {
    let f = free.get(g)!;
    let on = its.filter((i) => i.place.some((p) => p.s === g)).sort((a, b) => b.wt - a.wt);
    let grow = true;
    if (!on.length && f >= 4) { on = its.filter((i) => i.fac > 0 && i.h <= g.clear + 0.2 && i.w <= f + 0.05).sort((a, b) => b.wt - a.wt || a.h - b.h).slice(0, Math.max(1, Math.floor(f / 40))); on.forEach((i) => i.place.push({ s: g, n: 0 })); }
    while (grow && on.length) { grow = false; for (const i of on) { if (i.w <= f + 0.05 && i.fac < cfg.fmax * 2) { i.place.find((p) => p.s === g)!.n++; i.fac++; f -= i.w; grow = true; } } }
    free.set(g, f);
  }
  its.free = free;
  return its;
}

export interface ScenarioResult { mode: ScenarioMode; label: string; design: Design; shares: Record<string, number>; seq: { b: string; zone: string; x0: number; x1: number }[]; warn: string[]; dropped: CurItem[] }

/** Build one scenario as a new design. */
export function apBuild(d: Design, cfg: AutoPogConfig, mode: ScenarioMode, label: string): ScenarioResult {
  const s = new Scene(d);
  const S = apShelves(s);
  if (!S) throw Error(L('Thiết kế chưa có kệ', 'No shelves in this design'));
  const items = apCurrent(d);
  if (!items.length) throw Error(L('Kệ chưa có sản phẩm để sắp xếp', 'No products on the shelves'));
  const shares = apShares(d, cfg, items, mode), seq = apOrder(d, cfg, items, shares, S, mode), xs = apBounds(cfg, S, seq), warn: string[] = [];
  const nd: Design = deep(d);
  nd.objects = nd.objects.filter((o) => !isStock(o));
  nd.meta = { ...nd.meta, name: (d.meta.name || 'POG') + ' – ' + label, created: Date.now(), updated: Date.now() };
  nd.settings = { ...nd.settings, proposal: { mode, shares, zone: cfg.zone, block: cfg.block } };
  const lay: { blk: Block; segs: Seg[]; its: LayList }[] = [];
  seq.forEach((blk, i) => { const a = xs[i], b = xs[i + 1]; const segs = S.segs.map((g) => ({ ...g, x0: Math.max(g.x0, a), x1: Math.min(g.x1, b) })).filter((g) => g.x1 - g.x0 >= 4); lay.push({ blk, segs, its: apLayBlock(d, cfg, blk, segs, warn) }); });
  // products that found no room in their own block: any shelf left with space in the same zone, then anywhere
  for (const L0 of lay) for (const i of L0.its.filter((x) => x.fac < 1)) {
    const tries = [...lay.filter((q) => q.blk.zone === L0.blk.zone && q !== L0), ...lay.filter((q) => q.blk.zone !== L0.blk.zone)];
    let ok = false;
    for (const q of tries) {
      for (const sg of q.segs) { const f = q.its.free && q.its.free.get(sg); if (f != null && f >= i.w - 0.05 && i.h <= sg.clear + 0.2) { q.its.push({ ...i, fac: 1, place: [{ s: sg, n: 1 }] }); q.its.free!.set(sg, f - i.w); ok = true; break; } }
      if (ok) break;
    }
    if (ok) { const ix = warn.findIndex((w) => w.startsWith(i.k.name)); if (ix >= 0) warn.splice(ix, 1); }
  }
  // place: per shelf segment, products of the block in left→right order (focus/priority first along the flow)
  for (const { segs, its } of lay) for (const g of segs) {
    let x = cfg.flow === 'rtl' ? g.x1 : g.x0;
    const on = its.flatMap((i) => i.place.filter((p) => p.s === g).map((p) => ({ i, n: p.n })));
    for (const { i, n } of on) {
      const W = n * i.w, nz = Math.max(1, Math.floor((g.depth + 0.01) / i.d)), cx = cfg.flow === 'rtl' ? x - W / 2 : x + W / 2;
      x += cfg.flow === 'rtl' ? -W : W;
      let ny = 1;
      if (cfg.stack) ny = Math.max(1, Math.floor((g.clear - 1) / i.h));
      nd.skus[i.k.id] = nd.skus[i.k.id] || deep(i.k);
      const a: ArrayObj = { id: uid(), type: 'array', sku: i.k.id, n: { x: n, y: ny, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: 0, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: R2(cx), y: R2(g.top), z: R2(g.z1 - (nz * i.d) / 2) } };
      nd.objects.push(a);
    }
  }
  const dropped = items.filter((r) => !nd.objects.some((o) => isStock(o) && o.sku === r.k.id));
  return { mode, label, design: nd, shares, seq: seq.map((b, i) => ({ b: b.b, zone: b.zone, x0: xs[i], x1: xs[i + 1] })), warn, dropped };
}

