// three.js viewport (legacy RENDER section): scissored multi-view rendering, instancing per SKU, textures, ghost
// preview, selection outline, picking, 2D overlay and off-screen snapshots. Reads the Scene; never owns business state.
import * as T from 'three';
import { fmt, L } from '../domain/i18n';
import { isStock, type Scene } from '../domain/scene';
import type { Guide } from '../domain/snap';
import type { Box, SceneObject, Sku } from '../domain/types';
import { deep } from '../domain/util';
import { lum, shade } from '../domain/colors';

export type ViewKey = 'top' | 'persp' | 'front' | 'side';
export type ViewMode = 'top' | '3d' | 'split' | 'fsplit' | 'front' | 'side';
export interface View { key: ViewKey; x: number; y: number; w: number; h: number }
interface CamTop { cx: number; cz: number; s: number } interface CamFront { cx: number; cy: number; s: number } interface CamSide { cz: number; cy: number; s: number }
interface CamPersp { tx: number; ty: number; tz: number; yaw: number; pitch: number; dist: number }
export interface CamState { top: CamTop; front: CamFront; side: CamSide; persp: CamPersp }

export interface OverlayState {
  guides: Guide[];
  marquee: { v: View; x0: number; y0: number; x1: number; y1: number } | null;
  dragInfo: { x: number; y: number; bad: boolean; lines: string[] } | null;
  supportRect: { x0: number; x1: number; z0: number; z1: number; y: number } | null;
  measure: { a: { x: number; y: number; z: number } | null; b: { x: number; y: number; z: number } | null } | null;
}

const VIEW_LABEL: Record<ViewKey, () => string> = { top: () => 'Top', persp: () => '3D', front: () => L('Trước', 'Front'), side: () => L('Bên', 'Side') };
// Canvas colours per theme (CSS variables cannot reach WebGL / 2D canvas). Exports always use the light palette.
export interface CanvasPalette { bg: number; floor: number; grid1: number; grid2: number; sel: number; label: string; dimLine: string; dimBg: string; dimInk: string; tagBg: string; tagInk: string; rulerBg: string; rulerStroke: string; rulerInk: string; divider: string }
export const PALETTES: Record<'light' | 'dark', CanvasPalette> = {
  light: { bg: 0xeef1f5, floor: 0xe2e6eb, grid1: 0xc6ccd4, grid2: 0xd6dbe1, sel: 0x1f5aa6, label: 'rgba(19,20,22,.7)', dimLine: 'rgba(19,20,22,.5)', dimBg: 'rgba(238,241,245,.94)', dimInk: '#131416', tagBg: 'rgba(19,20,22,.82)', tagInk: '#fff', rulerBg: 'rgba(255,255,255,.88)', rulerStroke: '#8a929d', rulerInk: '#5b6068', divider: '#d5dae1' },
  dark: { bg: 0x121316, floor: 0x1c1d21, grid1: 0x3a3d44, grid2: 0x2a2c31, sel: 0x6ea2e6, label: 'rgba(242,243,245,.75)', dimLine: 'rgba(242,243,245,.55)', dimBg: 'rgba(18,19,22,.92)', dimInk: '#f2f3f5', tagBg: 'rgba(242,243,245,.9)', tagInk: '#111214', rulerBg: 'rgba(23,24,27,.92)', rulerStroke: '#6b7078', rulerInk: '#a9aeb6', divider: '#2a2c31' },
};

export class Viewport {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  world = new T.Group();
  ghostGroup = new T.Group();
  floor: T.Mesh; grid: T.GridHelper;
  cams: { top: T.OrthographicCamera; front: T.OrthographicCamera; side: T.OrthographicCamera; persp: T.PerspectiveCamera };
  cam: CamState = { top: { cx: 60, cz: 40, s: 0.5 }, front: { cx: 60, cy: 60, s: 0.5 }, side: { cz: 40, cy: 60, s: 0.5 }, persp: { tx: 60, ty: 40, tz: 40, yaw: -0.62, pitch: 0.5, dist: 420 } };
  views: View[] = [];
  mode: ViewMode = 'split';
  W = 10; H = 10; dpr = 1;
  ovx: CanvasRenderingContext2D;
  ov: OverlayState = { guides: [], marquee: null, dragInfo: null, supportRect: null, measure: null };
  showGrid = true;
  selLines: T.LineSegments | null = null;
  private skuMesh = new Map<string, { mesh: T.InstancedMesh | null; sig: string; geo: T.BufferGeometry; mats: T.Material[]; cap: number; ids: string[] }>();
  private objInst = new Map<string, { skuId: string; idx: number }[]>();
  private objMesh = new Map<string, T.Object3D>();
  private tex = new Map<string, T.Texture>();
  private labelTex = new Map<string, T.Texture>();
  private need = false;
  private s: Scene | null = null;
  private sel = new Set<string>();
  private ray = new T.Raycaster();
  private ndc = new T.Vector2();
  private ro: ResizeObserver;
  lastSnap: CamFront | null = null;
  pal: CanvasPalette = PALETTES.light;

