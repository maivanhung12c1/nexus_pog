// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import shelfFx from '../parity/fixtures/shelf-case.json';
import { Scene } from '../../src/domain/scene';
import type { Design, Sku } from '../../src/domain/types';
import { deep } from '../../src/domain/util';
import { buildPlnxXML, plnxBlob } from '../../src/infra/plnx/write';
import { buildFromPlnx, parsePlanogramsXml, readPlnx } from '../../src/infra/plnx/read';
import { unzipEntries, zipFiles } from '../../src/infra/zip';
import { parseCSV, toCSV } from '../../src/infra/csv';
import { readXLSX, writeXLSX } from '../../src/infra/xlsx';
import { mergeImported, rowsToItems, backfillPids, duplicateCodes, makerSummary } from '../../src/domain/catalog/catalog';
import { parsePrice, resolvePrice } from '../../src/domain/catalog/pricing';
import { normaliseDesign } from '../../src/domain/migration/normalize';
import { openProjectText, projectJSON } from '../../src/infra/projectFile';
import { sheetSummary, defaultSheet, presetLabel } from '../../src/domain/operations/sheet';
import { applySalesSimple, applySalesWide, salesWide } from '../../src/domain/shelf/sales';
import { shelfMetrics } from '../../src/domain/shelf/metrics';
import { transact, applyDiff } from '../../src/domain/history';
import { duplicate, nudge, rotate, remove } from '../../src/domain/ops/edit';
import { addGondola, newShelfDesign, resizeBay, deleteBay, addShelf } from '../../src/domain/shelf/gondola';
import { GONDOLA_PRESETS } from '../../src/domain/presets';
import { parseImageName } from '../../src/infra/images';
import { skuChanges, positions } from '../../src/domain/analysis/spaceShare';
import { compareDesigns } from '../../src/domain/analysis/compare';

const design = () => deep(shelfFx.input) as unknown as Design;
const hooks = (cat: Sku[]) => ({ byId: (id: string) => cat.find((k) => k.id === id), applyPool: () => {} });

describe('Spaceman .plnx round trip', () => {
  it('design → .plnx (zip) → design keeps every position, facing and SKU', async () => {
    const d = design();
    d.objects = d.objects.filter((o) => o.id !== 'float1'); // loose stock is not exported (preflight reports it)
    const s = new Scene(d);
    const out = await plnxBlob(s, 'Round trip', { store: true });
    expect(out).not.toBeNull();
    const file = await readPlnx(out!.blob);
    expect(file.pogs.length).toBe(1);
    expect(file.products.size).toBe(out!.stats.skus);
    const { design: back, rep } = buildFromPlnx(file.pogs[0], file.products, file.scale, 'rt.plnx', hooks([]));
    expect(rep.positions).toBe(out!.stats.positions);
    const facings = (x: Design) => x.objects.reduce((a, o) => a + (o.type === 'array' ? o.n.x : 0), 0);
    expect(facings(back)).toBe(out!.stats.facings);
    // linear per SKU survives (Spaceman HorizSpace)
    const lin = (x: Design) => { const m = new Map<string, number>(); for (const p of positions(x).pos) m.set(p.k.code, (m.get(p.k.code) || 0) + p.lin); return m; };
    const a = lin(d), b = lin(back);
    for (const [code, v] of b) expect(v).toBeCloseTo(a.get(code)!, 1);
  });
  it('writes deflated zips that unzip again', async () => {
    const z = await zipFiles([{ name: 'a.txt', data: new TextEncoder().encode('xin chào '.repeat(200)) }]);
    const e = await unzipEntries(z);
    expect(new TextDecoder().decode((await e[0].get())!)).toBe('xin chào '.repeat(200));
  });
  it('inches are converted when IsMetric is False', () => {
    const r = buildPlnxXML(new Scene(design()), 'inch', { guid: 'G' })!;
    const f = parsePlanogramsXml(r.xml.replace('<IsMetric>True</IsMetric>', '<IsMetric>False</IsMetric>'));
    expect(f.scale).toBe(2.54);
  });
});

