// Editor commands: a label + one or more domain operations inside one undoable transaction (legacy "commands on the
// selection", OPS, SHELF actions). Used by the keyboard, the inspector and menus alike.
import { L } from '../domain/i18n';
import { isStock, type Scene } from '../domain/scene';
import { addGondola, addShelf, deleteBay, fillDepth, fillOne, packShelf, resizeBay, setCount, setShelfTop, shelfDirect, shelfUnder, type BayParams } from '../domain/shelf/gondola';
import { align, applyBuild, cloneObjs, duplicate, explodeArray, nudge, remove, replaceCore, rotate, sameColumn, sameLevel, sameSku, setAngle, setArrayParam, splitLevels, type AlignMode, type BuildParams, type DupDir, type ReplaceFit } from '../domain/ops/edit';
import { applyShell, autoFillCore, resizePallet, shellPallets, type ShellPlanItem } from '../domain/pallet/shell';
import { keepCorner } from '../domain/ops/corner';
import { unionBox } from '../domain/geometry';
import type { ArrayObj, FixtureObj, PalletObj, SceneObject, ShelfObj, SkuObj, Sku } from '../domain/types';
import { deep, R1, R2, uid } from '../domain/util';
import { prefs } from './prefs';
import { session, useSession } from './session';
import { toast } from './workspace';
import { catalog } from './catalogStore';

const sel = (unlocked = true) => session.selected(unlocked);
let CLIP: SceneObject[] | null = null;

