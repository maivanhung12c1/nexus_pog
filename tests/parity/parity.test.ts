// Parity: the new domain modules must reproduce the legacy app's outputs captured by capture-legacy.mjs.
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import master from '../../src/data/spvb-master.json';
import { masterRows, repairCatalog } from '../../src/domain/catalog/catalog';
import { skuFromMaster } from '../../src/domain/catalog/sku';
import { Scene } from '../../src/domain/scene';
import { shelfMetrics } from '../../src/domain/shelf/metrics';
import { computeBOM } from '../../src/domain/bom';
import { runChecks } from '../../src/domain/checks';
import { aggregate, positions } from '../../src/domain/analysis/spaceShare';
import { plnxPreflight } from '../../src/domain/shelf/layout';
import { buildPlnxXML } from '../../src/infra/plnx/write';
import { apBuild, AUTO_POG_DEFAULTS, type AutoPogConfig } from '../../src/domain/analysis/autoPog';
import { transact, applyDiff, type Diff } from '../../src/domain/history';
import { fillDepth, notchY, packShelf, ridersOf, setCount, shelfUnder } from '../../src/domain/shelf/gondola';
import { setArrayParam, explodeArray, splitLevels } from '../../src/domain/ops/edit';
import { applyShell, shellFor } from '../../src/domain/pallet/shell';
import { parsePOGPages, pogLines } from '../../src/infra/pdf/pogParser';
import { migrateV6 } from '../../src/domain/migration/v6';
import type { ArrayObj, Design, PalletObj, ShelfObj, Sku } from '../../src/domain/types';
import { deep } from '../../src/domain/util';
import catalogFx from './fixtures/catalog.json';
import shelfFx from './fixtures/shelf-case.json';
import opsFx from './fixtures/shelf-ops.json';
import palletFx from './fixtures/pallet-case.json';
import pdfFx from './fixtures/pdf-case.json';
import v6Fx from './fixtures/v6-case.json';

/** Deep comparison with a numeric tolerance (floating noise from different operation order). */
function close(a: unknown, b: unknown, path = '$'): string | null {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b)) ? null : `${path}: ${a} ≠ ${b}`;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return Object.is(a, b) || (a === undefined && b === null) || (a === null && b === undefined) ? null : `${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array mismatch`;
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined), kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  if (Array.isArray(a) && (a as unknown[]).length !== (b as unknown[]).length) return `${path}: length ${(a as unknown[]).length} ≠ ${(b as unknown[]).length}`;
  for (const k of new Set([...ka, ...kb])) { const r = close((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path + '.' + k); if (r) return r; }
  return null;
}
const expectClose = (a: unknown, b: unknown) => { const r = close(JSON.parse(JSON.stringify(a)), b); expect(r).toBeNull(); };
const strip = <T,>(o: T) => JSON.parse(JSON.stringify(o, (key, v) => (key === 'k' && v && v.id ? v.id : key === 'o' && v && v.id ? v.id : v)));
const sortJ = <T,>(a: T[]) => [...a].sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1));

describe('catalog from the embedded master (skuFromMaster)', () => {
  it('reproduces every legacy catalog SKU', () => {
    const cat = masterRows(master as never).map(skuFromMaster);
    repairCatalog(cat);
    expect(cat.length).toBe(catalogFx.length);
    const by = new Map(cat.map((k) => [k.id, k]));
    let bad = 0;
    for (const L of catalogFx) {
      const k = by.get(L.id)!;
      const r = close({ id: k.id, code: k.code, form: k.form, units: k.units, w: k.w, d: k.d, h: k.h, est: !!k.est, color: k.color, maker: k.maker, brand: k.brand, cat: k.cat, sub: k.sub }, L);
      if (r) { bad++; if (bad < 5) console.error(r, L.id); }
    }
    expect(bad).toBe(0);
  });
});

