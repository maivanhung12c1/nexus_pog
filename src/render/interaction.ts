// Pointer / keyboard interaction (legacy INTERACTION section): selection, marquee, move drag with snapping and
// auto-rest, Front-view drag with notch snapping, Ctrl+drag copy, orbit / pan / zoom, library drag & drop with a ghost,
// quick add, measuring tool and the keyboard map.
import * as T from 'three';
import { arrayCount, ov1, unionBox } from '../domain/geometry';
import { fmt, L } from '../domain/i18n';
import { isRigid, isStock, type Scene, type Solid } from '../domain/scene';
import { snapBox, supportUnder } from '../domain/snap';
import { notchY, ridersOf, shelfBlock, shelfDirect } from '../domain/shelf/gondola';
import { PALLET_PRESETS } from '../domain/presets';
import type { Box, SceneObject, ShelfObj, SkuObj } from '../domain/types';
import { clamp, deep, R1, R2, uid } from '../domain/util';
import { cmd } from '../app/commands';
import { editor } from '../app/editorStore';
import { prefs } from '../app/prefs';
import { session, useSession } from '../app/session';
import { toast } from '../app/workspace';
import type { View, Viewport } from './viewport';

export type LibSpec = { kind: 'sku'; id: string } | { kind: 'pallet'; preset: string } | { kind: 'obj'; proto: SceneObject };

interface DragStart {
  x: number; y: number; v: View; plane: number; planeZ: number; hitId: string; wasSel: boolean; ctrl: boolean; p0: { x: number; y: number; z: number } | null;
  tx?: ReturnType<typeof session.begin>; copy?: boolean; ids?: string[]; rigid?: boolean; shelf?: ShelfObj | null; orig?: Map<string, { x: number; y: number; z: number }>; cands?: Solid[]; targets?: Solid[]; ex?: Set<string>; box0?: Box;
}

const editable = (v: View | null) => !!v && (v.key === 'top' || v.key === 'persp' || v.key === 'front');

export class Interaction {
  mode: null | 'press' | 'drag' | 'marquee' | 'orbit' | 'pan' = null;
  start: DragStart | null = null;
  pan: { x: number; y: number; v: View; cam: unknown } | null = null;
  lib: { spec: LibSpec; x0: number; y0: number; active: boolean; ok: boolean; obj: SceneObject | null; base: SceneObject | null; addedSku: boolean; tx: ReturnType<typeof session.begin> | null } | null = null;
  private hoverT = 0;
  private digBuf = ''; private digT = 0;
  private off: (() => void)[] = [];

