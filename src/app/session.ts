// The open project: one Scene, its undo/redo history, selection, warnings and autosave (legacy D / undoStack /
// redoStack / ui.sel / WARNINGS / scheduleAutosave), as a store React can subscribe to.
import { create } from 'zustand';
import { runChecks } from '../domain/checks';
import { applyDiff, beginTx, transact, type Diff } from '../domain/history';
import { L } from '../domain/i18n';
import { Scene } from '../domain/scene';
import { fixForm, unPlaceholder } from '../domain/catalog/sku';
import type { Design, Sku, Warning } from '../domain/types';
import { deep } from '../domain/util';
import { catalog } from './catalogStore';
import { prefs } from './prefs';
import { toast, workspace } from './workspace';

interface SessionState {
  id: string | null;
  scene: Scene | null;
  version: number;          // bumps on every committed change (React + renderer subscribe)
  geomVersion: number;      // bumps on fast drag updates (renderer only)
  sel: Set<string>;
  undo: Diff[];
  redo: Diff[];
  warnings: Warning[];
  save: { state: 'idle' | 'saving' | 'saved' | 'error'; at: number };
}

export const useSession = create<SessionState>(() => ({ id: null, scene: null, version: 0, geomVersion: 0, sel: new Set(), undo: [], redo: [], warnings: [], save: { state: 'idle', at: 0 } }));

let asT: ReturnType<typeof setTimeout> | null = null, chkT: ReturnType<typeof setTimeout> | null = null;
let owner: symbol | null = null; // the screen that opened the session; only it may close it
let lastMerge: { key: string; t: number; diff: Diff } | null = null;

const S = () => useSession.getState();

function scheduleChecks() {
  if (chkT) clearTimeout(chkT);
  chkT = setTimeout(() => { const s = S().scene; if (s) { s.invalidate(); useSession.setState({ warnings: runChecks(s) }); } }, 120);
}
function scheduleAutosave() {
  if (asT) clearTimeout(asT);
  asT = setTimeout(session.saveNow, 700);
}

function changed() {
  const s = S().scene!;
  s.invalidate();
  s.d.meta.updated = Date.now();
  // drop selection of removed objects
  const sel = new Set([...S().sel].filter((id) => s.get(id)));
  useSession.setState((st) => ({ version: st.version + 1, sel }));
  scheduleChecks(); scheduleAutosave();
}