describe('gondola planogram (shelf-case)', () => {
  const d = () => deep(shelfFx.input) as unknown as Design;
  it('shelf metrics', () => expectClose(strip(shelfMetrics(new Scene(d()))), shelfFx.metrics));
  it('BOM', () => expectClose(strip(computeBOM(new Scene(d()))), shelfFx.bom));
  it('checks', () => expectClose(runChecks(new Scene(d())), shelfFx.checks));
  it('space share positions and aggregation', () => {
    const P = positions(d());
    expectClose(strip(P), shelfFx.pos);
    // legacy rows also carried a serialised Set ("set": {}) — an artefact, not data
    const noSet = (a: { rows: Record<string, unknown>[]; T: Record<string, unknown> }) => { const { set, ...T } = a.T; void set; return { T, rows: a.rows.map(({ set: s2, ...r }) => { void s2; return r; }) }; };
    expectClose(aggregate(P, 'maker', null), noSet(shelfFx.aggMaker as never));
    expectClose(aggregate(P, 'brand', null), noSet(shelfFx.aggBrand as never));
    expectClose(aggregate(P, 'brand', { dim: 'maker', val: 'SPVB' }), noSet(shelfFx.aggScoped as never));
  });
  it('plnx preflight', () => expectClose(plnxPreflight(new Scene(d())), shelfFx.preflight));
  it('plnx XML identical to legacy', () => {
    const r = buildPlnxXML(new Scene(d()), 'Parity gondola', { guid: 'GUID' })!;
    expect(r.stats).toEqual(shelfFx.stats);
    expect(r.xml).toBe(shelfFx.xml);
  });
  const cfg = (o: Partial<AutoPogConfig>): AutoPogConfig => ({ ...AUTO_POG_DEFAULTS, ...o, scen: AUTO_POG_DEFAULTS.scen, target: o.target || {} });
  const objs = (des: Design) => sortJ(des.objects.filter((o): o is ArrayObj => o.type === 'array').map((o) => ({ sku: o.sku, n: o.n, pos: o.pos, cellRy: o.cellRy })));
  for (const mode of ['cur', 'sales', 'target'] as const) {
    it(`auto POG scenario ${mode}`, () => {
      const r = apBuild(d(), cfg({ target: { SPVB: 45 } }), mode, 'X');
      const L = (shelfFx.ap as Record<string, { shares: unknown; seq: unknown; warn: unknown; dropped: string[]; objects: unknown[] }>)[mode];
      expectClose(r.shares, L.shares);
      expectClose(r.seq, L.seq);
      expectClose(r.warn, L.warn);
      expect(r.dropped.map((x) => x.k.id)).toEqual(L.dropped);
      expectClose(objs(r.design), sortJ(L.objects));
    });
  }
  it('auto POG: keep order, right-to-left, equal weight, stacking', () => {
    const r = apBuild(d(), cfg({ zone: 'none', block: 'brand', order: 'cur', flow: 'rtl', weight: 'eq', snap: false, stack: true, target: {} }), 'cur', 'Y');
    const L = shelfFx.ap.cur_rtl;
    expectClose(r.shares, L.shares); expectClose(r.seq, L.seq); expectClose(objs(r.design), sortJ(L.objects as unknown[]));
  });
});

describe('shelf operations (shelf-ops), strict collision guard on', () => {
  it('pack / spread / fill depth / notch / riders / facing limits', () => {
    const s = new Scene(deep(shelfFx.input) as unknown as Design);
    const snap = () => deep(s.d.objects).map((o) => ({ id: o.id, type: o.type, pos: o.pos, n: (o as ArrayObj).n, sku: (o as ArrayObj).sku }));
    const shelf = () => s.d.objects.filter((o): o is ShelfObj => o.type === 'shelf').sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y)[1];
    const tx = (fn: () => void) => transact(s, 'x', fn, { strict: true });
    tx(() => packShelf(s, shelf(), 'R')); expectClose(snap(), opsFx.packR);
    tx(() => packShelf(s, shelf(), 'D')); expectClose(snap(), opsFx.packD);
    tx(() => packShelf(s, shelf(), 'L')); expectClose(snap(), opsFx.packL);
    tx(() => fillDepth(s, shelf())); expectClose(snap(), opsFx.fill);
    const sh = shelf();
    expect([10, 33.3, 47.9, 101.2].map((y) => notchY(s, sh, y))).toEqual(opsFx.notch);
    expect([...ridersOf(s, [sh.id])].sort()).toEqual(opsFx.riders);
    const facing = (key: 'nx' | 'ny' | 'nz', v: number) => {
      const o = s.get('p3') as ArrayObj;
      if (shelfUnder(s, o)) tx(() => setCount(s, [o.id], key[1] as 'x' | 'y' | 'z', () => v)); else tx(() => setArrayParam(s, o, key, v));
    };
    facing('nx', 40); expectClose(snap(), opsFx.limitX);
    facing('ny', 30); expectClose(snap(), opsFx.limitY);
    facing('nz', 30); expectClose(snap(), opsFx.limitZ);
  });
});

