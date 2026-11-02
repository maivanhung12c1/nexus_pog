// Validation (legacy runChecks): warnings only, never auto-fixed.
import { footOv, isRightAngle, ov1 } from './geometry';
import { fmt, L } from './i18n';
import { isStock, skuLabel, type Scene } from './scene';
import type { Box, SceneObject, Sku, Warning } from './types';

export function suspectDims(k: Sku) { return k.form === 'carton' && k.w * k.d < 150 && !k.est; }

const MSG = {
  overlap: (a: string, b: string) => L(`${a} giao nhau với ${b}`, `${a} overlaps ${b}`),
  shelfHit: (a: string, b: string) => L(`${a} chạm ${b} (không đủ khoảng trống)`, `${a} hits ${b} (not enough clearance)`),
  height: (a: string, h: string, m: number) => L(`${a} cao ${h} cm, vượt giới hạn ${m} cm`, `${a} reaches ${h} cm, over the ${m} cm limit`),
  rot: (a: string) => L(`${a} xoay góc lẻ – kiểm tra giao nhau chỉ ước lượng`, `${a} has a free angle – overlap check is approximate`),
  float: (a: string, p: number) => L(`${a} chỉ có ${p}% mặt đáy được đỡ`, `${a}: only ${p}% of its base is supported`),
  out: (a: string) => L(`${a} lố ra ngoài pallet/kệ`, `${a} overhangs its pallet/shelf`),
  units: (a: string) => L(`${a}: chưa có số đơn vị/quy cách – BOM không quy đổi được`, `${a}: no pack size – BOM cannot convert`),
  est: (a: string) => L(`${a}: kích thước đang ước tính theo dung tích (master chưa có) – cần đo lại`, `${a}: dimensions estimated from volume (missing in master) – please measure`),
  dims: (a: string) => L(`${a}: kích thước nghi sai so với quy cách thùng`, `${a}: dimensions look wrong for a carton`),
};

export function runChecks(s: Scene): Warning[] {
  const W: Warning[] = [], D = s.d, objs = D.objects;
  const bases = objs.filter((o) => o.type === 'pallet' || o.type === 'shelf').map((o) => s.aabb(o));
  const push = (level: Warning['level'], msg: string, ids: string[]) => W.push({ level, msg, ids });
  const sol: { o: SceneObject; b: Box }[] = [];
  for (const o of objs) {
    if (o.type === 'pallet' || o.type === 'fixture' || o.type === 'struct') continue;
    const ss = o.type === 'posm' ? [s.aabb(o)] : s.solids(o);
    for (const b of ss) sol.push({ o, b });
  }
  // overlaps (sweep on x)
  sol.sort((a, b) => a.b.x0 - b.b.x0);
  const seen = new Set<string>();
  let nOv = 0;
  for (let i = 0; i < sol.length; i++) {
    const A = sol[i];
    for (let j = i + 1; j < sol.length; j++) {
      const B = sol[j];
      if (B.b.x0 >= A.b.x1 - 0.3) break;
      if (A.o === B.o || (A.o.type === 'posm' && B.o.type === 'posm')) continue;
      if (ov1(A.b.x0, A.b.x1, B.b.x0, B.b.x1) > 0.3 && ov1(A.b.y0, A.b.y1, B.b.y0, B.b.y1) > 0.3 && ov1(A.b.z0, A.b.z1, B.b.z0, B.b.z1) > 0.3) {
        const key = A.o.id < B.o.id ? A.o.id + B.o.id : B.o.id + A.o.id;
        if (seen.has(key)) continue;
        seen.add(key); nOv++;
        const sh = A.o.type === 'shelf' ? A.o : B.o.type === 'shelf' ? B.o : null, ot = sh === A.o ? B.o : A.o;
        if (nOv <= 40) push('danger', sh ? MSG.shelfHit(s.objName(ot), s.objName(sh)) : MSG.overlap(s.objName(A.o), s.objName(B.o)), [A.o.id, B.o.id]);
      }
    }
  }
  if (nOv > 40) W.push({ level: 'danger', msg: '… +' + (nOv - 40), ids: [] });
  const supp = s.supportSolids(), byTop = new Map<number, typeof supp>();
  const propBoxes = objs.filter((o) => o.type === 'prop').map((o) => ({ id: o.id, box: s.aabb(o) }));
  for (const x of supp) { const k = Math.round(x.box.y1); if (!byTop.has(k)) byTop.set(k, []); byTop.get(k)!.push(x); }
  for (const o of objs) {
    if (o.type === 'pallet' || o.type === 'fixture' || o.type === 'shelf' || o.type === 'struct') continue;
    const b = s.aabb(o);
    if (b.y1 > D.settings.maxH + 0.05) push('danger', MSG.height(s.objName(o), fmt(b.y1), D.settings.maxH), [o.id]);
    if (!isRightAngle(o.ry || 0)) push('info', MSG.rot(s.objName(o)), [o.id]);
    if (o.type === 'posm') continue;
    if (b.y0 > 0.5) {
      const fpA = (b.x1 - b.x0) * (b.z1 - b.z0);
      let got = 0;
      const base = o.type === 'array' ? s.solids(o)[0] : b, yk = Math.round(b.y0);
      for (const kk of [yk - 1, yk, yk + 1]) for (const x of byTop.get(kk) || []) { if (x.id === o.id) continue; if (Math.abs(x.box.y1 - b.y0) < 0.6) got += footOv(base, x.box); }
      if (o.type === 'prop') for (const q of propBoxes) { if (q.id !== o.id && Math.abs(q.box.y1 - b.y0) < 0.6) got += footOv(base, q.box); }
      const pct = fpA > 0 ? Math.min(1, got / fpA) : 1;
      if (pct < 0.6) push('warn', MSG.float(s.objName(o), Math.round(pct * 100)), [o.id]);
    }
    if (bases.length && isStock(o)) {
      const tol = +D.settings.overhang || 0;
      let lv = -1;
      for (const p of bases) if (p.y1 <= b.y0 + 0.6 && footOv(b, p) > 0) lv = Math.max(lv, p.y1);
      let cov = 0;
      for (const p of bases) if (Math.abs(p.y1 - lv) < 0.6) cov += footOv(b, { x0: p.x0 - tol, x1: p.x1 + tol, z0: p.z0 - tol, z1: p.z1 + tol, y0: 0, y1: 0 });
      if (lv < 0) cov = 0;
      const fpA = (b.x1 - b.x0) * (b.z1 - b.z0);
      if (fpA > 0 && cov < fpA * 0.995) push('warn', MSG.out(s.objName(o)), [o.id]);
    }
  }
  const used = new Set(objs.filter(isStock).map((o) => o.sku));
  for (const id of used) {
    const k = D.skus[id];
    if (!k) continue;
    const ids = objs.filter((o) => isStock(o) && o.sku === id).map((o) => o.id);
    if (!(k.units > 0)) push('warn', MSG.units(skuLabel(k)), ids);
    if (k.est) push('info', MSG.est(skuLabel(k)), ids);
    if (suspectDims(k)) push('warn', MSG.dims(skuLabel(k)), ids);
  }
  const rank = { danger: 0, warn: 1, info: 2 };
  W.sort((a, b) => rank[a.level] - rank[b.level]);
  return W;
}