  constructor(public host: HTMLElement, public gl: HTMLCanvasElement, public overlay: HTMLCanvasElement, public asset: (id?: string | null) => string | undefined) {
    this.renderer = new T.WebGLRenderer({ canvas: gl, antialias: true, alpha: false, preserveDrawingBuffer: true });
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.setClearColor(this.pal.bg, 1);
    this.scene.add(new T.HemisphereLight(0xffffff, 0x8a94a3, 0.85 * Math.PI));
    const dl = new T.DirectionalLight(0xffffff, 0.55 * Math.PI); dl.position.set(-150, 300, 260); this.scene.add(dl);
    const dl2 = new T.DirectionalLight(0xffffff, 0.18 * Math.PI); dl2.position.set(200, 120, -200); this.scene.add(dl2);
    this.floor = new T.Mesh(new T.PlaneGeometry(4000, 4000), new T.MeshLambertMaterial({ color: 0xe2e6eb }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.position.y = -0.05; this.scene.add(this.floor);
    this.grid = new T.GridHelper(1000, 100, this.pal.grid1, this.pal.grid2); this.scene.add(this.grid);
    this.scene.add(this.world); this.scene.add(this.ghostGroup);
    this.cams = { top: new T.OrthographicCamera(-1, 1, 1, -1, -5000, 5000), front: new T.OrthographicCamera(-1, 1, 1, -1, -5000, 5000), side: new T.OrthographicCamera(-1, 1, 1, -1, -5000, 5000), persp: new T.PerspectiveCamera(38, 1, 1, 20000) };
    this.cams.top.up.set(0, 0, -1);
    this.ovx = overlay.getContext('2d')!;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
  }

  /** Switch canvas colours (background, floor, grid, overlays, selection). */
  setTheme(dark: boolean) {
    const p = PALETTES[dark ? 'dark' : 'light'];
    if (p === this.pal) return;
    this.pal = p;
    this.renderer.setClearColor(p.bg, 1);
    (this.floor.material as T.MeshLambertMaterial).color.set(p.floor);
    this.scene.remove(this.grid); this.grid.dispose();
    this.grid = new T.GridHelper(1000, 100, p.grid1, p.grid2); this.scene.add(this.grid);
    this.updateSelection(this.sel);
    this.request();
  }

  dispose() { this.ro.disconnect(); this.renderer.dispose(); for (const t of this.tex.values()) t.dispose(); for (const t of this.labelTex.values()) t.dispose(); }

  resize() {
    const r = this.host.getBoundingClientRect();
    this.W = Math.max(10, Math.floor(r.width)); this.H = Math.max(10, Math.floor(r.height)); this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.W, this.H, false);
    this.gl.style.width = this.W + 'px'; this.gl.style.height = this.H + 'px';
    this.overlay.width = this.W * this.dpr; this.overlay.height = this.H * this.dpr; this.overlay.style.width = this.W + 'px'; this.overlay.style.height = this.H + 'px';
    this.layout(); this.request();
  }

  setMode(m: ViewMode) { this.mode = m; this.layout(); this.request(); }
  layout() {
    const W = this.W, H = this.H, v = this.mode;
    this.views = [];
    if (v === 'split' || v === 'fsplit') { const a = Math.floor(W * (v === 'fsplit' ? 0.58 : 0.5)); /* the Front view is where shelves are edited */ this.views.push({ key: v === 'split' ? 'top' : 'front', x: 0, y: 0, w: a, h: H }, { key: 'persp', x: a, y: 0, w: W - a, h: H }); }
    else this.views.push({ key: v === '3d' ? 'persp' : (v as ViewKey), x: 0, y: 0, w: W, h: H });
  }
  viewAt(px: number, py: number) { return this.views.find((v) => px >= v.x && px < v.x + v.w && py >= v.y && py < v.y + v.h) || null; }

  updateCam(v: View) {
    if (v.key === 'persp') {
      const c = this.cams.persp, s = this.cam.persp, cp = Math.cos(s.pitch);
      c.aspect = v.w / v.h;
      c.position.set(s.tx + s.dist * cp * Math.sin(s.yaw), s.ty + s.dist * Math.sin(s.pitch), s.tz + s.dist * cp * Math.cos(s.yaw));
      c.lookAt(s.tx, s.ty, s.tz); c.updateProjectionMatrix(); c.updateMatrixWorld();
      return c;
    }
    const c = this.cams[v.key], s = this.cam[v.key] as { s: number }, hw = (v.w * s.s) / 2, hh = (v.h * s.s) / 2;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    if (v.key === 'top') { const t = this.cam.top; c.position.set(t.cx, 2000, t.cz); c.lookAt(t.cx, 0, t.cz); }
    else if (v.key === 'front') { const t = this.cam.front; c.position.set(t.cx, t.cy, 3000); c.lookAt(t.cx, t.cy, 0); }
    else { const t = this.cam.side; c.position.set(3000, t.cy, t.cz); c.lookAt(0, t.cy, t.cz); }
    c.updateProjectionMatrix(); c.updateMatrixWorld();
    return c;
  }

  request() { if (this.need) return; this.need = true; requestAnimationFrame(() => this.renderNow()); }
  renderNow() {
    this.need = false;
    const r = this.renderer;
    r.setScissorTest(true);
    for (const v of this.views) {
      const c = this.updateCam(v), y = this.H - v.y - v.h;
      r.setViewport(v.x, y, v.w, v.h); r.setScissor(v.x, y, v.w, v.h);
      this.grid.visible = this.showGrid && v.key !== 'front' && v.key !== 'side';
      this.floor.visible = v.key !== 'top';
      r.render(this.scene, c);
    }
    this.drawOverlay();
  }

  // ---------- textures ----------
  private assetTex(id?: string | null): T.Texture | null {
    if (!id) return null;
    const src = this.asset(id);
    if (!src) return null;
    let tx = this.tex.get(id);
    if (tx) return tx;
    const im = new Image();
    tx = new T.Texture(im); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 4;
    const t = tx;
    im.onload = () => { t.needsUpdate = true; this.request(); };
    im.src = src;
    this.tex.set(id, tx);
    return tx;
  }
  /** Plain face with border and short name, used when a SKU has no artwork for that face. */
  private labelTexture(k: Sku, face: string, wcm: number, hcm: number) {
    const key = k.id + '|' + face + '|' + k.color + '|' + k.name + '|' + wcm + 'x' + hcm;
    let tx = this.labelTex.get(key);
    if (tx) return tx;
    const W = 256, H = Math.max(16, Math.min(512, Math.round((256 * hcm) / Math.max(1, wcm)))), c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = k.color || '#999'; g.fillRect(0, 0, W, H);
    g.strokeStyle = shade(k.color || '#999', 0.62); g.lineWidth = Math.max(3, W / 60); g.strokeRect(1.5, 1.5, W - 3, H - 3);
    if (face === 'front' || face === 'back' || face === 'top') {
      const txt = String(k.name || k.code || '').replace(/^(TH\.?\s*\d+|THÙNG|LỐC\s*\d*)\s*/i, '');
      g.fillStyle = lum(k.color || '#999') > 0.6 ? '#1b2533' : '#ffffff';
      const fs = Math.max(12, Math.min(30, H / 4));
      g.font = `600 ${fs}px "IBM Plex Sans", Segoe UI, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      const words = txt.split(/\s+/), lines: string[] = [];
      let cur = '';
      for (const w of words) { const tt = cur ? cur + ' ' + w : w; if (g.measureText(tt).width > W - 20 && cur) { lines.push(cur); cur = w; } else cur = tt; }
      if (cur) lines.push(cur);
      const maxL = Math.max(1, Math.floor((H - 10) / (fs * 1.15))), Ls = lines.slice(0, maxL);
      Ls.forEach((l, i) => g.fillText(l, W / 2, H / 2 + (i - (Ls.length - 1) / 2) * fs * 1.15));
    }
    tx = new T.CanvasTexture(c); tx.colorSpace = T.SRGBColorSpace;
    this.labelTex.set(key, tx);
    return tx;
  }
  private faceMat(k: Sku, face: 'front' | 'back' | 'left' | 'right' | 'top', wcm: number, hcm: number) {
    const f = k.faces || {};
    const id = f[face] || (face === 'back' && f.front) || (face === 'left' && f.right) || (face === 'right' && f.left) || null;
    const tx = id ? this.assetTex(id) : null;
    return new T.MeshLambertMaterial({ map: tx || this.labelTexture(k, face, wcm, hcm) });
  }
  private skuSig(k: Sku) { return JSON.stringify([k.w, k.d, k.h, k.form, k.pkg, k.color, k.name, k.faces, this.asset(k.faces?.front) ? 1 : 0]); }
  private skuGeoMats(k: Sku) {
    const w = +k.w, d = +k.d, h = +k.h;
    if (k.form === 'unit' && Math.abs(w - d) <= 1.2 && Math.max(w, d) <= 13) {
      const r = Math.max(0.5, Math.min(w, d) / 2), geo = new T.CylinderGeometry(r * 0.97, r, h, 20, 1);
      geo.translate(0, h / 2, 0);
      const tx = this.assetTex(k.faces && k.faces.front);
      let side: T.Material;
      if (tx) { const t2 = tx.clone(); t2.wrapS = T.RepeatWrapping; t2.repeat.set(2, 1); t2.offset.set(0.5, 0); t2.needsUpdate = true; const img = t2.image as HTMLImageElement; if (!(img && img.complete && img.naturalWidth)) img?.addEventListener('load', () => { t2.needsUpdate = true; this.request(); }, { once: true }); side = new T.MeshLambertMaterial({ map: t2 }); }
      else side = new T.MeshLambertMaterial({ color: k.color || '#999' });
      return { geo, mats: [side, new T.MeshLambertMaterial({ color: shade(k.color || '#999', 1.15) }), new T.MeshLambertMaterial({ color: shade(k.color || '#999', 0.7) })] };
    }
    const geo = new T.BoxGeometry(w, h, d);
    geo.translate(0, h / 2, 0);
    // BoxGeometry material order: +X right, −X left, +Y top, −Y bottom, +Z front, −Z back
    return { geo, mats: [this.faceMat(k, 'right', d, h), this.faceMat(k, 'left', d, h), this.faceMat(k, 'top', w, d), new T.MeshLambertMaterial({ color: shade(k.color || '#999', 0.6) }), this.faceMat(k, 'front', w, h), this.faceMat(k, 'back', w, h)] };
  }

  private _m = new T.Matrix4(); private _m2 = new T.Matrix4(); private _q = new T.Quaternion(); private _v = new T.Vector3(); private _one = new T.Vector3(1, 1, 1); private _y = new T.Vector3(0, 1, 0);
  objMatrix(o: { pos: { x: number; y: number; z: number }; ry?: number }, out: T.Matrix4) { this._q.setFromAxisAngle(this._y, ((o.ry || 0) * Math.PI) / 180); this._v.set(o.pos.x, o.pos.y, o.pos.z); return out.compose(this._v, this._q, this._one); }
  cellMatrices(s: Scene, o: SceneObject) {
    const base = this.objMatrix(o, new T.Matrix4());
    if (o.type !== 'array') return [base];
    const out: T.Matrix4[] = [], cr = ((o.cellRy || 0) * Math.PI) / 180;
    for (const c of s.arrayCells(o)) { this._q.setFromAxisAngle(this._y, cr); this._v.set(c.x, c.y, c.z); this._m2.compose(this._v, this._q, this._one); out.push(new T.Matrix4().multiplyMatrices(base, this._m2)); }
    return out;
  }

  // ---------- scene sync ----------
  rebuild(s: Scene, sel: Set<string>) {
    this.s = s; this.sel = sel;
    s.invalidate();
    const per = new Map<string, { k: Sku; list: { m: T.Matrix4; id: string }[] }>();
    this.objInst.clear();
    for (const o of s.d.objects) {
      if (o.hidden || !isStock(o)) continue;
      const k = s.skuOf(o);
      if (!k) continue;
      let e = per.get(k.id);
      if (!e) { e = { k, list: [] }; per.set(k.id, e); }
      const rec: { skuId: string; idx: number }[] = [];
      for (const m of this.cellMatrices(s, o)) { rec.push({ skuId: k.id, idx: e.list.length }); e.list.push({ m, id: o.id }); }
      this.objInst.set(o.id, rec);
    }
    for (const [id, e] of this.skuMesh) {
      const p = per.get(id);
      if (!p || e.sig !== this.skuSig(p.k) || e.cap < p.list.length) {
        if (e.mesh) this.world.remove(e.mesh);
        if (!p || e.sig !== this.skuSig(p.k)) { e.geo.dispose(); e.mats.forEach((m) => m.dispose()); e.mesh?.dispose(); this.skuMesh.delete(id); }
        else { e.mesh?.dispose(); e.mesh = null; e.cap = 0; }
      }
    }
    for (const [id, p] of per) {
      let e = this.skuMesh.get(id);
      if (!e) { const gm = this.skuGeoMats(p.k); e = { sig: this.skuSig(p.k), geo: gm.geo, mats: gm.mats, mesh: null, cap: 0, ids: [] }; this.skuMesh.set(id, e); }
      if (!e.mesh) { const cap = Math.max(8, Math.ceil(p.list.length * 1.5)); e.mesh = new T.InstancedMesh(e.geo, e.mats, cap); e.mesh.frustumCulled = false; e.mesh.instanceMatrix.setUsage(T.DynamicDrawUsage); e.cap = cap; this.world.add(e.mesh); }
      e.mesh.count = p.list.length; e.ids = p.list.map((x) => x.id);
      p.list.forEach((x, i) => e!.mesh!.setMatrixAt(i, x.m));
      e.mesh.instanceMatrix.needsUpdate = true; e.mesh.userData.skuId = id;
    }
    for (const [, m] of this.objMesh) { this.world.remove(m); this.disposeObj(m); }
    this.objMesh.clear();
    for (const o of s.d.objects) {
      if (o.hidden || isStock(o)) continue;
      const m = this.buildMesh(o);
      if (!m) continue;
      m.traverse((c) => { c.userData.objId = o.id; });
      this.objMatrix(o, m.matrix); m.matrixAutoUpdate = false;
      this.world.add(m); this.objMesh.set(o.id, m);
    }
    this.updateSelection(sel);
  }

  /** Fast path while dragging: rewrite matrices of the given objects only. */
  updateObjects(ids: Iterable<string>) {
    const s = this.s;
    if (!s) return;
    s.invalidateGeom();
    const dirty = new Set<T.InstancedMesh>();
    for (const id of ids) {
      const o = s.get(id);
      if (!o) continue;
      if (isStock(o)) {
        const rec = this.objInst.get(id);
        if (!rec) continue;
        const ms = this.cellMatrices(s, o);
        rec.forEach((r, i) => { const e = this.skuMesh.get(r.skuId); if (e && e.mesh && ms[i]) { e.mesh.setMatrixAt(r.idx, ms[i]); dirty.add(e.mesh); } });
      } else { const m = this.objMesh.get(id); if (m) { this.objMatrix(o, m.matrix); m.matrixWorldNeedsUpdate = true; } }
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true;
    this.updateSelection(this.sel);
  }

  private disposeObj(m: T.Object3D) { m.traverse((c) => { const x = c as T.Mesh; if (x.geometry) x.geometry.dispose(); if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((mm) => mm.dispose()); }); }
  private palletTextures(w: number, d: number) {
    const c = document.createElement('canvas'), W = 512, H = Math.max(32, Math.round((512 * d) / w));
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    g.fillStyle = '#6f5232'; g.fillRect(0, 0, W, H);
    const n = Math.max(5, Math.round(d / 14)), gap = (H / n) * 0.22;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) { const y = (i * H) / n + gap / 2; g.fillStyle = i % 2 ? '#c79a62' : '#cfa46c'; g.fillRect(0, y, W, H / n - gap); g.fillStyle = 'rgba(90,60,30,.25)'; for (let k = 0; k < 6; k++) g.fillRect(rnd() * W, y + rnd() * (H / n - gap), 40 + rnd() * 80, 1.5); }
    const top = new T.CanvasTexture(c); top.colorSpace = T.SRGBColorSpace;
    const sc = document.createElement('canvas'); sc.width = 512; sc.height = 64;
    const q = sc.getContext('2d')!;
    q.fillStyle = '#b98d55'; q.fillRect(0, 0, 512, 64); q.fillStyle = '#3e2c19'; q.fillRect(0, 12, 512, 40); q.fillStyle = '#b98d55';
    [[0, 70], [221, 70], [442, 70]].forEach(([x, ww]) => q.fillRect(x, 12, ww, 40));
    const side = new T.CanvasTexture(sc); side.colorSpace = T.SRGBColorSpace;
    return { top, side };
  }
  private buildMesh(o: SceneObject): T.Object3D | null {
    if (o.type === 'sku' || o.type === 'array') return null;
    const s = o.size, lam = (c: string | number) => new T.MeshLambertMaterial({ color: c });
    if (o.type === 'struct') { const g = new T.BoxGeometry(s.w, s.h, Math.max(0.2, s.d)); g.translate(0, s.h / 2, 0); return new T.Mesh(g, lam(o.color || '#c9d0d8')); }
    if (o.type === 'fixture') {
      const g = new T.Group(), fx = o.fx || { panel: 2, kick: 12 }, P = fx.panel || 2;
      const add = (w: number, h: number, d: number, x: number, y: number, z: number, c: string) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), lam(c)); m.position.set(x, y + h / 2, z); g.add(m); };
      add(s.w - 0.4, s.h, P, 0, 0, -s.d / 2 + P / 2, '#d7dce3'); add(3, s.h, P + 3, -s.w / 2 + 1.5, 0, -s.d / 2 + (P + 3) / 2, '#6b7480'); add(3, s.h, P + 3, s.w / 2 - 1.5, 0, -s.d / 2 + (P + 3) / 2, '#6b7480');
      add(s.w - 0.4, Math.max(1, (fx.kick || 12) - 3), 1, 0, 0, s.d / 2 - 0.5, '#59626e');
      return g;
    }
    if (o.type === 'shelf') { const g = new T.BoxGeometry(s.w - 0.2, s.h, s.d); g.translate(0, s.h / 2, 0); const top = lam('#e3e7ec'), side = lam('#b8c0ca'), strip = lam('#7f8b98'); return new T.Mesh(g, [side, side, top, side, strip, side]); }
    if (o.type === 'pallet') { const g = new T.BoxGeometry(s.w, s.h, s.d); g.translate(0, s.h / 2, 0); const tx = this.palletTextures(s.w, s.d), sm = new T.MeshLambertMaterial({ map: tx.side }), tm = new T.MeshLambertMaterial({ map: tx.top }); return new T.Mesh(g, [sm, sm, tm, lam(0x5a4228), sm, sm]); }
    if (o.type === 'posm') {
      const tx = this.assetTex(o.asset);
      if (tx && o.cutout) { const g = new T.PlaneGeometry(s.w, s.h); g.translate(0, s.h / 2, 0); return new T.Mesh(g, new T.MeshLambertMaterial({ map: tx, transparent: false, alphaTest: 0.45, side: T.DoubleSide })); }
      const g = new T.BoxGeometry(s.w, s.h, Math.max(0.2, s.d)); g.translate(0, s.h / 2, 0);
      const edge = lam(o.color || '#ffffff'), face = tx ? new T.MeshLambertMaterial({ map: tx }) : edge, bt = this.assetTex(o.backAsset), back = bt ? new T.MeshLambertMaterial({ map: bt }) : face;
      return new T.Mesh(g, [edge, edge, edge, edge, face, back]);
    }
    if (o.type === 'prop') { const tx = this.assetTex(o.asset), g = new T.BoxGeometry(s.w, s.h, s.d); g.translate(0, s.h / 2, 0); const c = lam(o.color || '#f4a3c0'), f = tx ? new T.MeshLambertMaterial({ map: tx }) : c; return new T.Mesh(g, [c, c, c, c, f, f]); }
    return null;
  }

  // ---------- selection outline ----------
  updateSelection(sel: Set<string>) {
    this.sel = sel;
    if (this.selLines) { this.scene.remove(this.selLines); this.selLines.geometry.dispose(); this.selLines = null; }
    const s = this.s;
    if (!s || !sel.size) { this.request(); return; }
    const pos: number[] = [];
    for (const id of sel) { const o = s.get(id); if (!o) continue; const b = s.aabb(o); boxEdges({ x0: b.x0 - 0.15, x1: b.x1 + 0.15, y0: b.y0 - 0.1, y1: b.y1 + 0.15, z0: b.z0 - 0.15, z1: b.z1 + 0.15 }, pos); }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    this.selLines = new T.LineSegments(g, new T.LineBasicMaterial({ color: this.pal.sel, depthTest: false, transparent: true, opacity: 0.95 }));
    this.selLines.renderOrder = 10;
    this.scene.add(this.selLines);
    this.request();
  }

  // ---------- ghost (preview) ----------
  clearGhost() { for (const c of [...this.ghostGroup.children]) { this.ghostGroup.remove(c); this.disposeObj(c); } this.request(); }
  /** items: [{k (sku) | box, matrices}], bad = red. */
  setGhost(items: { k?: Sku | null; box?: { w: number; d: number; h: number }; matrices: T.Matrix4[] }[], bad: boolean) {
    this.clearGhost();
    const col = bad ? 0xc4242a : 0x1f5aa6;
    for (const it of items) {
      let geo: T.BufferGeometry;
      if (it.k) { const w = +it.k.w, d = +it.k.d, h = +it.k.h; geo = it.k.form === 'unit' ? new T.CylinderGeometry(Math.min(w, d) / 2, Math.min(w, d) / 2, h, 14) : new T.BoxGeometry(w, h, d); geo.translate(0, h / 2, 0); }
      else { geo = new T.BoxGeometry(it.box!.w, it.box!.h, Math.max(0.3, it.box!.d)); geo.translate(0, it.box!.h / 2, 0); }
      const m = new T.InstancedMesh(geo, new T.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.38, depthWrite: false }), it.matrices.length);
      m.frustumCulled = false; it.matrices.forEach((x, i) => m.setMatrixAt(i, x)); m.renderOrder = 5; this.ghostGroup.add(m);
      if (it.matrices.length <= 400) {
        const eg = new T.EdgesGeometry(geo), pos: number[] = [], src = eg.attributes.position.array, v = new T.Vector3();
        for (const M of it.matrices) for (let i = 0; i < src.length; i += 3) { v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(M); pos.push(v.x, v.y, v.z); }
        eg.dispose();
        const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        const l = new T.LineSegments(lg, new T.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9, depthTest: false })); l.renderOrder = 6; this.ghostGroup.add(l);
      }
    }
    this.request();
  }
  ghostFor(s: Scene, o: SceneObject, bad: boolean) {
    const M = this.objMatrix(o, new T.Matrix4());
    this.setGhost([o.type === 'array' ? { k: s.skuOf(o), matrices: this.cellMatrices(s, o) } : o.type === 'sku' ? { k: s.skuOf(o), matrices: [M] } : { box: (o as { size: { w: number; d: number; h: number } }).size, matrices: [M] }], bad);
  }

  // ---------- picking ----------
  rayFor(v: View, px: number, py: number) { this.ndc.set(((px - v.x) / v.w) * 2 - 1, -((py - v.y) / v.h) * 2 + 1); const c = this.updateCam(v); this.ray.setFromCamera(this.ndc, c); return this.ray; }
  pick(v: View, px: number, py: number, opts: { skipLocked?: boolean } = {}) {
    const ray = this.rayFor(v, px, py), hits = ray.intersectObjects(this.world.children, true), s = this.s;
    if (!s) return null;
    for (const h of hits) {
      let id: string | null = null;
      if ((h.object as T.InstancedMesh).isInstancedMesh) { const e = this.skuMesh.get(h.object.userData.skuId); id = e && e.ids && h.instanceId != null ? e.ids[h.instanceId] : null; }
      else id = h.object.userData.objId;
      if (!id) continue;
      const o = s.get(id);
      if (!o) continue;
      if (opts.skipLocked && o.lock) continue;
      return { id, point: h.point.clone() };
    }
    return null;
  }
  rayPlaneY(v: View, px: number, py: number, y: number) { const r = this.rayFor(v, px, py), d = r.ray.direction, o = r.ray.origin; if (Math.abs(d.y) < 1e-6) return null; const tt = (y - o.y) / d.y; if (tt < 0) return null; return { x: o.x + d.x * tt, y, z: o.z + d.z * tt }; }
  rayPlaneZ(v: View, px: number, py: number, z: number) { const r = this.rayFor(v, px, py), d = r.ray.direction, o = r.ray.origin; if (Math.abs(d.z) < 1e-6) return null; const tt = (z - o.z) / d.z; return { x: o.x + d.x * tt, y: o.y + d.y * tt, z }; }
  toScreen(v: View, x: number, y: number, z: number) { const c = this.updateCam(v); this._v.set(x, y, z).project(c); return { x: v.x + ((this._v.x + 1) / 2) * v.w, y: v.y + ((1 - this._v.y) / 2) * v.h, behind: this._v.z > 1 }; }
  cmPerPx(v: View) { if (v.key === 'persp') { const s = this.cam.persp; return (2 * s.dist * Math.tan((this.cams.persp.fov * Math.PI) / 360)) / v.h; } return (this.cam[v.key] as { s: number }).s; }

  // ---------- camera framing ----------
  frameBox(b: Box | null, keys?: ViewKey[]) {
    if (!b) return;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, cz = (b.z0 + b.z1) / 2, W = b.x1 - b.x0, H = b.y1 - b.y0, Dp = b.z1 - b.z0;
    for (const v of this.views.length ? this.views : [{ key: 'top' as ViewKey, w: this.W, h: this.H, x: 0, y: 0 }]) {
      if (keys && !keys.includes(v.key)) continue;
      if (v.key === 'top') Object.assign(this.cam.top, { cx, cz, s: Math.max(W / (v.w * 0.8), Dp / (v.h * 0.75), 0.05) });
      else if (v.key === 'front') Object.assign(this.cam.front, { cx, cy, s: Math.max(W / (v.w * 0.8), H / (v.h * 0.8), 0.05) });
      else if (v.key === 'side') Object.assign(this.cam.side, { cz, cy, s: Math.max(Dp / (v.w * 0.8), H / (v.h * 0.8), 0.05) });
      else { const s = this.cam.persp, r = Math.sqrt(W * W + H * H + Dp * Dp) / 2; Object.assign(s, { tx: cx, ty: cy * 0.8, tz: cz, dist: Math.max(60, (r / Math.tan((this.cams.persp.fov * Math.PI) / 360)) * 0.98 * Math.max(1, (v.h / v.w) * 0.9)) }); }
    }
    if (!this.views.some((v) => v.key === 'persp')) Object.assign(this.cam.persp, { tx: cx, ty: cy * 0.8, tz: cz });
    this.request();
  }
  frameAll(sel: Set<string>) {
    const s = this.s;
    if (!s) return;
    const os = [...sel].map((id) => s.get(id)).filter((o): o is SceneObject => !!o);
    const b = os.length ? unionBoxes(os.map((o) => s.aabb(o))) : s.sceneBox(true);
    this.frameBox(b ? { ...b, y1: Math.max(b.y1, 40) } : { x0: 0, x1: 120, y0: 0, y1: 60, z0: 0, z1: 80 });
  }

  // ---------- overlay ----------
  private drawOverlay() {
    const g = this.ovx, d = this.dpr, s = this.s;
    g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, this.W, this.H);
    for (const v of this.views) {
      g.save(); g.beginPath(); g.rect(v.x, v.y, v.w, v.h); g.clip();
      g.font = '500 12px "IBM Plex Sans", Segoe UI, Arial'; g.fillStyle = this.pal.label;
      g.fillText(VIEW_LABEL[v.key](), v.x + (v.key === 'front' || v.key === 'side' ? 44 : 12), v.y + 20);
      if (s) { if (v.key === 'persp') this.drawDims3D(g, v, s); else this.drawDims(g, v, s); }
      this.drawRuler(g, v); this.drawMeasure(g, v);
      const sr = this.ov.supportRect;
      if (sr && (v.key === 'top' || v.key === 'persp')) {
        const P = [[sr.x0, sr.y, sr.z0], [sr.x1, sr.y, sr.z0], [sr.x1, sr.y, sr.z1], [sr.x0, sr.y, sr.z1]].map((p) => this.toScreen(v, p[0], p[1], p[2]));
        g.beginPath(); P.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
        g.fillStyle = 'rgba(31,90,166,.10)'; g.fill(); g.setLineDash([5, 4]); g.strokeStyle = 'rgba(31,90,166,.9)'; g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
      }
      for (const gd of this.ov.guides) {
        const a = gd.axis === 'x' ? this.toScreen(v, gd.v, gd.y, gd.a0 - 15) : this.toScreen(v, gd.a0 - 15, gd.y, gd.v), b = gd.axis === 'x' ? this.toScreen(v, gd.v, gd.y, gd.a1 + 15) : this.toScreen(v, gd.a1 + 15, gd.y, gd.v);
        g.strokeStyle = '#d0287a'; g.lineWidth = 1.2; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); g.setLineDash([]);
      }
      const m = this.ov.marquee;
      if (m && m.v.key === v.key && m.v.x === v.x) { g.fillStyle = 'rgba(31,90,166,.10)'; g.strokeStyle = '#1f5aa6'; g.lineWidth = 1; const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1); g.fillRect(x, y, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); g.strokeRect(x + 0.5, y + 0.5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); }
      g.restore();
    }
    if (this.views.length > 1) { g.fillStyle = this.pal.divider; g.fillRect(this.views[1].x - 1, 0, 1, this.H); }
    const di = this.ov.dragInfo;
    if (di) {
      g.font = '500 12px "IBM Plex Sans", Segoe UI, Arial';
      const w = Math.max(...di.lines.map((l) => g.measureText(l).width)) + 16, h = di.lines.length * 17 + 8;
      let x = di.x + 16, y = di.y + 18;
      if (x + w > this.W) x = di.x - w - 10;
      if (y + h > this.H) y = di.y - h - 10;
      g.fillStyle = di.bad ? 'rgba(160,26,32,.94)' : 'rgba(19,20,22,.9)'; roundRect(g, x, y, w, h, 6); g.fill();
      g.fillStyle = '#fff'; di.lines.forEach((l, i) => g.fillText(l, x + 8, y + 18 + i * 17));
    }
  }
  private dimLine(g: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, text: string, off: number) {
    const dx = b.x - a.x, dy = b.y - a.y, Ln = Math.hypot(dx, dy);
    if (Ln < 30) return;
    const nx = (-dy / Ln) * off, ny = (dx / Ln) * off, A = { x: a.x + nx, y: a.y + ny }, B = { x: b.x + nx, y: b.y + ny };
    g.strokeStyle = this.pal.dimLine; g.lineWidth = 1; g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.moveTo(a.x, a.y); g.lineTo(A.x + nx * 0.25, A.y + ny * 0.25); g.moveTo(b.x, b.y); g.lineTo(B.x + nx * 0.25, B.y + ny * 0.25); g.stroke();
    g.save(); g.translate((A.x + B.x) / 2, (A.y + B.y) / 2);
    let ang = Math.atan2(dy, dx); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    g.rotate(ang); g.font = '500 11px "IBM Plex Sans", Segoe UI, Arial';
    const tw = g.measureText(text).width + 8;
    g.fillStyle = this.pal.dimBg; g.fillRect(-tw / 2, -8, tw, 15); g.fillStyle = this.pal.dimInk; g.textAlign = 'center'; g.fillText(text, 0, 4); g.restore();
  }
  private selBox(s: Scene) { const os = [...this.sel].map((id) => s.get(id)).filter((o): o is SceneObject => !!o); return os.length ? unionBoxes(os.map((o) => s.aabb(o))) : s.sceneBox(true); }
  private drawDims(g: CanvasRenderingContext2D, v: View, s: Scene) {
    const b = this.selBox(s);
    if (!b) return;
    if (v.key === 'front' && s.isShelfMode) {
      g.font = '500 11px "IBM Plex Sans", Segoe UI, Arial';
      for (const o of s.d.objects) {
        if (o.type !== 'shelf') continue;
        const t = s.aabb(o), p = this.toScreen(v, t.x0, t.y1, t.z1);
        if (t.x0 > b.x0 + 1) continue;
        const tx = fmt(t.y1) + ' cm', tw = g.measureText(tx).width + 8, lx = Math.max(v.x + 40, p.x - tw - 6);
        g.fillStyle = this.pal.tagBg; g.fillRect(lx, p.y - 8, tw, 15); g.fillStyle = this.pal.tagInk; g.fillText(tx, lx + 4, p.y + 3);
      }
    }
    const T2 = (x: number, y: number, z: number) => this.toScreen(v, x, y, z);
    if (v.key === 'top') { this.dimLine(g, T2(b.x0, b.y1, b.z1), T2(b.x1, b.y1, b.z1), fmt(b.x1 - b.x0) + ' cm', 22); this.dimLine(g, T2(b.x1, b.y1, b.z0), T2(b.x1, b.y1, b.z1), fmt(b.z1 - b.z0) + ' cm', -22); }
    else if (v.key === 'front') { this.dimLine(g, T2(b.x0, b.y0, b.z1), T2(b.x1, b.y0, b.z1), fmt(b.x1 - b.x0) + ' cm', -22); this.dimLine(g, T2(b.x1, b.y0, b.z1), T2(b.x1, b.y1, b.z1), fmt(b.y1 - b.y0) + ' cm', -22); }
    else { this.dimLine(g, T2(b.x1, b.y0, b.z1), T2(b.x1, b.y0, b.z0), fmt(b.z1 - b.z0) + ' cm', -22); this.dimLine(g, T2(b.x1, b.y0, b.z0), T2(b.x1, b.y1, b.z0), fmt(b.y1 - b.y0) + ' cm', 22); }
  }
  private drawDims3D(g: CanvasRenderingContext2D, v: View, s: Scene) {
    const b = this.selBox(s);
    if (!b) return;
    const p = this.cam.persp, front = Math.cos(p.yaw) >= 0, right = Math.sin(p.yaw) >= 0, zF = front ? b.z1 : b.z0, xR = right ? b.x1 : b.x0;
    const T2 = (x: number, y: number, z: number) => this.toScreen(v, x, y, z);
    this.dimLine(g, T2(b.x0, b.y0, zF), T2(b.x1, b.y0, zF), fmt(b.x1 - b.x0) + ' cm', front ? 18 : -18);
    this.dimLine(g, T2(xR, b.y0, b.z0), T2(xR, b.y0, b.z1), fmt(b.z1 - b.z0) + ' cm', right ? -18 : 18);
    this.dimLine(g, T2(xR, b.y0, zF), T2(xR, b.y1, zF), fmt(b.y1 - b.y0) + ' cm', right ? -20 : 20);
    if (this.sel.size && b.y0 > 0.5) { g.setLineDash([3, 3]); this.dimLine(g, T2(xR, 0, zF), T2(xR, b.y0, zF), L('đáy ', 'base ') + fmt(b.y0), right ? -20 : 20); g.setLineDash([]); }
  }
  private drawRuler(g: CanvasRenderingContext2D, v: View) {
    if (v.key !== 'front' && v.key !== 'side') return;
    const k = this.cmPerPx(v), step = k > 1.2 ? 50 : k > 0.6 ? 20 : 10;
    g.fillStyle = this.pal.rulerBg; g.fillRect(v.x, v.y, 36, v.h);
    g.strokeStyle = this.pal.rulerStroke; g.lineWidth = 1; g.font = '11px "IBM Plex Sans", Segoe UI, Arial'; g.fillStyle = this.pal.rulerInk;
    for (let y = 0; y <= 500; y += step / 2) { const sy = this.toScreen(v, 0, y, 0).y; if (sy < v.y || sy > v.y + v.h) continue; const major = y % step === 0; g.beginPath(); g.moveTo(v.x + 36, sy); g.lineTo(v.x + 36 - (major ? 10 : 5), sy); g.stroke(); if (major) g.fillText(String(y), v.x + 3, sy + 4); }
    g.fillText('cm', v.x + 3, v.y + v.h - 6);
  }
  private drawMeasure(g: CanvasRenderingContext2D, v: View) {
    const m = this.ov.measure;
    if (!m || !m.a) return;
    const A = this.toScreen(v, m.a.x, m.a.y, m.a.z);
    g.fillStyle = '#d0287a'; g.beginPath(); g.arc(A.x, A.y, 4, 0, 7); g.fill();
    if (!m.b) return;
    const B = this.toScreen(v, m.b.x, m.b.y, m.b.z);
    g.strokeStyle = '#d0287a'; g.lineWidth = 2; g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); g.beginPath(); g.arc(B.x, B.y, 4, 0, 7); g.fill();
    const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, dz = m.b.z - m.a.z, dd = Math.hypot(dx, dy, dz), lab = `${fmt(dd)} cm  (X ${fmt(Math.abs(dx))} · Y ${fmt(Math.abs(dy))} · Z ${fmt(Math.abs(dz))})`;
    g.font = '600 12px "IBM Plex Sans", Segoe UI, Arial';
    const tw = g.measureText(lab).width + 12, x = (A.x + B.x) / 2 - tw / 2, y = (A.y + B.y) / 2 - 24;
    g.fillStyle = 'rgba(208,40,122,.95)'; roundRect(g, x, y, tw, 20, 5); g.fill(); g.fillStyle = '#fff'; g.fillText(lab, x + 6, y + 14);
  }

  // ---------- snapshots ----------
  /** Render one camera into an off-screen size (white background, framed on the whole scene). */
  snapshot(key: ViewKey, W = 1600, H = 1100, opts: { keepAngle?: boolean } = { keepAngle: true }) {
    const r = this.renderer, v: View = { key, x: 0, y: 0, w: W, h: H }, saved = { views: this.views, cam: deep(this.cam) };
    const selL = this.selLines;
    if (selL) selL.visible = false;
    this.ghostGroup.visible = false;
    this.views = [v];
    r.setPixelRatio(1); r.setSize(W, H, false);
    this.frameBox(this.s ? this.s.sceneBox(true) : null, [key]);
    if (key === 'persp' && opts.keepAngle) { this.cam.persp.yaw = saved.cam.persp.yaw; this.cam.persp.pitch = saved.cam.persp.pitch; }
    r.setScissorTest(false); r.setViewport(0, 0, W, H);
    this.grid.visible = false; this.floor.visible = key !== 'top';
    const floorMat = this.floor.material as T.MeshLambertMaterial;
    floorMat.color.set(PALETTES.light.floor);
    r.setClearColor(0xffffff, 1);
    r.render(this.scene, this.updateCam(v));
    const url = this.gl.toDataURL('image/png');
    this.lastSnap = key === 'front' ? { ...this.cam.front } : null;
    r.setClearColor(this.pal.bg, 1);
    floorMat.color.set(this.pal.floor);
    this.views = saved.views; this.cam = saved.cam;
    if (selL) selL.visible = true;
    this.ghostGroup.visible = true;
    this.resize();
    return url;
  }
}

export function boxEdges(b: Box, arr: number[]) {
  const P = [[b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z0], [b.x1, b.y1, b.z0], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1]];
  const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [a, c] of E) arr.push(...P[a], ...P[c]);
}
function unionBoxes(list: Box[]) { let b: Box | null = null; for (const a of list) { if (!b) b = { ...a }; else { b.x0 = Math.min(b.x0, a.x0); b.x1 = Math.max(b.x1, a.x1); b.y0 = Math.min(b.y0, a.y0); b.y1 = Math.max(b.y1, a.y1); b.z0 = Math.min(b.z0, a.z0); b.z1 = Math.max(b.z1, a.z1); } } return b; }
export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