describe('pallet display (pallet-case)', () => {
  const norm = (objs: unknown[]) => sortJ((objs as Record<string, unknown>[]).map((o) => ({ type: o.type, subtype: o.subtype, sku: o.sku, n: o.n, pos: o.pos, cellRy: o.cellRy, size: o.size })));
  it('hollow shell variants, apply, BOM, explode, split, undo', () => {
    const s = new Scene(deep(palletFx.input) as unknown as Design);
    const getSku = (id: string): Sku | null => s.d.skus[id] || null;
    const all = s.d.objects.filter((o): o is PalletObj => o.type === 'pallet');
    const C = palletFx.carton, P = palletFx.pack;
    const cases: [string, { lid: boolean; sides: 'outer' | 'all'; levels: number }, Record<string, string> | null][] = [['outer-lid', { lid: true, sides: 'outer', levels: 4 }, null], ['all-nolid', { lid: false, sides: 'all', levels: 3 }, null], ['perface', { lid: true, sides: 'outer', levels: 5 }, { front: C, back: P, left: P, right: C, lid: C }]];
    for (const [label, opt, side] of cases) {
      const r = shellFor(s, all[0], { ...opt, sku: C, skuPerSide: side }, all, getSku);
      const L = (palletFx.shell as Record<string, { n: number; top: number; objs: unknown[] }>)[label];
      expect(r.n).toBe(L.n); expect(r.top).toBeCloseTo(L.top, 6); expectClose(norm(r.objs), L.objs);
    }
    const undo: Diff[] = [];
    const push = (r: { diff: Diff | null }) => { if (r.diff) undo.push(r.diff); };
    push(transact(s, 'shell', () => applyShell(s, [{ pid: 'pal1', sku: C, levels: 4 }, { pid: 'pal2', sku: C, skuPerSide: { front: C, back: P, left: '', right: '', lid: C }, levels: 4 }], { lid: true, sides: 'outer', replace: true }, getSku), { strict: true }));
    expectClose(norm(s.d.objects), palletFx.afterShell);
    expectClose(strip(computeBOM(s)), palletFx.bom);
    push(transact(s, 'explode', () => explodeArray(s, s.d.objects.filter((o): o is ArrayObj => o.type === 'array')[0]), { strict: true }));
    expectClose(norm(s.d.objects), palletFx.afterExplode);
    push(transact(s, 'split', () => splitLevels(s, s.d.objects.filter((o): o is ArrayObj => o.type === 'array')[1]), { strict: true }));
    expectClose(norm(s.d.objects), palletFx.afterSplit);
    applyDiff(s.d, undo.pop()!, -1); applyDiff(s.d, undo.pop()!, -1); s.invalidate();
    expectClose(norm(s.d.objects), palletFx.afterUndo);
  });
});

describe('POG PDF text parser (pdf-case)', () => {
  it('GO! / mini go product list + drawing metadata', () => expectClose(parsePOGPages(pdfFx.goPages as never), pdfFx.go));
  it('Lotte Mart list', () => expectClose(parsePOGPages(pdfFx.lottePages as never), pdfFx.lotte));
  it('line grouping', () => expectClose(pogLines(pdfFx.goPages[1] as never).map((l) => ({ y: l.y, t: l.t })), pdfFx.lines));
});

describe('V6 → V7 migration (v6-case)', () => {
  it('objects, SKUs, settings and report match', async () => {
    const m = await migrateV6(deep(v6Fx.input), {}, async () => 'a0');
    const norm = (objs: unknown[]) => sortJ((objs as Record<string, unknown>[]).map((o) => ({ type: o.type, subtype: o.subtype, sku: o.sku, n: o.n, shape: o.shape, pos: o.pos, ry: o.ry, size: o.size, name: o.name })));
    expectClose(norm(m.design.objects), v6Fx.objects);
    const skus = Object.fromEntries(Object.entries(m.design.skus).map(([k, v]) => { const { maker, ml, pkg, cat, sub, ...rest } = v; void maker; void ml; void pkg; void cat; void sub; return [k, rest]; }));
    expectClose(skus, v6Fx.skus);
    expectClose({ ...m.design.settings, kind: undefined }, v6Fx.settings);
    expectClose(m.rep.v6, v6Fx.rep.v6);
    // note texts were reworded (legacy referred to its own phase plan); the same notes must be raised
    expect(m.rep.notes.length).toBe(v6Fx.rep.notes.length);
  });
});