  constructor(public vp: Viewport, public host: HTMLElement) {
    const on = <K extends keyof WindowEventMap>(el: Window | HTMLElement, ev: K, fn: (e: WindowEventMap[K]) => void, opt?: AddEventListenerOptions) => { el.addEventListener(ev, fn as EventListener, opt); this.off.push(() => el.removeEventListener(ev, fn as EventListener, opt)); };
    on(host, 'contextmenu', (e) => e.preventDefault());
    on(host, 'pointerdown', (e) => this.onDown(e));
    on(window, 'pointermove', (e) => this.onMove(e));
    on(window, 'pointerup', (e) => this.onUp(e));
    on(host, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(host, 'dblclick', (e) => { const p = this.xy(e), v = vp.viewAt(p.x, p.y); if (!v) return; if (!vp.pick(v, p.x, p.y, { skipLocked: true })) vp.frameAll(useSession.getState().sel); });
    on(window, 'keydown', (e) => this.onKey(e));
    on(window, 'blur', () => { if (this.mode === 'drag') this.cancelDrag(); });
  }
  dispose() { this.off.forEach((f) => f()); }

  private get s(): Scene { return session.scene!; }
  private xy(e: { clientX: number; clientY: number }) { const r = this.host.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, inside: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; }
  private planePoint(v: View, px: number, py: number, y: number) { return this.vp.rayPlaneY(v, px, py, y); }
  private viewPoint(v: View, px: number, py: number, st: DragStart) { return v.key === 'front' ? this.vp.rayPlaneZ(v, px, py, st.planeZ) : this.planePoint(v, px, py, st.plane); }
  private thr(v: View) { return clamp(9 * this.vp.cmPerPx(v), 0.3, 8); }
  private snapOpt() { const p = prefs(); return { snapOn: p.snapOn, snapEdge: p.snapEdge }; }

  // ---------------- pointer ----------------
  onDown(e: PointerEvent) {
    const p = this.xy(e), v = this.vp.viewAt(p.x, p.y);
    if (!v || this.lib || !session.scene) return;
    this.host.setPointerCapture?.(e.pointerId);
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (e.button === 1 || e.button === 2) { this.mode = 'pan'; this.pan = { x: p.x, y: p.y, v, cam: deep(this.vp.cam[v.key]) }; return; }
    if (e.button !== 0) return;
    if (editor.get().measure) { this.measureClick(v, p.x, p.y); return; }
    const h = this.vp.pick(v, p.x, p.y, { skipLocked: true });
    if (h) {
      if (e.shiftKey) { session.toggle(h.id); this.mode = null; return; }
      const wasSel = useSession.getState().sel.has(h.id);
      if (!wasSel) session.select([h.id]);
      if (!editable(v)) { this.mode = null; return; }
      const y = v.key === 'persp' ? h.point.y : 0;
      const st: DragStart = { x: p.x, y: p.y, v, plane: y, planeZ: h.point.z, hitId: h.id, wasSel, ctrl: e.ctrlKey || e.metaKey, p0: null };
      st.p0 = this.viewPoint(v, p.x, p.y, st);
      this.mode = 'press'; this.start = st; return;
    }
    if (v.key === 'persp') { this.mode = 'orbit'; this.pan = { x: p.x, y: p.y, v, cam: deep(this.vp.cam.persp) }; return; }
    this.mode = 'marquee'; this.vp.ov.marquee = { v, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; (this.vp.ov.marquee as { add?: boolean }).add = e.shiftKey; this.vp.request();
  }

  private beginDrag() {
    const st = this.start!, s = this.s;
    st.tx = session.begin();
    if (st.ctrl) {
      const clones: SceneObject[] = [];
      for (const id of useSession.getState().sel) { const o = s.get(id); if (!o || o.lock) continue; const c = deep(o); c.id = uid(); clones.push(c); }
      s.d.objects.push(...clones); s.invalidate();
      useSession.setState({ sel: new Set(clones.map((c) => c.id)) });
      this.vp.rebuild(s, useSession.getState().sel);
      st.copy = true;
    }
    st.ids = [...useSession.getState().sel].filter((id) => { const o = s.get(id); return o && !o.lock; });
    if (st.v.key !== 'front' && st.ids.some((id) => s.get(id)!.type === 'shelf')) { const n = st.ids.length; st.ids = st.ids.filter((id) => s.get(id)!.type !== 'shelf'); if (st.ids.length < n) toast(L('Kéo tấm kệ lên/xuống ở khung Trước', 'Drag shelves up/down in the Front view'), 'warn'); }
    if (!st.ids.length) { this.mode = null; return; }
    st.rigid = st.ids.some((id) => isRigid(s.get(id)!));
    st.shelf = (st.ids.map((id) => s.get(id)).find((o) => o && o.type === 'shelf') as ShelfObj) || null;
    if (st.rigid && prefs().carry) st.ids = [...ridersOf(s, st.ids)].filter((id) => s.get(id));
    st.orig = new Map(st.ids.map((id) => [id, { ...s.get(id)!.pos }]));
    const ex = new Set(st.ids);
    s.invalidateGeom();
    st.cands = s.supportSolids().filter((c) => !ex.has(c.id));
    st.targets = s.snapTargets(ex); st.ex = ex;
    st.box0 = unionBox(st.ids.map((id) => s.aabb(s.get(id)!)))!;
    this.mode = 'drag';
  }

  private overlapAny(ids: string[], cands: Solid[]) {
    if (ids.length > 250) return false;
    for (const id of ids) for (const a of this.s.solids(this.s.get(id)!)) for (const c of cands) { const q = c.box; if (ov1(a.x0, a.x1, q.x0, q.x1) > 0.3 && ov1(a.y0, a.y1, q.y0, q.y1) > 0.3 && ov1(a.z0, a.z1, q.z0, q.z1) > 0.3) return true; }
    return false;
  }

  private dragTo(px: number, py: number, alt: boolean) {
    const st = this.start!, v = st.v, s = this.s, pp = this.viewPoint(v, px, py, st);
    if (!pp || !st.p0) return;
    if (v.key === 'front') return this.dragFront(px, py, alt, pp);
    let dx = pp.x - st.p0.x, dz = pp.z - st.p0.z;
    const b0 = st.box0!, b = { x0: b0.x0 + dx, x1: b0.x1 + dx, y0: b0.y0, y1: b0.y1, z0: b0.z0 + dz, z1: b0.z1 + dz };
    this.vp.ov.guides = [];
    if (!alt) { const sn = snapBox(b, st.targets!, this.thr(v), prefs().snapOn ? prefs().grid : 0, this.snapOpt()); dx += sn.dx; dz += sn.dz; this.vp.ov.guides = sn.guides; }
    for (const id of st.ids!) { const o = s.get(id)!, p = st.orig!.get(id)!; o.pos.x = p.x + dx; o.pos.z = p.z + dz; o.pos.y = p.y; }
    let dy = 0, hit: string | null = null;
    if (prefs().autoRest && !st.rigid) {
      let best = -Infinity;
      for (const id of st.ids!) { const o = s.get(id)!; if (o.type === 'pallet') continue; const a = s.aabb(o), r = supportUnder(a, st.ex!, st.cands!), need = r.top - a.y0; if (need > best + 1e-6) { best = need; hit = r.hit; } }
      if (best > -Infinity) dy = best;
      for (const id of st.ids!) { const o = s.get(id)!; o.pos.y = Math.max(0, st.orig!.get(id)!.y + dy); }
    }
    session.touch();
    this.vp.updateObjects(st.ids!);
    const nb = unionBox(st.ids!.map((id) => s.aabb(s.get(id)!)))!;
    this.vp.ov.supportRect = hit ? { x0: nb.x0, x1: nb.x1, z0: nb.z0, z1: nb.z1, y: nb.y0 } : null;
    for (const gd of this.vp.ov.guides) gd.y = nb.y0;
    const bad = this.overlapAny(st.ids!, st.cands!), hn = hit ? s.objName(s.get(hit)) : null;
    this.vp.ov.dragInfo = { x: px, y: py, bad, lines: [L(`Cao độ ${fmt(nb.y0)} cm`, `Elevation ${fmt(nb.y0)} cm`), hn ? L('trên ', 'on ') + hn.slice(0, 38) : L('trên sàn', 'on the floor'), `X ${fmt(nb.x0)} · Z ${fmt(nb.z0)} cm` + (alt ? ' · snap off' : '')] };
    this.vp.request();
  }

  /** Front view: move in X and Y on the plane through the grab point; drop onto the nearest surface BELOW the object;
   *  shelves snap to the notch pitch and carry their products. */
  private dragFront(px: number, py: number, alt: boolean, pp: { x: number; y: number; z: number }) {
    const st = this.start!, v = st.v, s = this.s;
    let dx = pp.x - st.p0!.x, dy = pp.y - st.p0!.y;
    const b0 = st.box0!;
    this.vp.ov.guides = [];
    if (!alt && prefs().snapOn) {
      const tg = st.targets!.filter((t) => ov1(t.box.y0 - 2, t.box.y1 + 2, b0.y0 + dy, b0.y1 + dy) > 0 || (t.box.y1 <= b0.y0 + dy + 1 && t.box.y1 >= b0.y0 + dy - 1));
      const b = { x0: b0.x0 + dx, x1: b0.x1 + dx, y0: b0.y0 + dy, y1: b0.y1 + dy, z0: b0.z0, z1: b0.z1 };
      const sn = snapBox(b, tg, this.thr(v), prefs().grid, this.snapOpt());
      dx += sn.dx; this.vp.ov.guides = sn.guides.filter((g) => g.axis === 'x');
    }
    let hit: string | null = null;
    if (st.shelf) { const o = st.shelf, p = st.orig!.get(o.id)!, ny = alt ? p.y + dy : notchY(s, o, p.y + dy); dy = ny - p.y; }
    for (const id of st.ids!) { const o = s.get(id)!, p = st.orig!.get(id)!; o.pos.x = p.x + dx; o.pos.z = p.z; o.pos.y = p.y + dy; }
    if (prefs().autoRest && !st.rigid) {
      let best = -Infinity;
      for (const id of st.ids!) { const a = s.aabb(s.get(id)!), r = supportUnder(a, st.ex!, st.cands!, a.y0), need = r.top - a.y0; if (need > best + 1e-6) { best = need; hit = r.hit; } }
      if (best > -Infinity) for (const id of st.ids!) { const o = s.get(id)!; o.pos.y = Math.max(0, o.pos.y + best); }
    }
    for (const id of st.ids!) { const o = s.get(id)!; o.pos.y = Math.max(0, o.pos.y); }
    session.touch();
    this.vp.updateObjects(st.ids!);
    const nb = unionBox(st.ids!.map((id) => s.aabb(s.get(id)!)))!;
    for (const gd of this.vp.ov.guides) gd.y = nb.y0;
    this.vp.ov.supportRect = null;
    const bad = this.overlapAny(st.ids!, st.cands!), hn = hit ? s.objName(s.get(hit)) : null;
    this.vp.ov.dragInfo = { x: px, y: py, bad, lines: [st.shelf ? L('Mặt kệ ', 'Shelf top ') + fmt(s.aabb(st.shelf).y1) + ' cm' : L(`Cao độ ${fmt(nb.y0)} cm`, `Elevation ${fmt(nb.y0)} cm`), st.shelf ? L('kèm ', 'with ') + (st.ids!.length - 1) + L(' vật', ' objects') : hn ? L('trên ', 'on ') + hn.slice(0, 38) : L('trên sàn', 'on the floor'), `X ${fmt(nb.x0)} cm` + (alt ? ' · snap off' : '')] };
    this.vp.request();
  }

  cancelDrag() {
    const st = this.start;
    if (!st) return;
    st.tx?.cancel();
    if (st.copy) session.clearSel();
    this.mode = null; this.vp.ov.guides = []; this.vp.ov.dragInfo = null; this.vp.ov.supportRect = null; this.vp.request();
  }

  onMove(e: PointerEvent) {
    const p = this.xy(e);
    if (this.lib) { this.libMove(e, p); return; }
    if (!this.mode) {
      if (p.inside && performance.now() - this.hoverT > 60 && session.scene) {
        this.hoverT = performance.now();
        const v = this.vp.viewAt(p.x, p.y);
        if (v) { const h = editor.get().measure ? null : this.vp.pick(v, p.x, p.y, { skipLocked: true }); this.host.style.cursor = editor.get().measure ? 'crosshair' : h && editable(v) ? 'move' : v.key === 'persp' ? 'grab' : 'crosshair'; }
      }
      return;
    }
    if (this.mode === 'press') { const st = this.start!; if (Math.hypot(p.x - st.x, p.y - st.y) > 3) { this.beginDrag(); if ((this.mode as string) === 'drag') this.dragTo(p.x, p.y, e.altKey); } return; }
    if (this.mode === 'drag') { this.dragTo(p.x, p.y, e.altKey); return; }
    if (this.mode === 'marquee') { const m = this.vp.ov.marquee!; m.x1 = p.x; m.y1 = p.y; this.vp.request(); return; }
    const pn = this.pan!;
    if (this.mode === 'orbit') { const c0 = pn.cam as { yaw: number; pitch: number }, cs = this.vp.cam.persp; cs.yaw = c0.yaw - (p.x - pn.x) * 0.008; cs.pitch = clamp(c0.pitch + (p.y - pn.y) * 0.006, 0.03, 1.53); this.vp.request(); return; }
    if (this.mode === 'pan') {
      const v = pn.v, dx = p.x - pn.x, dy = p.y - pn.y, k = this.vp.cmPerPx(v), c0 = pn.cam as Record<string, number>;
      if (v.key === 'top') { this.vp.cam.top.cx = c0.cx - dx * k; this.vp.cam.top.cz = c0.cz - dy * k; }
      else if (v.key === 'front') { this.vp.cam.front.cx = c0.cx - dx * k; this.vp.cam.front.cy = c0.cy + dy * k; }
      else if (v.key === 'side') { this.vp.cam.side.cz = c0.cz + dx * k; this.vp.cam.side.cy = c0.cy + dy * k; }
      else { const c = this.vp.cams.persp, right = new T.Vector3().setFromMatrixColumn(c.matrixWorld, 0), up = new T.Vector3().setFromMatrixColumn(c.matrixWorld, 1), cs = this.vp.cam.persp; cs.tx = c0.tx - (right.x * dx - up.x * dy) * k; cs.ty = Math.max(-50, c0.ty - (right.y * dx - up.y * dy) * k); cs.tz = c0.tz - (right.z * dx - up.z * dy) * k; }
      this.vp.request();
    }
  }

  onUp(e: PointerEvent) {
    if (this.lib) { this.finishLib(this.lib.active && this.lib.ok); return; }
    const st = this.start, mode = this.mode;
    this.mode = null;
    if (mode === 'drag' && st) {
      this.vp.ov.guides = []; this.vp.ov.dragInfo = null; this.vp.ov.supportRect = null;
      for (const id of st.ids!) { const o = this.s.get(id); if (o) { o.pos.x = R2(o.pos.x); o.pos.y = R2(o.pos.y); o.pos.z = R2(o.pos.z); } }
      st.tx!.commit(st.copy ? L('Nhân bản', 'Copy') : L('Di chuyển', 'Move'));
      this.vp.request(); return;
    }
    if (mode === 'press' && st) { if (st.wasSel && useSession.getState().sel.size > 1) session.select([st.hitId]); return; }
    if (mode === 'marquee') {
      const m = this.vp.ov.marquee! as NonNullable<Viewport['ov']['marquee']> & { add?: boolean };
      this.vp.ov.marquee = null;
      const v = m.v;
      if (Math.abs(m.x1 - m.x0) < 4 && Math.abs(m.y1 - m.y0) < 4) { if (!m.add) session.clearSel(); this.vp.request(); return; }
      const x0 = Math.min(m.x0, m.x1), x1 = Math.max(m.x0, m.x1), y0 = Math.min(m.y0, m.y1), y1 = Math.max(m.y0, m.y1), ids: string[] = [];
      for (const o of this.s.d.objects) {
        if (o.lock || o.hidden) continue;
        const b = this.s.aabb(o);
        const pts = v.key === 'top' ? [[b.x0, b.y1, b.z0], [b.x1, b.y1, b.z1]] : v.key === 'front' ? [[b.x0, b.y0, b.z1], [b.x1, b.y1, b.z1]] : [[b.x1, b.y0, b.z0], [b.x1, b.y1, b.z1]];
        const A = this.vp.toScreen(v, pts[0][0], pts[0][1], pts[0][2]), B = this.vp.toScreen(v, pts[1][0], pts[1][1], pts[1][2]);
        if (Math.max(A.x, B.x) >= x0 && Math.min(A.x, B.x) <= x1 && Math.max(A.y, B.y) >= y0 && Math.min(A.y, B.y) <= y1) ids.push(o.id);
      }
      session.select(ids, m.add);
      this.vp.request();
    }
    void e;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const p = this.xy(e), v = this.vp.viewAt(p.x, p.y);
    if (!v) return;
    const f = Math.exp(e.deltaY * 0.0012);
    if (v.key === 'persp') { this.vp.cam.persp.dist = clamp(this.vp.cam.persp.dist * f, 30, 6000); this.vp.request(); return; }
    const cs = this.vp.cam[v.key] as { s: number; cx?: number; cy?: number; cz?: number }, ox = p.x - v.x - v.w / 2, oy = p.y - v.y - v.h / 2, ns = clamp(cs.s * f, 0.02, 20);
    if (v.key === 'top') { cs.cx! += ox * (cs.s - ns); cs.cz! += oy * (cs.s - ns); }
    else if (v.key === 'front') { cs.cx! += ox * (cs.s - ns); cs.cy! -= oy * (cs.s - ns); }
    else { cs.cz! -= ox * (cs.s - ns); cs.cy! -= oy * (cs.s - ns); }
    cs.s = ns;
    this.vp.request();
  }

  // ---------------- library drag (new objects) ----------------
  newObject(spec: LibSpec): SceneObject | null {
    if (spec.kind === 'sku') { const k = session.ensureSku(spec.id); return k ? { id: uid(), type: 'sku', sku: k.id, pos: { x: 0, y: 0, z: 0 }, ry: 0 } : null; }
    if (spec.kind === 'pallet') { const p = PALLET_PRESETS[spec.preset] || PALLET_PRESETS.go; return { id: uid('p'), type: 'pallet', name: 'Pallet ' + p.name, size: { w: p.w, d: p.d, h: p.h }, pos: { x: 0, y: 0, z: 0 }, ry: 0, lock: false }; }
    return Object.assign(deep(spec.proto), { id: uid() });
  }
  startLibDrag(spec: LibSpec, e: PointerEvent) {
    if (this.mode || !session.scene) return;
    const s = this.s, had = spec.kind === 'sku' && !!s.d.skus[spec.id];
    const tx = session.begin();
    const obj = this.newObject(spec);
    if (!obj) { tx.cancel(); return; }
    this.lib = { spec, x0: e.clientX, y0: e.clientY, active: false, ok: false, obj, base: null, addedSku: spec.kind === 'sku' && !had, tx };
    document.body.classList.add('is-dragging');
  }
  /** 3D drop in a planogram: the first shelf top (nearest to the camera) the cursor ray passes over. */
  private shelfRayPoint(v: View, px: number, py: number) {
    const ray = this.vp.rayFor(v, px, py), o = ray.ray.origin, dr = ray.ray.direction;
    let best: { x: number; y: number; z: number } | null = null, bt = Infinity;
    for (const x of this.s.d.objects) {
      if (x.type !== 'shelf') continue;
      const t = this.s.aabb(x);
      if (Math.abs(dr.y) < 1e-6) continue;
      const tt = (t.y1 - o.y) / dr.y;
      if (tt <= 0 || tt >= bt) continue;
      const X = o.x + dr.x * tt, Z = o.z + dr.z * tt;
      if (X >= t.x0 && X <= t.x1 && Z >= t.z0 - 2 && Z <= t.z1 + 2) { bt = tt; best = { x: X, y: t.y1, z: clamp(Z, t.z0, t.z1) }; }
    }
    return best;
  }
  private libMove(e: PointerEvent, p: { x: number; y: number; inside: boolean }) {
    const Lb = this.lib!, s = this.s;
    if (!Lb.active && Math.hypot(e.clientX - Lb.x0, e.clientY - Lb.y0) < 4) return;
    Lb.active = true;
    const v = p.inside ? this.vp.viewAt(p.x, p.y) : null;
    const fl = document.getElementById('drag-float');
    if (!v || !editable(v)) {
      Lb.ok = false; this.vp.clearGhost(); this.vp.ov.dragInfo = null; this.vp.ov.guides = []; this.vp.ov.supportRect = null;
      if (fl) { fl.style.display = 'block'; fl.style.left = e.clientX + 12 + 'px'; fl.style.top = e.clientY + 12 + 'px'; fl.textContent = this.libName(Lb.obj!); }
      this.vp.request(); return;
    }
    if (fl) fl.style.display = 'none';
    if (Lb.base) Lb.obj = Lb.base;
    let pt: { x: number; y: number; z: number } | null = null, maxY = Infinity;
    if (v.key === 'front') {
      const zs = s.d.objects.filter((q) => q.type === 'shelf').map((q) => s.aabb(q)), sb = zs.length ? unionBox(zs) : s.sceneBox(true), zc = sb ? (sb.z0 + sb.z1) / 2 : 40;
      pt = this.vp.rayPlaneZ(v, p.x, p.y, zc);
      if (pt) { maxY = pt.y; pt.y = 0; }
    } else if (v.key === 'persp') {
      const sp = s.isShelfMode ? this.shelfRayPoint(v, p.x, p.y) : null;
      if (sp) { pt = sp; maxY = sp.y; } else { const h = this.vp.pick(v, p.x, p.y, {}); const ho = h && s.get(h.id); pt = h && !(ho && ho.type === 'fixture') ? h.point : this.planePoint(v, p.x, p.y, 0); }
    } else pt = this.planePoint(v, p.x, p.y, 0);
    if (!pt) { Lb.ok = false; return; }
    const ob = Lb.obj!;
    ob.pos = { x: pt.x, y: 0, z: pt.z };
    let b = s.aabb(ob);
    this.vp.ov.guides = [];
    if (!e.altKey) { const sn = snapBox(b, s.snapTargets(new Set()), this.thr(v), prefs().snapOn ? prefs().grid : 0, this.snapOpt()); ob.pos.x += sn.dx; if (v.key !== 'front') ob.pos.z += sn.dz; this.vp.ov.guides = v.key === 'front' ? sn.guides.filter((g) => g.axis === 'x') : sn.guides; b = s.aabb(ob); }
    let hit: string | null = null;
    s.invalidateGeom();
    if (prefs().autoRest && ob.type !== 'pallet') { const r = supportUnder(b, null, s.supportSolids(), maxY); ob.pos.y = r.top; hit = r.hit; } else ob.pos.y = 0;
    Lb.base = ob;
    const hs = hit ? s.get(hit) : null;
    Lb.obj = ob.type === 'sku' && hs && hs.type === 'shelf' && prefs().fillDepth ? shelfBlock(s, deep(ob) as SkuObj, hs) : ob;
    const o = Lb.obj;
    b = s.aabb(o);
    for (const gd of this.vp.ov.guides) gd.y = b.y0;
    let bad = false;
    for (const c of s.supportSolids()) { const q = c.box; if (ov1(b.x0, b.x1, q.x0, q.x1) > 0.3 && ov1(b.y0, b.y1, q.y0, q.y1) > 0.3 && ov1(b.z0, b.z1, q.z0, q.z1) > 0.3) { bad = true; break; } }
    this.vp.ghostFor(s, o, bad);
    this.vp.ov.supportRect = hit ? { x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1, y: b.y0 } : null;
    this.vp.ov.dragInfo = { x: p.x, y: p.y, bad, lines: [this.libName(o).slice(0, 44), L(`Cao độ ${fmt(b.y0)} cm`, `Elevation ${fmt(b.y0)} cm`) + ' · ' + (hit ? L('trên ', 'on ') + s.objName(s.get(hit)).slice(0, 30) : L('trên sàn', 'on the floor')), 'Esc: ' + L('Huỷ', 'Cancel')] };
    Lb.ok = true;
    this.vp.request();
  }
  private libName(o: SceneObject) { return isStock(o) ? this.s.skuOf(o)?.name || '?' : o.name || o.type; }
  finishLib(ok: boolean) {
    const Lb = this.lib;
    if (!Lb) return;
    this.lib = null;
    document.body.classList.remove('is-dragging');
    const fl = document.getElementById('drag-float'); if (fl) fl.style.display = 'none';
    this.vp.clearGhost(); this.vp.ov.dragInfo = null; this.vp.ov.guides = []; this.vp.ov.supportRect = null;
    if (ok && Lb.obj) {
      const o = Lb.obj;
      o.pos = { x: R2(o.pos.x), y: R2(o.pos.y), z: R2(o.pos.z) };
      this.s.d.objects.push(o); this.s.invalidate();
      useSession.setState({ sel: new Set([o.id]) });
      Lb.tx!.commit(L('Thêm ', 'Add ') + this.libName(o).slice(0, 30));
      // keyboard shortcuts (facings, stack, rotate…) now apply to the dropped product, not the library search box
      (document.activeElement as HTMLElement | null)?.blur?.();
    } else Lb.tx!.cancel();
    if (!ok && Lb.addedSku && Lb.spec.kind === 'sku') delete this.s.d.skus[Lb.spec.id];
    this.vp.request();
  }

  /** Double-click on a library card: next to the selection (right side), on the first shelf, or beside the scene. */
  quickAdd(spec: LibSpec) {
    if (!session.scene) return;
    const ids = session.edit(L('Thêm', 'Add'), (s) => {
      let o = this.newObject(spec);
      if (!o) return null;
      const sz = s.localSize(o), sel = session.selected(false);
      let maxY = Infinity;
      const selSh = sel.length === 1 && sel[0].type === 'shelf' ? sel[0] : null;
      if (selSh && o.type !== 'pallet') { const t = s.aabb(selSh), it = shelfDirect(s, selSh), x = it.length ? Math.max(...it.map((q) => s.aabb(q).x1)) : t.x0; o.pos = { x: x + sz.w / 2, y: 0, z: t.z1 - sz.d / 2 }; maxY = t.y1; }
      else if (sel.length && o.type !== 'pallet') { const b = unionBox(sel.map((q) => s.aabb(q)))!; o.pos = { x: b.x1 + sz.w / 2, y: 0, z: b.z1 - sz.d / 2 }; maxY = b.y0; }
      else if (s.isShelfMode && o.type !== 'pallet') {
        const sh = s.d.objects.filter((q) => q.type === 'shelf').sort((a, b) => s.aabb(a).y1 - s.aabb(b).y1 || s.aabb(a).x0 - s.aabb(b).x0)[0];
        const t = sh ? s.aabb(sh) : { x0: 0, z1: 45, y1: 0 }, it = sh ? shelfDirect(s, sh) : [], x = it.length ? Math.max(...it.map((q) => s.aabb(q).x1)) : t.x0;
        o.pos = { x: x + sz.w / 2, y: 0, z: t.z1 - sz.d / 2 }; maxY = t.y1;
      } else { const sb = s.sceneBox(true) || { x0: 0, x1: 120, z0: 0, z1: 80 }; o.pos = o.type === 'pallet' ? { x: sb.x1 + sz.w / 2, y: 0, z: sb.z0 + sz.d / 2 } : { x: sb.x0 + sz.w / 2, y: 0, z: sb.z1 - sz.d / 2 }; }
      if (o.type !== 'pallet') { s.invalidateGeom(); const r = supportUnder(s.aabb(o), null, s.supportSolids(), maxY); o.pos.y = r.top; const hs = r.hit ? s.get(r.hit) : null; if (o.type === 'sku' && hs && hs.type === 'shelf' && prefs().fillDepth) o = shelfBlock(s, o, hs); }
      s.d.objects.push(o); s.invalidate();
      return o.id;
    });
    if (ids) { session.select([ids]); (document.activeElement as HTMLElement | null)?.blur?.(); } // shortcuts now target the new object
  }

  // ---------------- measuring tool ----------------
  private measurePoint(v: View, px: number, py: number) {
    const h = this.vp.pick(v, px, py, {});
    let p: { x: number; y: number; z: number } | null = h ? h.point : v.key === 'front' ? this.vp.rayPlaneZ(v, px, py, 0) : this.planePoint(v, px, py, 0);
    let best: { x: number; y: number; z: number } | null = null, bd = 12;
    for (const o of this.s.d.objects) {
      if (o.hidden) continue;
      const b = this.s.aabb(o);
      for (const x of [b.x0, (b.x0 + b.x1) / 2, b.x1]) for (const y of [b.y1, (b.y0 + b.y1) / 2, b.y0]) for (const z of [b.z0, (b.z0 + b.z1) / 2, b.z1]) { const sc = this.vp.toScreen(v, x, y, z), d = Math.hypot(sc.x - px, sc.y - py); if (d < bd - 0.01) { bd = d; best = { x, y, z }; } }
    }
    if (best) p = best;
    return p ? { x: R1(p.x), y: R1(p.y), z: R1(p.z) } : null;
  }
  private measureClick(v: View, px: number, py: number) {
    const p = this.measurePoint(v, px, py);
    if (!p) return;
    const m = this.vp.ov.measure;
    if (!m || !m.a || m.b) this.vp.ov.measure = { a: p, b: null }; else m.b = p;
    this.vp.request();
  }

  // ---------------- keyboard (legacy onKey) ----------------
  onKey(e: KeyboardEvent) {
    if (!session.scene) return;
    const tg = e.target as HTMLElement | null, typing = !!tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.tagName === 'SELECT' || tg.isContentEditable);
    if (document.querySelector('[data-modal-open]') && e.key !== 'Escape') return;
    if (e.key === 'Escape') {
      if (editor.get().measure) { editor.set({ measure: false }); this.vp.ov.measure = null; this.vp.request(); return; }
      if (this.lib) { this.finishLib(false); return; }
      if (this.mode === 'drag' || this.mode === 'press') { this.cancelDrag(); return; }
      if (editor.get().builder) { editor.set({ builder: null }); this.vp.clearGhost(); return; }
      if (typing) { tg!.blur(); return; }
      if (useSession.getState().sel.size) session.clearSel();
      return;
    }
    if (typing) return;
    const k = e.key.toLowerCase(), c = e.ctrlKey || e.metaKey;
    if (c && k === 'z' && !e.shiftKey) { e.preventDefault(); session.undo(); return; }
    if (c && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); session.redo(); return; }
    if (c && k === 's') { e.preventDefault(); window.dispatchEvent(new CustomEvent('nexus:save')); return; }
    if (c && e.shiftKey && k === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('nexus:export-plnx')); return; }
    if (c && k === 'd') { e.preventDefault(); cmd.duplicate('R'); return; }
    if (e.altKey && !c && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'pageup'].includes(k)) { e.preventDefault(); cmd.duplicate(({ arrowleft: 'L', arrowright: 'R', arrowup: 'B', arrowdown: 'F', pageup: 'U' } as const)[k as 'arrowleft']); return; }
    if (c && k === 'c') { cmd.copy(); return; }
    if (c && k === 'v') { e.preventDefault(); cmd.paste(); return; }
    if (c && k === 'a') { e.preventDefault(); cmd.selectAll(); return; }
    if (c && k.startsWith('arrow')) { e.preventDefault(); const st = e.shiftKey ? 10 : 1; if (k === 'arrowleft') cmd.nudge(-st, 0, 0); else if (k === 'arrowright') cmd.nudge(st, 0, 0); else if (k === 'arrowup') cmd.nudge(0, 0, -st); else cmd.nudge(0, 0, st); return; }
    if (c) return;
    const stock = () => session.selected().filter(isStock);
    if (e.shiftKey && (k === 'arrowleft' || k === 'arrowright')) { const st = stock(); if (st.length) { e.preventDefault(); const d = k === 'arrowright' ? 1 : -1; cmd.count('x', (v) => v + d, d > 0 ? L('Thêm facing', 'Facing +') : L('Bớt facing', 'Facing −'), 'fac' + st.map((o) => o.id).join(',')); return; } }
    if (/^[0-9]$/.test(e.key) && !e.altKey && useSession.getState().sel.size) {
      const st = stock();
      if (st.length) { const now = performance.now(); this.digBuf = (this.digT && now - this.digT < 900 ? this.digBuf : '') + e.key; this.digT = now; const n = +this.digBuf; if (n >= 1) { e.preventDefault(); cmd.count('x', () => n, L('Facing = ', 'Facings = ') + n, 'dig' + st.map((o) => o.id).join(',')); } return; }
    }
    if (e.shiftKey && (k === 'arrowup' || k === 'arrowdown')) { const st = stock(); if (st.length) { e.preventDefault(); const d = k === 'arrowup' ? 1 : -1; cmd.count('y', (v) => v + d, d > 0 ? L('Thêm tầng', 'Stack +') : L('Bớt tầng', 'Stack −'), 'stk' + st.map((o) => o.id).join(',')); return; } }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); cmd.remove(); return; }
    if (k === 'r') { cmd.rotate(e.shiftKey ? -1 : 1); return; }
    if (k === 'f') { this.vp.frameAll(useSession.getState().sel); return; }
    if (k === 'm') { const on = !editor.get().measure; editor.set({ measure: on }); this.vp.ov.measure = on ? { a: null, b: null } : null; if (on) toast(L('Đo: bấm 2 điểm (bám góc/giữa cạnh của vật) · Esc để thoát', 'Measure: click two points (snaps to corners/edge midpoints) · Esc to exit')); this.vp.request(); return; }
    if (k === 'h' && !e.shiftKey) { editor.set({ dialog: { kind: 'shell' } }); return; }
    const st = e.shiftKey ? 10 : 1;
    if (k === 'arrowleft') { e.preventDefault(); cmd.nudge(-st, 0, 0); }
    else if (k === 'arrowright') { e.preventDefault(); cmd.nudge(st, 0, 0); }
    else if (k === 'arrowup') { e.preventDefault(); cmd.nudge(0, 0, -st); }
    else if (k === 'arrowdown') { e.preventDefault(); cmd.nudge(0, 0, st); }
    else if (k === 'pageup') { e.preventDefault(); cmd.nudge(0, st, 0); }
    else if (k === 'pagedown') { e.preventDefault(); cmd.nudge(0, -st, 0); }
  }
}