export const session = {
  get scene() { return S().scene; },
  get d() { return S().scene?.d; },

  /** Open a project for a screen. `by` identifies the screen so a stale cleanup cannot close another screen's session. */
  async open(id: string, by?: symbol) {
    owner = by || null;
    const d = await workspace.loadDesign(id);
    if (by && owner !== by) return; // another screen took over while loading
    if (!d) throw Error(L('Không tìm thấy dự án', 'Project not found'));
    this.load(id, d);
  },

  /** Load a design into the session (legacy loadDesign). Unknown SKUs are added to the catalog. */
  load(id: string, d: Design) {
    d.skus = d.skus || {};
    for (const k of Object.values(d.skus)) { fixForm(k); unPlaceholder(k); catalog.applyPool(k, false); }
    const unknown = Object.values(d.skus).filter((k) => !catalog.byId(k.id));
    if (unknown.length) catalog.addMany(unknown);
    useSession.setState({ id, scene: new Scene(d), sel: new Set(), undo: [], redo: [], warnings: [], save: { state: 'saved', at: Date.now() } });
    lastMerge = null;
    changed();
  },

  close(by?: symbol) {
    if (by && owner && owner !== by) return; // a newer screen owns the session now
    owner = null;
    if (asT) { clearTimeout(asT); this.saveNow(); }
    useSession.setState({ id: null, scene: null, sel: new Set(), undo: [], redo: [] });
  },

  async saveNow() {
    const st = S();
    if (!st.id || !st.scene) return;
    useSession.setState({ save: { state: 'saving', at: st.save.at } });
    try { const p = prefs(); await workspace.saveDesign(st.id, st.scene.d, p.ownMaker, p.competitor); useSession.setState({ save: { state: 'saved', at: Date.now() } }); }
    catch { useSession.setState({ save: { state: 'error', at: Date.now() } }); }
  },

  /** Run an edit as one undo step. merge: same key within `windowMs` merges into the previous step (nudges, facings). */
  edit<T>(label: string, fn: (s: Scene) => T, opts: { merge?: string; windowMs?: number; strict?: boolean } = {}): T | undefined {
    const st = S(), s = st.scene;
    if (!s) return undefined;
    const now = performance.now();
    let undo = st.undo;
    let mergeFrom: Diff | null = null;
    if (opts.merge && lastMerge && lastMerge.key === opts.merge && now - lastMerge.t < (opts.windowMs ?? 900) && undo[undo.length - 1] === lastMerge.diff) {
      mergeFrom = lastMerge.diff;
      applyDiff(s.d, mergeFrom, -1); // rewind the previous step, then redo it as part of this one
      s.invalidate();
      undo = undo.slice(0, -1);
    }
    const r = transact(s, label, () => { if (mergeFrom) applyDiff(s.d, mergeFrom, 1); s.invalidate(); return fn(s); }, { strict: opts.strict ?? prefs().strict });
    if (r.blocked) { toast(L('Không thực hiện được – ', 'Blocked – ') + r.blocked, 'danger'); if (mergeFrom) useSession.setState({ undo: [...undo, mergeFrom] }); changed(); return r.value; }
    if (!r.ok || !r.diff) { if (mergeFrom) { useSession.setState({ undo: [...undo, mergeFrom] }); } return r.value; }
    const nu = [...undo, r.diff].slice(-200);
    useSession.setState({ undo: nu, redo: [] });
    lastMerge = opts.merge ? { key: opts.merge, t: now, diff: r.diff } : null;
    changed();
    return r.value;
  },

  /** Long transaction (drag): call update() freely, then commit(label) or cancel(). */
  begin() {
    const s = S().scene!;
    const commit = beginTx(s), snapshot = JSON.stringify(s.d.objects);
    return {
      commit: (label: string) => {
        const r = commit(label, { strict: prefs().strict });
        if (r.blocked) toast(L('Không thực hiện được – ', 'Blocked – ') + r.blocked, 'danger');
        if (r.ok && r.diff) useSession.setState((st) => ({ undo: [...st.undo, r.diff!].slice(-200), redo: [] }));
        lastMerge = null;
        changed();
        return r.ok;
      },
      cancel: () => { s.d.objects = JSON.parse(snapshot); changed(); },
    };
  },

  /** Fast geometry update while dragging (no history, renderer only). */
  touch() { S().scene?.invalidateGeom(); useSession.setState((st) => ({ geomVersion: st.geomVersion + 1 })); },

  undo() {
    const st = S(), d = st.undo[st.undo.length - 1];
    if (!d || !st.scene) return;
    applyDiff(st.scene.d, d, -1);
    useSession.setState({ undo: st.undo.slice(0, -1), redo: [...st.redo, d] });
    lastMerge = null; changed();
    toast(L('Đã hoàn tác: ', 'Undone: ') + d.label);
  },
  redo() {
    const st = S(), d = st.redo[st.redo.length - 1];
    if (!d || !st.scene) return;
    applyDiff(st.scene.d, d, 1);
    useSession.setState({ redo: st.redo.slice(0, -1), undo: [...st.undo, d] });
    lastMerge = null; changed();
    toast(L('Đã làm lại: ', 'Redone: ') + d.label);
  },

  // ---- selection ----
  select(ids: Iterable<string>, add = false) { const sel = add ? new Set(S().sel) : new Set<string>(); for (const id of ids) sel.add(id); useSession.setState({ sel }); },
  toggle(id: string) { const sel = new Set(S().sel); if (sel.has(id)) sel.delete(id); else sel.add(id); useSession.setState({ sel }); },
  clearSel() { useSession.setState({ sel: new Set() }); },
  selected(unlocked = false) { const s = S().scene; if (!s) return []; return [...S().sel].map((id) => s.get(id)).filter((o): o is NonNullable<typeof o> => !!o && (!unlocked || !o.lock)); },

  /** Copy a catalog SKU into the design (legacy ensureProjectSku). */
  ensureSku(id: string): Sku | null {
    const s = S().scene;
    if (!s) return null;
    if (s.d.skus[id]) return s.d.skus[id];
    const k = catalog.byId(id);
    if (!k) return null;
    const c = deep(k);
    catalog.applyPool(c, false);
    s.d.skus[id] = c;
    return c;
  },
};
