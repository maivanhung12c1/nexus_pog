// Undo model (legacy snapState / diffState / applyDiff): per-command JSON diff of objects + skus + settings + meta.
// Schema 8 adds the build sheet (sheet) to the diff so Phiếu Dựng edits are undoable.
import type { Design } from './types';

export interface Snap { objs: Map<string, string>; order: string[]; skus: string; settings: string; meta: string; sheet: string }
export interface Diff {
  label: string;
  added: string[]; removed: string[]; changed: [string, string][];
  orderA: string[]; orderB: string[];
  skusA?: string; skusB?: string; setA?: string; setB?: string; metaA?: string; metaB?: string; sheetA?: string; sheetB?: string;
  empty: boolean;
}

export function snapState(D: Design): Snap {
  const m = new Map<string, string>();
  for (const o of D.objects) m.set(o.id, JSON.stringify(o));
  return { objs: m, order: D.objects.map((o) => o.id), skus: JSON.stringify(D.skus), settings: JSON.stringify(D.settings), meta: JSON.stringify({ name: D.meta.name, by: D.meta.by }), sheet: JSON.stringify(D.sheet ?? null) };
}

export function diffState(a: Snap, b: Snap): Diff {
  const added: string[] = [], removed: string[] = [], changed: [string, string][] = [];
  for (const [id, s] of b.objs) { const p = a.objs.get(id); if (p === undefined) added.push(s); else if (p !== s) changed.push([p, s]); }
  for (const [id, s] of a.objs) if (!b.objs.has(id)) removed.push(s);
  const d: Diff = { label: '', added, removed, changed, orderA: a.order, orderB: b.order, empty: false };
  if (a.skus !== b.skus) { d.skusA = a.skus; d.skusB = b.skus; }
  if (a.settings !== b.settings) { d.setA = a.settings; d.setB = b.settings; }
  if (a.meta !== b.meta) { d.metaA = a.meta; d.metaB = b.meta; }
  if (a.sheet !== b.sheet) { d.sheetA = a.sheet; d.sheetB = b.sheet; }
  const orderChanged = a.order.length !== b.order.length || a.order.some((id, i) => id !== b.order[i]);
  d.empty = !added.length && !removed.length && !changed.length && !d.skusA && !d.setA && !d.metaA && !d.sheetA && !orderChanged;
  return d;
}

/** dir = -1 undo, +1 redo. Mutates the design in place. */
export function applyDiff(D: Design, d: Diff, dir: 1 | -1) {
  const map = new Map(D.objects.map((o) => [o.id, o]));
  const add = dir < 0 ? d.removed : d.added, rem = dir < 0 ? d.added : d.removed;
  for (const s of rem) { const o = JSON.parse(s); map.delete(o.id); }
  for (const s of add) { const o = JSON.parse(s); map.set(o.id, o); }
  for (const [a, b] of d.changed) { const o = JSON.parse(dir < 0 ? a : b); map.set(o.id, o); }
  const order = dir < 0 ? d.orderA : d.orderB;
  D.objects = order.map((id) => map.get(id)!).filter(Boolean);
  if (d.skusA) D.skus = JSON.parse(dir < 0 ? d.skusA : d.skusB!);
  if (d.setA) D.settings = JSON.parse(dir < 0 ? d.setA : d.setB!);
  if (d.metaA) Object.assign(D.meta, JSON.parse(dir < 0 ? d.metaA : d.metaB!));
  if (d.sheetA) { const v = JSON.parse(dir < 0 ? d.sheetA : d.sheetB!); if (v) D.sheet = v; else delete D.sheet; }
}

// ---- transactions (legacy beginTx / commitTx / edit) ----
import type { Scene } from './scene';
import { collisionGuard } from './collision';

export interface TxResult<T> { ok: boolean; diff: Diff | null; blocked: string | null; value: T }

/** Run fn on the scene inside a transaction. With strict = true an edit that creates a NEW collision is rolled back
 *  (legacy "Chặn va chạm"). Returns the diff to push on the undo stack (null when nothing changed or blocked). */
export function transact<T>(s: Scene, label: string, fn: () => T, opts: { strict?: boolean } = {}): TxResult<T> {
  const before = snapState(s.d);
  const value = fn();
  s.invalidate();
  const d = diffState(before, snapState(s.d));
  if (d.empty) return { ok: false, diff: null, blocked: null, value };
  d.label = label;
  if (opts.strict) {
    const bad = collisionGuard(s, d);
    if (bad) { applyDiff(s.d, d, -1); s.invalidate(); return { ok: false, diff: null, blocked: bad, value }; }
  }
  return { ok: true, diff: d, blocked: null, value };
}

/** Begin a long transaction (drag): returns a commit function. */
export function beginTx(s: Scene) {
  const before = snapState(s.d);
  return (label: string, opts: { strict?: boolean } = {}): TxResult<null> => {
    s.invalidate();
    const d = diffState(before, snapState(s.d));
    if (d.empty) return { ok: false, diff: null, blocked: null, value: null };
    d.label = label;
    if (opts.strict) { const bad = collisionGuard(s, d); if (bad) { applyDiff(s.d, d, -1); s.invalidate(); return { ok: false, diff: null, blocked: bad, value: null }; } }
    return { ok: true, diff: d, blocked: null, value: null };
  };
}
