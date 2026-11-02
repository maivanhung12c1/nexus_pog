// Workspace: the list of projects (many projects, not one autosave slot), Space Share POG sets, toasts.
import { create } from 'zustand';
import { computeBOM } from '../domain/bom';
import { aggregate, positions, share } from '../domain/analysis/spaceShare';
import { Scene } from '../domain/scene';
import type { Design } from '../domain/types';
import { deep, uid } from '../domain/util';
import { idbDel, idbGet, idbSet } from '../infra/idb';

export interface ProjectSummary {
  id: string; name: string; kind: 'pallet' | 'shelf'; updated: number; created: number;
  skus: number; facings: number; positions: number; units: number; focusShare: number | null; widthCm: number; strip: StripRect[];
}
export interface StripRect { x: number; y: number; w: number; h: number; c: 'f' | 'k' | 'o' | 's' } // focus / competitor / other / structure

/** The signature "shelf strip": positions normalised to 0..1, coloured by maker class. */
export function stripOf(d: Design, own: string, comp: string): { rects: StripRect[]; width: number } {
  const s = new Scene(d), P = positions(d), box = s.sceneBox(true);
  if (!box) return { rects: [], width: 0 };
  const W = Math.max(1, box.x1 - box.x0), H = Math.max(1, box.y1 - box.y0), rects: StripRect[] = [];
  for (const o of d.objects) if (o.type === 'shelf' || o.type === 'pallet') { const b = s.aabb(o); rects.push({ x: (b.x0 - box.x0) / W, y: 1 - (b.y1 - box.y0) / H, w: (b.x1 - b.x0) / W, h: Math.max(0.012, (b.y1 - b.y0) / H), c: 's' }); }
  for (const p of P.pos) { const m = String(p.k.maker || '').toUpperCase(); rects.push({ x: (p.x0 - box.x0) / W, y: 1 - (p.y1 - box.y0) / H, w: (p.x1 - p.x0) / W, h: (p.y1 - p.y0) / H, c: m.includes(own.toUpperCase()) ? 'f' : m === comp.toUpperCase() ? 'k' : 'o' }); }
  return { rects: rects.slice(0, 1500), width: W };
}

export function summarize(id: string, d: Design, own: string, comp: string): ProjectSummary {
  const P = positions(d), A = aggregate(P, 'maker', null), st = stripOf(d, own, comp);
  return {
    id, name: d.meta.name || 'Display', kind: d.settings.kind === 'shelf' ? 'shelf' : 'pallet', updated: d.meta.updated || Date.now(), created: d.meta.created || Date.now(),
    skus: A.T.sku, facings: A.T.fac, positions: P.pos.length, units: computeBOM(new Scene(d)).tot.conv,
    focusShare: A.T.lin ? share(A, own.toUpperCase(), 'lin') : null, widthCm: st.width, strip: st.rects,
  };
}

export interface PogEntry { id: string; name: string; src: string; design: Design; include: boolean }
interface WorkspaceState { projects: ProjectSummary[]; loaded: boolean; pogSet: PogEntry[]; toasts: { id: string; msg: string; kind: 'info' | 'warn' | 'danger' }[] }
export const useWorkspace = create<WorkspaceState>(() => ({ projects: [], loaded: false, pogSet: [], toasts: [] }));

export function toast(msg: string, kind: 'info' | 'warn' | 'danger' = 'info') {
  const id = uid('t');
  if (useWorkspace.getState().toasts.some((t) => t.msg === msg)) return; // the same message is already on screen
  useWorkspace.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, msg, kind }] }));
  setTimeout(() => useWorkspace.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === 'danger' ? 6000 : 3200);
}

export const workspace = {
  async load() {
    const idx = (await idbGet<ProjectSummary[]>('kv', 'projectIndex')) || [];
    const set = (await idbGet<PogEntry[]>('kv', 'spaceShareSet')) || [];
    useWorkspace.setState({ projects: idx.sort((a, b) => b.updated - a.updated), loaded: true, pogSet: set });
  },
  async saveIndex() { await idbSet('kv', 'projectIndex', useWorkspace.getState().projects).catch(() => {}); },
  async saveDesign(id: string, d: Design, own: string, comp: string) {
    await idbSet('projects', id, d);
    const sum = summarize(id, d, own, comp);
    useWorkspace.setState((s) => ({ projects: [sum, ...s.projects.filter((p) => p.id !== id)].sort((a, b) => b.updated - a.updated) }));
    await this.saveIndex();
    return sum;
  },
  async loadDesign(id: string) { return idbGet<Design>('projects', id); },
  async createProject(d: Design, own: string, comp: string) { const id = uid('prj'); d.meta.created = d.meta.created || Date.now(); d.meta.updated = Date.now(); await this.saveDesign(id, d, own, comp); return id; },
  async duplicate(id: string, own: string, comp: string) {
    const d = await this.loadDesign(id); if (!d) return null;
    const c = deep(d); c.meta.name = c.meta.name + ' (copy)'; c.meta.created = Date.now(); c.meta.updated = Date.now();
    return this.createProject(c, own, comp);
  },
  async remove(id: string) { await idbDel('projects', id); useWorkspace.setState((s) => ({ projects: s.projects.filter((p) => p.id !== id) })); await this.saveIndex(); },
  // Space Share set
  async setPogs(list: PogEntry[]) { useWorkspace.setState({ pogSet: list }); await idbSet('kv', 'spaceShareSet', list).catch(() => {}); },
  async addPog(design: Design, src: string, name?: string) {
    const e: PogEntry = { id: uid('g'), name: name || design.meta.name, src, design: deep(design), include: true };
    await this.setPogs([...useWorkspace.getState().pogSet, e]);
    return e.id;
  },
};