describe('CSV / XLSX catalog import', () => {
  it('parses quoted CSV with ; delimiter and imports Vietnamese headers incl. prices', () => {
    const rows = parseCSV('﻿Mã SKU;Tên sản phẩm;Chiều dài;Chiều rộng;Chiều cao;Đơn vị thùng;Giá niêm yết;Giá khuyến mãi\n8934588012228;"PEPSI ""COLA"" THÙNG 24 LON";40;27;13;24;210000;189000\n;;;;\n');
    const r = rowsToItems(rows);
    expect(r.items.length).toBe(1);
    const k = r.items[0];
    expect(k.id).toBe('c:8934588012228');
    expect(k.form).toBe('carton');
    expect(k.units).toBe(24);
    expect(k.priceNormal).toBe(210000);
    expect(k.pricePromo).toBe(189000);
    expect(k.name).toBe('PEPSI "COLA" THÙNG 24 LON');
  });
  it('XLSX written then read gives the same rows', async () => {
    const rows = [['Code', 'Name', 'Width', 'Depth', 'Height'], ['123456789', 'Trà xanh 0 độ', 6.5, 6.5, 22]];
    const back = await readXLSX(await writeXLSX(rows));
    expect(back).toEqual(rows.map((r) => r.map(String)));
  });
  it('merge keeps faces, PIDs and prices of existing SKUs', () => {
    const cat: Sku[] = [{ ...rowsToItems([['code', 'name', 'w', 'd', 'h'], ['1', 'A', '1', '1', '1']]).items[0], faces: { front: 'a1' }, pid: 'NXP-000001', priceNormal: 5000 }];
    const { nNew, nUpd } = mergeImported(cat, rowsToItems([['code', 'name', 'w', 'd', 'h'], ['1', 'A2', '2', '2', '2'], ['2', 'B', '1', '1', '1']]).items);
    expect([nNew, nUpd]).toEqual([1, 1]);
    expect(cat[0].faces.front).toBe('a1'); expect(cat[0].pid).toBe('NXP-000001'); expect(cat[0].priceNormal).toBe(5000); expect(cat[0].w).toBe(2);
  });
  it('CSV writer escapes quotes and adds a BOM', () => expect(toCSV([['a"b', 1]])).toBe('﻿"a""b","1"'));
});

describe('catalog identity, competitors, pricing', () => {
  it('PIDs are assigned once, in order, idempotently', () => {
    const cat = [{ code: '1' }, { code: '2', pid: 'NXP-000007' }, { code: '3' }] as Sku[];
    const n = backfillPids(cat, 7);
    expect(cat.map((k) => k.pid)).toEqual(['NXP-000008', 'NXP-000007', 'NXP-000009']);
    expect(backfillPids(cat, n)).toBe(n);
  });
  it('duplicate codes are reported, never merged', () => {
    const cat = [{ id: 'a', code: '0123' }, { id: 'b', code: '123' }, { id: 'c', code: '9', identifiers: [{ type: 'EAN13', value: '0123' }] }] as Sku[];
    expect(duplicateCodes(cat)[0].skus.length).toBe(3);
  });
  it('maker summary flags the own manufacturer', () => {
    const m = makerSummary([{ maker: 'SPVB' }, { maker: 'KO' }, { maker: 'KO' }] as Sku[], 'SPVB');
    expect(m[0]).toMatchObject({ maker: 'KO', skus: 2, own: false });
    expect(m[1].own).toBe(true);
  });
  it('prices: master by default, project override wins, blank override = master', () => {
    const k = { id: 'c:1', priceNormal: 12000, pricePromo: 10000 } as Sku;
    expect(resolvePrice(k, null)).toMatchObject({ normal: 12000, promo: 10000, normalSrc: 'master' });
    const sh = { ...defaultSheet(design()), prices: { 'c:1': { normal: '13.500', promo: '' } } };
    expect(resolvePrice(k, sh)).toMatchObject({ normal: 13500, promo: 10000, normalSrc: 'override', promoSrc: 'master' });
    expect(parsePrice('12,500 ₫')).toBe(12500);
    expect(parsePrice('')).toBeNull();
  });
});

