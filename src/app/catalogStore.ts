// Catalog state: SKU master (embedded SPVB master merged with user edits), assets (images), image pool, PIDs.
import { create } from 'zustand';
import master from '../data/spvb-master.json';
import { backfillPids, masterRows, mergeImported, mergeMaster, repairCatalog, type MasterFile } from '../domain/catalog/catalog';
import { brandIndex, fillBrand, type BrandEntry } from '../domain/catalog/sku';
import type { Face, Sku } from '../domain/types';
import { deep, hashStr, norm, poolKey } from '../domain/util';
import { idbAll, idbGet, idbSet } from '../infra/idb';
import { parseImageName, readAsDataURL, shrinkImage, sniffMime, mimeName } from '../infra/images';
import { unzipEntries, type ZipEntry } from '../infra/zip';

const M = master as unknown as MasterFile;
export const MASTER_VER = M.ver;

interface CatalogState {
  ready: boolean;
  catalog: Sku[];
  byId: Map<string, Sku>;
  byKey: Map<string, Sku>;
  version: number;
  assets: Map<string, string>;
  imgPool: Record<string, Partial<Record<Face, string>>>;
  pidCounter: number;
  masterInfo: { ver: string; added: number; filled: number };
}

export const useCatalog = create<CatalogState>(() => ({
  ready: false, catalog: [], byId: new Map(), byKey: new Map(), version: 0, assets: new Map(), imgPool: {}, pidCounter: 0, masterInfo: { ver: MASTER_VER, added: 0, filled: 0 },
}));

let brandIdx: BrandEntry[] | null = null;
let saveT: ReturnType<typeof setTimeout> | null = null;

function reindex(catalog: Sku[]) {
  brandIdx = null;
  useCatalog.setState((s) => ({ catalog, byId: new Map(catalog.map((k) => [k.id, k])), byKey: new Map(catalog.map((k) => [poolKey(k.code), k])), version: s.version + 1 }));
}