export const cmd = {
  duplicate(dir: DupDir = 'R') { const os = sel(); if (!os.length) return; const ids = session.edit(L('Nhân bản', 'Duplicate'), (s) => duplicate(s, os, dir)); if (ids) session.select(ids); },
  remove() { const os = sel(); if (!os.length) { if (useSession.getState().sel.size) toast(L('Vật đang khoá', 'Object is locked'), 'warn'); return; } session.edit(L('Xoá', 'Delete'), (s) => remove(s, new Set(os.map((o) => o.id)))); session.clearSel(); },
  copy() { const os = sel(false); if (os.length) CLIP = deep(os); },
  paste() {
    if (!CLIP || !CLIP.length) return;
    const clip = CLIP;
    const ids = session.edit(L('Dán', 'Paste'), (s) => {
      for (const c of clip) if (isStock(c) && !s.d.skus[c.sku]) session.ensureSku(c.sku);
      const ok = clip.filter((c) => !isStock(c) || s.d.skus[c.sku]);
      const b = unionBox(ok.map((o) => s.aabb(o)))!;
      const cs = cloneObjs(ok, b.x1 - b.x0, 0, 0);
      s.d.objects.push(...cs); s.invalidate();
      CLIP = deep(cs);
      return cs.map((c) => c.id);
    });
    if (ids) session.select(ids);
  },
  nudge(dx: number, dy: number, dz: number) { const os = sel(); if (!os.length) return; session.edit(L('Dịch', 'Nudge'), (s) => nudge(s, os, dx, dy, dz), { merge: 'nudge:' + os.map((o) => o.id).join(','), windowMs: 900 }); },
  align(mode: AlignMode) { const os = sel(); if (os.length < 2) return; session.edit(L('Căn', 'Align'), (s) => align(s, os, mode)); },
  rotate(dir: 1 | -1, step?: number) { const os = sel(); if (!os.length) return; const th = dir * (step || prefs().rotStep || 90); session.edit(L('Xoay ', 'Rotate ') + th + '°', (s) => rotate(s, os, th)); },
  setAngle(deg: number) { const os = sel(); if (!os.length) return; session.edit(L('Đặt góc', 'Set angle'), (s) => setAngle(s, os, deg)); },
  setPosition(axis: 'x' | 'y' | 'z', val: number) {
    const os = sel(); if (!os.length) return;
    session.edit(L('Đặt vị trí', 'Set position'), (s) => { const b = unionBox(os.map((o) => s.aabb(o)))!, d = axis === 'x' ? val - b.x0 : axis === 'y' ? Math.max(0, val) - b.y0 : val - b.z0; for (const q of os) q.pos[axis] = R2(q.pos[axis] + d); });
  },
  toggleFlag(flag: 'lock' | 'hidden') {
    const os = sel(false); if (!os.length) return;
    const v = !os.every((o) => o[flag]);
    session.edit(flag === 'lock' ? (v ? L('Khoá', 'Lock') : L('Mở khoá', 'Unlock')) : v ? L('Ẩn', 'Hide') : L('Hiện', 'Show'), () => { for (const o of os) o[flag] = v; });
    if (flag === 'hidden' && v) session.clearSel();
  },
  flagOne(id: string, flag: 'lock' | 'hidden') { const s = session.scene; const o = s?.get(id); if (!o) return; session.edit(flag === 'lock' ? L('Khoá', 'Lock') : L('Ẩn', 'Hide'), () => { o[flag] = !o[flag]; }); },
  selectSame(kind: 'level' | 'sku' | 'col') { const s = session.scene; const os = sel(false); if (!s || !os.length) return; session.select(kind === 'level' ? sameLevel(s, os) : kind === 'sku' ? sameSku(s, os) : sameColumn(s, os)); },
  selectAll() { const s = session.scene; if (s) session.select(s.d.objects.filter((o) => !o.lock && !o.hidden).map((o) => o.id)); },

  /** Facings / stack / depth with physical limits (legacy countEdit; merged within 1.2 s). */
  count(axis: 'x' | 'y' | 'z', fn: (cur: number) => number, label?: string, mergeKey?: string) {
    const ids = sel().filter(isStock).map((o) => o.id);
    if (!ids.length) return;
    let msg: string | null = null;
    session.edit(label || (axis === 'x' ? 'Facing' : axis === 'y' ? L('Tầng', 'Stack') : L('Hàng sâu', 'Depth')), (s) => { msg = setCount(s, ids, axis, fn); }, { merge: mergeKey, windowMs: 1200 });
    if (msg) toast(msg, 'warn');
  },
  arrayParam(o: ArrayObj, key: string, val: number | string) {
    if ((key === 'nx' || key === 'ny' || key === 'nz') && session.scene && shelfUnder(session.scene, o)) { const ax = key[1] as 'x' | 'y' | 'z'; let msg: string | null = null; session.edit(L('Sửa khối', 'Edit block'), (s) => { msg = setCount(s, [o.id], ax, () => +val); }); if (msg) toast(msg, 'warn'); return; }
    session.edit(L('Sửa khối', 'Edit block'), (s) => setArrayParam(s, s.get(o.id) as ArrayObj, key, val));
  },
  applyBuild(srcId: string, p: BuildParams, mode: string) {
    const lab = { row: L('Tạo hàng', 'Make row'), grid: L('Tạo mảng', 'Make grid'), block: L('Tạo khối', 'Make block') }[mode] || 'Build';
    const a = session.edit(`${lab} ${p.nx}×${p.nz}×${p.ny}`, (s) => applyBuild(s, s.get(srcId) as SkuObj, p));
    if (a) session.select([a.id]);
  },
  explode(o: ArrayObj) { const ids = session.edit(L('Tách để chỉnh riêng', 'Split into items'), (s) => explodeArray(s, s.get(o.id) as ArrayObj)); if (ids) session.select(ids); },
  splitLevels(o: ArrayObj) { const ids = session.edit(L('Tách theo tầng', 'Split by level'), (s) => splitLevels(s, s.get(o.id) as ArrayObj)); if (ids) session.select(ids); },
  replace(ids: string[], toId: string, fit: ReplaceFit, swapFrom: string | null, scope: string[] | null) {
    session.edit(L('Thay SKU', 'Replace SKU'), (s) => { session.ensureSku(toId); replaceCore(s, ids, toId, fit, swapFrom, scope); });
  },
  syncFromMaster(skuId: string) { const c = catalog.byId(skuId); if (!c) return; session.edit(L('Cập nhật theo master', 'Update from master'), (s) => { s.d.skus[skuId] = deep(c); }); },

  // ---- shelf / gondola ----
  addGondola(p: BayParams, bays: number) { session.edit(L('Tạo gondola', 'Add gondola'), (s) => { if (!s.isShelfMode) { s.d.settings.kind = 'shelf'; s.d.settings.sales = s.d.settings.sales || {}; } addGondola(s, p, bays); }); },
  packShelf(sh: ShelfObj, mode: 'L' | 'R' | 'D') { session.edit({ L: L('Dồn trái', 'Pack left'), R: L('Dồn phải', 'Pack right'), D: L('Giãn đều', 'Spread evenly') }[mode], (s) => packShelf(s, s.get(sh.id)!, mode)); },
  fillDepth(sh: ShelfObj) { session.edit(L('Lấp đầy chiều sâu', 'Fill depth'), (s) => fillDepth(s, s.get(sh.id)!)); },
  fillOne(o: ArrayObj) { session.edit(L('Lấp đầy chiều sâu', 'Fill depth'), (s) => fillOne(s, s.get(o.id) as ArrayObj)); },
  selectShelfItems(sh: ShelfObj) { const s = session.scene; if (s) session.select(shelfDirect(s, sh).map((q) => q.id)); },
  shelfTop(sh: ShelfObj, top: number) { session.edit(L('Đổi cao tấm kệ', 'Move shelf'), (s) => setShelfTop(s, s.get(sh.id) as ShelfObj, top, prefs().carry)); },
  addShelf(f: FixtureObj) { const ns = session.edit(L('Thêm tấm kệ', 'Add shelf'), (s) => addShelf(s, s.get(f.id) as FixtureObj)); if (ns) session.select([ns.id]); },
  deleteBay(f: FixtureObj) { session.edit(L('Xoá bay', 'Delete bay'), (s) => deleteBay(s, s.get(f.id) as FixtureObj)); session.clearSel(); },
  resizeBay(f: FixtureObj, w: number) { session.edit(L('Đổi rộng bay', 'Bay width'), (s) => resizeBay(s, s.get(f.id) as FixtureObj, Math.max(10, w))); },
  setPitch(f: FixtureObj, pitch: number) { session.edit(L('Bước lỗ', 'Notch pitch'), (s) => { const o = s.get(f.id) as FixtureObj; o.fx = { ...(o.fx || { panel: 2, kick: 12, pitch: 2.5 }), pitch: Math.max(0.5, pitch || 2.5) }; }); },
  resize(o: SceneObject, key: 'w' | 'd' | 'h', v: number, keepAspect = false) {
    session.edit(L('Đổi kích thước', 'Resize'), (s) => {
      const x = s.get(o.id) as Exclude<SceneObject, SkuObj | ArrayObj>;
      if (x.type === 'fixture' && key === 'h') { x.size.h = Math.max(10, v || 10); return; }
      if (x.type === 'pallet' || x.type === 'shelf' || x.type === 'fixture') { keepCorner(s, x, -1, -1, () => { x.size[key] = Math.max(0.1, v || 0.1); }); return; }
      const ar = x.size.w / Math.max(0.01, x.size.h);
      x.size[key] = Math.max(0.1, v || 0.1);
      if (keepAspect && (x.type === 'posm' || x.type === 'prop') && x.asset) { if (key === 'w') x.size.h = R1(x.size.w / ar); if (key === 'h') x.size.w = R1(x.size.h * ar); }
    });
  },
  rename(o: SceneObject | null, name: string) { session.edit(L('Đổi tên', 'Rename'), (s) => { if (o) s.get(o.id)!.name = name; else s.d.meta.name = name; }); },
  setColor(o: SceneObject, color: string) { session.edit(L('Đổi màu', 'Color'), (s) => { (s.get(o.id) as { color?: string }).color = color; }); },
  setting<K extends 'maxH' | 'overhang' | 'minDos'>(k: K, v: number) { session.edit(L('Cài đặt display', 'Display settings'), (s) => { s.d.settings[k] = Math.max(0, +v || 0); }); },
  resizePallet(p: PalletObj, w: number, d: number, h: number, preset?: string) {
    session.edit(L('Đổi pallet', 'Change pallet'), (s) => { resizePallet(s, s.get(p.id) as PalletObj, w, d, h, prefs().palletFollow); s.d.settings.preset = preset || 'custom'; if (preset) (s.get(p.id) as PalletObj).name = 'Pallet ' + preset; });
  },
  shell(plan: ShellPlanItem[], opt: { lid: boolean; sides: 'outer' | 'all'; replace: boolean }, coreSku?: string | null) {
    const made = session.edit(L('Xếp viền rỗng ruột', 'Hollow shell'), (s) => {
      const ids = applyShell(s, plan, opt, (id) => session.ensureSku(id));
      if (coreSku) { const inner = session.ensureSku(coreSku); const outer = plan[0]?.sku ? session.ensureSku(plan[0].sku) : null; if (inner) { const arr = autoFillCore(s, shellPallets(s, []).filter((p) => plan.some((x) => x.pid === p.id)), inner, outer); s.d.objects.push(...arr); s.invalidate(); } }
      return ids;
    });
    if (made) session.select(made);
  },
  addObject(o: SceneObject) { session.edit((L('Thêm ', 'Add ')) + (o.name || o.type), (s) => { s.d.objects.push(o); s.invalidate(); }); session.select([o.id]); },
  newSkuObject(skuId: string): SkuObj { return { id: uid(), type: 'sku', sku: skuId, pos: { x: 0, y: 0, z: 0 }, ry: 0 }; },
};

export function skuOfSel(s: Scene): Sku | null { const o = session.selected(false).find(isStock); return o ? s.skuOf(o) : null; }