describe('project files and migration', () => {
  it('schema-7 legacy file opens, is normalised and reports kept fields', async () => {
    const d7: Record<string, unknown> = { ...design(), schema: 7, sheet: { displayType: 'ụ', preparedBy: 'An', prices: {}, posm: [], tot: {} }, extraLegacyField: 1 };
    (d7.meta as Record<string, unknown>).preset = 'go';
    const r = await openProjectText(JSON.stringify({ format: 'smart-pallet-scene', schema: 7, design: d7, assets: {} }), async () => 'x');
    expect(r.kind).toBe('design');
    if (r.kind !== 'design') return;
    expect(r.design.schema).toBe(8);
    expect(r.design.sheet!.displayType).toBe('u');
    expect(r.report.kept).toContain('extraLegacyField');
    expect(r.design.legacy!.extraLegacyField).toBe(1);
    expect(r.design.objects.length).toBe(design().objects.length);
  });
  it('objects with a missing SKU are kept with a placeholder SKU and reported', () => {
    const d = design(); d.objects.push({ id: 'zz', type: 'sku', sku: 'c:404', pos: { x: 0, y: 0, z: 0 }, ry: 0 });
    const { design: n, report } = normaliseDesign(d);
    expect(n.objects.some((o) => o.id === 'zz')).toBe(true);
    expect(n.skus['c:404'].name).toContain('missing');
    expect(report.notes.join(' ')).toContain('c:404');
  });
  it('save → open round trip embeds used assets only', async () => {
    const d = design(); const k = Object.values(d.skus)[0]; k.faces = { front: 'a1' };
    const json = projectJSON(d, new Map([['a1', 'data:x'], ['a2', 'data:y']]));
    const o = JSON.parse(json);
    expect(Object.keys(o.assets)).toEqual(['a1']);
    expect(o.format).toBe('nexus-pog');
  });
});

describe('undo / redo and editing', () => {
  it('every edit is reversible and re-doable to the identical document', () => {
    const s = new Scene(design()), start = JSON.stringify(s.d);
    const ids = s.d.objects.filter((o) => o.type === 'array').slice(0, 3);
    const diffs = [
      transact(s, 'dup', () => duplicate(s, ids, 'U')).diff!,
      transact(s, 'nudge', () => nudge(s, ids, 3, 0, -2)).diff!,
      transact(s, 'rot', () => rotate(s, ids, 90)).diff!,
      transact(s, 'del', () => remove(s, new Set([ids[0].id]))).diff!,
    ];
    const end = JSON.stringify(s.d);
    for (const d of [...diffs].reverse()) applyDiff(s.d, d, -1);
    expect(JSON.stringify(s.d)).toBe(start);
    for (const d of diffs) applyDiff(s.d, d, 1);
    expect(JSON.stringify(s.d)).toBe(end);
  });
  it('strict mode blocks a move that creates a new collision', () => {
    const s = new Scene(design());
    const [, , a, b] = s.d.objects.filter((o) => o.type === 'array'); // p0 is already overlapped in the fixture
    const r = transact(s, 'move', () => { a.pos.x = b.pos.x; a.pos.z = b.pos.z; a.pos.y = b.pos.y; }, { strict: true });
    expect(r.ok).toBe(false);
    expect(r.blocked).toBeTruthy();
    expect(s.get(a.id)!.pos.x).not.toBe(b.pos.x);
  });
  it('bays: add, resize (bays to the right shift), add shelf, delete', () => {
    const s = new Scene(newShelfDesign(GONDOLA_PRESETS.g100, 2));
    addGondola(s, GONDOLA_PRESETS.g100, 1);
    const bays = s.d.objects.filter((o) => o.type === 'fixture');
    expect(bays.length).toBe(3);
    const last = bays[2];
    resizeBay(s, bays[0] as never, 120);
    expect(s.aabb(last).x0).toBeCloseTo(220, 6);
    const n = s.d.objects.length;
    addShelf(s, bays[1] as never);
    expect(s.d.objects.length).toBe(n + 1);
    deleteBay(s, bays[1] as never);
    expect(s.d.objects.filter((o) => o.type === 'fixture').length).toBe(2);
    expect(s.aabb(last).x0).toBeCloseTo(120, 6);
  });
});

describe('build sheet (Phiếu Dựng)', () => {
  it('summary totals add up from the lines; preset badge no longer blank', () => {
    const d = design();
    const sm = sheetSummary(d);
    expect(sm.totalFac).toBe(sm.lines.reduce((a, l) => a + l.fac, 0));
    expect(sm.skuCount).toBe(new Set(d.objects.filter((o) => o.type === 'array' || o.type === 'sku').map((o) => (o as { sku: string }).sku)).size);
    expect(presetLabel(d)).toMatch(/3 bay × 120 cm/);
  });
});