export const catalog = {
  get: () => useCatalog.getState(),
  byId: (id: string) => useCatalog.getState().byId.get(id),
  byCode: (code: string) => useCatalog.getState().byKey.get(poolKey(code)),
  brandIndex: () => (brandIdx ||= brandIndex(useCatalog.getState().catalog)),
  asset: (id?: string | null) => (id ? useCatalog.getState().assets.get(id) : undefined),

  async init() {
    const saved = await idbGet<Sku[]>('catalog', 'catalog');
    const cat: Sku[] = Array.isArray(saved) && saved.length ? saved : [];
    const mv = await idbGet<string>('kv', 'masterVer');
    let info = { ver: MASTER_VER, added: 0, filled: 0 };
    if (mv !== MASTER_VER || !cat.length) { const r = mergeMaster(cat, masterRows(M)); info = { ver: MASTER_VER, ...r }; await idbSet('kv', 'masterVer', MASTER_VER).catch(() => {}); }
    repairCatalog(cat);
    const idx = brandIndex(cat);
    for (const k of cat) if (k.src === 'POG') fillBrand(idx, k);
    const counter = (await idbGet<number>('kv', 'pidCounter')) || 0;
    const n = backfillPids(cat, counter);
    const assets = new Map<string, string>();
    for (const [id, src] of await idbAll<string>('assets')) assets.set(id, src);
    const imgPool = (await idbGet<CatalogState['imgPool']>('kv', 'imgpool')) || {};
    useCatalog.setState({ ready: true, assets, imgPool, pidCounter: n, masterInfo: info });
    reindex(cat);
    if (n !== counter) await idbSet('kv', 'pidCounter', n).catch(() => {});
    this.persist(0);
  },

  persist(delay = 600) {
    if (saveT) clearTimeout(saveT);
    saveT = setTimeout(() => { idbSet('catalog', 'catalog', useCatalog.getState().catalog).catch(() => {}); }, delay);
  },

  /** Insert or replace one SKU (by id); assigns a PID to new SKUs. */
  upsert(k: Sku) {
    const st = useCatalog.getState(), cat = [...st.catalog];
    const i = cat.findIndex((c) => c.id === k.id);
    const nk = { ...k, updated: Date.now() };
    if (i >= 0) { nk.pid = cat[i].pid || nk.pid; cat[i] = nk; } else cat.unshift(nk);
    const n = backfillPids(cat, st.pidCounter);
    if (n !== st.pidCounter) { useCatalog.setState({ pidCounter: n }); idbSet('kv', 'pidCounter', n).catch(() => {}); }
    reindex(cat); this.persist();
    return nk;
  },

  addMany(list: Sku[]) {
    if (!list.length) return;
    const st = useCatalog.getState(), cat = [...st.catalog];
    const have = new Set(cat.map((k) => k.id));
    for (const k of list) if (!have.has(k.id)) { cat.push(deep(k)); have.add(k.id); }
    const n = backfillPids(cat, st.pidCounter);
    useCatalog.setState({ pidCounter: n }); idbSet('kv', 'pidCounter', n).catch(() => {});
    reindex(cat); this.persist();
  },

  importItems(items: Sku[]) {
    const st = useCatalog.getState(), cat = [...st.catalog];
    const r = mergeImported(cat, items.map((k) => { this.applyPool(k, false); return k; }));
    const n = backfillPids(cat, st.pidCounter);
    useCatalog.setState({ pidCounter: n }); idbSet('kv', 'pidCounter', n).catch(() => {});
    reindex(cat); this.persist();
    return r;
  },

  /** Mutate catalog entries in place (e.g. drawing sizes, plnx merge) then reindex + persist. */
  mutate<T>(fn: (cat: Sku[]) => T): T {
    const cat = [...useCatalog.getState().catalog];
    const r = fn(cat);
    const st = useCatalog.getState(), n = backfillPids(cat, st.pidCounter);
    if (n !== st.pidCounter) { useCatalog.setState({ pidCounter: n }); idbSet('kv', 'pidCounter', n).catch(() => {}); }
    reindex(cat); this.persist();
    return r;
  },

  async putAsset(dataURL: string) {
    const id = 'a' + hashStr(dataURL), st = useCatalog.getState();
    if (!st.assets.has(id)) { const m = new Map(st.assets); m.set(id, dataURL); useCatalog.setState({ assets: m }); await idbSet('assets', id, dataURL).catch(() => {}); }
    return id;
  },

  /** Fill (or overwrite) a SKU's faces from the image pool. Returns true when something changed. */
  applyPool(k: Sku, overwrite = false) {
    const p = useCatalog.getState().imgPool[poolKey(k.code)];
    if (!p) return false;
    let ch = false;
    const f = { ...(k.faces || {}) };
    for (const [face, id] of Object.entries(p)) if ((overwrite || !f[face as Face]) && f[face as Face] !== id) { f[face as Face] = id; ch = true; }
    if (ch) k.faces = f;
    return ch;
  },

  async setPoolImage(code: string, face: Face, assetId: string) {
    const pool = { ...useCatalog.getState().imgPool }, key = poolKey(code);
    pool[key] = { ...(pool[key] || {}), [face]: assetId };
    useCatalog.setState({ imgPool: pool });
    await idbSet('kv', 'imgpool', pool).catch(() => {});
  },

  /** Load images from files / folders / ZIPs into the pool (legacy loadImagePool). */
  async loadImagePool(files: File[], onProg?: (i: number, n: number) => void) {
    const ents: ZipEntry[] = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) { try { ents.push(...(await unzipEntries(f))); } catch { /* reported below */ } }
      else ents.push({ name: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, get: async () => new Uint8Array(await f.arrayBuffer()) });
    }
    const st = { files: ents.length, img: 0, codes: new Set<string>(), badName: [] as string[], badType: new Map<string, string>() };
    const pool = { ...useCatalog.getState().imgPool };
    for (let i = 0; i < ents.length; i++) {
      const en = ents[i], pn = parseImageName(en.name), base = en.name.split(/[\\/]/).pop()!;
      onProg?.(i, ents.length);
      if (!pn || pn.face === 'bottom') { if (!/^(thumbs\.db|desktop\.ini|\..*)$/i.test(base) && st.badName.length < 200) st.badName.push(base); continue; }
      let bytes: Uint8Array | null;
      try { bytes = await en.get(); } catch { st.badType.set(base, 'cannot read (OneDrive file not downloaded?)'); continue; }
      const mime = bytes && sniffMime(bytes);
      if (!mime) { st.badType.set(base, mimeName(bytes)); continue; }
      const id = await this.putAsset(await shrinkImage(await readAsDataURL(new Blob([bytes!], { type: mime })), 640));
      const key = poolKey(pn.key);
      pool[key] = { ...(pool[key] || {}), [pn.face]: id };
      st.img++; st.codes.add(key);
    }
    useCatalog.setState({ imgPool: pool });
    await idbSet('kv', 'imgpool', pool).catch(() => {});
    const changed = this.mutate((cat) => cat.filter((k) => this.applyPool(k, true)).length);
    return { ...st, catalogUpdated: changed };
  },

  search(q: string, list = useCatalog.getState().catalog) {
    const words = norm(q).split(/\s+/).filter(Boolean);
    if (!words.length) return list;
    return list.filter((k) => { const s = norm(k.name + ' ' + k.code + ' ' + k.brand + ' ' + (k.pid || '')); return words.every((w) => s.includes(w)); });
  },
};
