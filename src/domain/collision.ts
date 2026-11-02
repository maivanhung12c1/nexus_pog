// Hard collision guard ("Chặn va chạm"): an edit may not create a NEW overlap between a product and another product,
// a shelf, a pallet or a gondola back panel. Overlaps that already existed are tolerated. (legacy collisionGuard)
import { ov1 } from './geometry';
import type { Diff } from './history';
import { L } from './i18n';
import { isStock, type Scene } from './scene';
import type { Box, SceneObject } from './types';

function hardSolids(s: Scene, o: SceneObject): Box[] {
  if (o.hidden) return [];
  if (o.type === 'fixture') { const b = s.aabb(o), p = (o.fx && o.fx.panel) || 2; return [{ ...b, z1: b.z0 + p }]; }
  if (isStock(o) || o.type === 'shelf' || o.type === 'pallet') return s.solids(o);
  return [];
}

function hitsOf(s: Scene, o: SceneObject, others: { id: string; o: SceneObject; s: Box[] }[]) {
  let n = 0, who: SceneObject | null = null;
  const A = hardSolids(s, o);
  for (const q of others) {
    if (q.id === o.id) continue;
    for (const a of A) for (const b of q.s) {
      if (ov1(a.x0, a.x1, b.x0, b.x1) > 0.3 && ov1(a.y0, a.y1, b.y0, b.y1) > 0.3 && ov1(a.z0, a.z1, b.z0, b.z1) > 0.3) { n++; who = who || q.o; }
    }
  }
  return { n, who };
}

/** Returns a message when the diff creates a new collision, else null. */
export function collisionGuard(s: Scene, d: Diff): string | null {
  const D = s.d;
  const ids = new Set([...d.added.map((x) => JSON.parse(x).id), ...d.changed.map(([, b]) => JSON.parse(b).id)]);
  if (!ids.size) return null;
  s.invalidate();
  const changed = [...ids].map((id) => s.get(id)).filter((o): o is SceneObject => !!o && (isStock(o) || o.type === 'shelf' || o.type === 'pallet' || o.type === 'fixture'));
  if (!changed.length) return null;
  const others = D.objects.filter((o) => !o.hidden).map((o) => ({ id: o.id, o, s: hardSolids(s, o) })).filter((q) => q.s.length);
  const before = new Map<string, SceneObject>(d.changed.map(([a]) => { const o = JSON.parse(a); return [o.id, o]; }));
  for (const o of changed) {
    if (!isStock(o) && o.type !== 'shelf') continue;
    const now = hitsOf(s, o, others);
    if (!now.n) continue;
    let prev = 0;
    const b = before.get(o.id);
    if (b) {
      const i = D.objects.indexOf(o);
      D.objects[i] = b; s.invalidate();
      prev = hitsOf(s, b, others.filter((q) => q.id !== o.id)).n;
      D.objects[i] = o; s.invalidate();
    }
    if (now.n > prev) return `${s.objName(o).slice(0, 40)} ${L('va chạm', 'would hit')} ${s.objName(now.who).slice(0, 40)}`;
  }
  return null;
}