describe('sales import', () => {
  it('AEON wide layout → weekly units per code', () => {
    const rows = [['', '', 'Jan 2026', 'Feb 2026', 'Overall'], ['Name Store', 'Item Barcode', 'Sold Quantity', 'Sold Quantity', 'Sold Quantity'], ['AEON A', '08934588012228', '30', '31', '61'], ['AEON B', '8934588012228', '10', '0', '10'], ['Overall', '', '', '', '']];
    const W = salesWide(rows)!;
    expect(W.months.map((m) => m.label)).toEqual(['Jan 2026', 'Feb 2026']);
    const res = applySalesWide(W, '*sum', W.months, () => 1);
    expect(res['8934588012228']).toBeCloseTo(Math.round((71 / 2 * 7 / 30.44) * 10) / 10, 6);
  });
  it('simple layout with pack conversion', () => {
    const r = applySalesSimple([['Barcode', 'Sales'], ['123', '10']], 'sku', 'week', () => 24);
    expect(r.sales['123']).toBe(240);
  });
  it('days of supply uses weekly sales', () => {
    const m = shelfMetrics(new Scene(design()));
    const r = m.rows.find((x) => x.sales > 0 && !x.unknown)!;
    expect(r.dos).toBeCloseTo(r.conv / (r.sales / 7), 6);
  });
});

describe('analysis helpers', () => {
  it('SKU changes between current and proposal', () => {
    const a = design(), b = design();
    const arr = b.objects.find((o) => o.type === 'array')! as { n: { x: number } };
    arr.n.x += 2;
    const ch = skuChanges(positions(a), positions(b), null);
    expect(ch.some((c) => c.st === 'up')).toBe(true);
    const cmp = compareDesigns(a, b);
    expect(cmp.rows.some((r) => r.st === 'up')).toBe(true);
  });
  it('image names: Spaceman suffixes and plain files', () => {
    expect(parseImageName('8934588012228.1')).toEqual({ key: '8934588012228', face: 'front' });
    expect(parseImageName('dir/0123_8.jpg')).toEqual({ key: '0123', face: 'right' });
    expect(parseImageName('abc.png')).toEqual({ key: 'abc', face: 'front' });
    expect(parseImageName('notes.txt')).toBeNull();
  });
});

describe('fix: facings of a block straddling two bays count once', () => {
  it('linear splits across the joint, facings do not double', () => {
    const s = new Scene(newShelfDesign(GONDOLA_PRESETS.g120, 2));
    const sh = s.d.objects.filter((o) => o.type === 'shelf').sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x)[2]; // a mid shelf of bay 1
    const top = s.aabb(sh).y1;
    s.d.skus['c:x'] = { id: 'c:x', code: 'x', name: 'X', brand: '', maker: 'SPVB', form: 'unit', w: 6, d: 6, h: 20, units: 1, kg: 0, color: '#123456', family: '', faces: {}, ml: '', pkg: '', cat: '', sub: '' };
    s.d.objects.push({ id: 'blk', type: 'array', sku: 'c:x', n: { x: 4, y: 1, z: 7 }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: 0, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: 120, y: top, z: 30 } });
    s.invalidate();
    const m = shelfMetrics(s);
    expect(m.rows[0].facings).toBe(4);
    expect(m.rows[0].linear).toBeCloseTo(24, 6);
  });
});

describe('build sheet prices come from master data', () => {
  it('a price added to the catalog after the SKU was snapshotted is used; overrides still win', () => {
    const d = design(), id = Object.keys(d.skus)[0];
    const master = (x: string) => (x === id ? { priceNormal: 12500, pricePromo: 9900 } : undefined);
    let line = sheetSummary(d, master).lines.find((l) => l.k.id === id)!;
    expect([line.priceNormal, line.pricePromo]).toEqual([12500, 9900]);
    d.sheet = { ...defaultSheet(d), prices: { [id]: { normal: '13000' } } };
    line = sheetSummary(d, master).lines.find((l) => l.k.id === id)!;
    expect([line.priceNormal, line.pricePromo]).toEqual([13000, 9900]);
  });
});
