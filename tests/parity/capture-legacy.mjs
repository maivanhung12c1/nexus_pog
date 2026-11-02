// Parity capture: runs the LEGACY app (Nexus_POG.html) in headless Chrome and records reference outputs of its
// business functions (through the legacy debug handle window.SP7) for the new implementation to be compared against.
// Usage: npm run parity:capture   →  writes tests/parity/fixtures/*.json
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(here, 'fixtures');
mkdirSync(out, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(root, 'Nexus_POG.html')).href);
await page.waitForFunction(() => window.SP7 && window.SP7.CATALOG && window.SP7.CATALOG.length > 3000, null, { timeout: 60000 });
await page.waitForTimeout(500);

const save = (name, data) => { writeFileSync(join(out, name + '.json'), JSON.stringify(data)); console.log('  ✓', name); };

// 1. catalog built from the embedded master (skuFromMaster / formFromPack / estDims / colorFor)
save('catalog', await page.evaluate(() => window.SP7.CATALOG.map((k) => ({ id: k.id, code: k.code, form: k.form, units: k.units, w: k.w, d: k.d, h: k.h, est: !!k.est, color: k.color, maker: k.maker, brand: k.brand, cat: k.cat, sub: k.sub }))));

// 2. a gondola planogram with facing blocks → metrics, BOM, checks, space share, PLNX, preflight, auto POG
const shelfCase = await page.evaluate(async () => {
  const S = window.SP7, C = S.CATALOG;
  const pickBy = (re, n) => C.filter((k) => !k.est && k.form === 'unit' && re.test(k.maker || '') && k.h < 30 && k.w > 4).slice(0, n);
  const skus = [...pickBy(/SPVB/, 8), ...pickBy(/^KO$/, 5), ...pickBy(/URC|TCP|LA VIE/, 4), ...C.filter((k) => !k.est && k.form === 'carton').slice(0, 2)];
  const d = S.newShelfDesign(S.GONDOLA_PRESETS.g120, 3);
  d.meta.name = 'Parity gondola';
  let id = 0;
  const shelves = d.objects.filter((o) => o.type === 'shelf').sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y);
  let si = 0;
  for (const sh of shelves) {
    const x0 = sh.pos.x - sh.size.w / 2, top = sh.pos.y + sh.size.h, z1 = sh.pos.z + sh.size.d / 2;
    let x = x0 + 1;
    for (let j = 0; j < 3; j++) {
      const k = skus[(si * 3 + j) % skus.length];
      d.skus[k.id] = JSON.parse(JSON.stringify(k));
      const fac = 2 + ((si + j) % 3), nz = Math.max(1, Math.floor(sh.size.d / k.d)), w = fac * k.w;
      if (x + w > x0 + sh.size.w) break;
      d.objects.push({ id: 'p' + id++, type: 'array', sku: k.id, n: { x: fac, y: 1, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: 0, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: Math.round((x + w / 2) * 100) / 100, y: top, z: Math.round((z1 - (nz * k.d) / 2) * 100) / 100 } });
      x += w + 0.5;
    }
    si++;
  }
  // a floating product and an overlapping one to exercise the checks
  const k0 = skus[0];
  d.objects.push({ id: 'float1', type: 'sku', sku: k0.id, pos: { x: 30, y: 230, z: 20 }, ry: 0 });
  d.objects.push({ id: 'ovl1', type: 'sku', sku: k0.id, pos: { ...d.objects.find((o) => o.id === 'p0').pos }, ry: 45 });
  d.settings.sales = {};
  for (const k of skus.slice(0, 10)) d.settings.sales[String(k.code).replace(/^0+(?=\d)/, '')] = 10 + (k.code.charCodeAt(k.code.length - 1) % 7) * 5;
  const input = JSON.parse(JSON.stringify(d));
  await S.loadDesign(d, {}, 'parity');
  const D = S.D;
  const strip = (o) => JSON.parse(JSON.stringify(o, (key, v) => (key === 'k' && v && v.id ? v.id : key === 'o' && v && v.id ? v.id : v)));
  const metrics = strip(S.shelfMetrics());
  const bom = strip(S.computeBOM());
  const checks = S.runChecks();
  const P = S.rpPositions(D);
  const pos = strip(P);
  const aggMaker = strip(S.rpAgg(P, 'maker', null)), aggBrand = strip(S.rpAgg(P, 'brand', null)), aggScoped = strip(S.rpAgg(P, 'brand', { dim: 'maker', val: 'SPVB' }));
  const preflight = S.plnxPreflight();
  const px = S.buildPlnxXML('Parity gondola');
  const xml = px.xml.replace(/ id="[0-9a-f-]{36}"/, ' id="GUID"');
  // auto POG
  Object.assign(S.AP, { zone: 'sub', block: 'maker', order: 'cdt', flow: 'ltr', focus: 'SPVB', focusAt: 'first', gz0: 100, gz1: 160, big: 28, weight: 'sales', fmin: 1, fmax: 12, snap: true, stack: false, target: { SPVB: 45 } });
  const ap = {};
  for (const mode of ['cur', 'sales', 'target']) {
    const r = S.apBuild(mode, 'X');
    ap[mode] = { shares: r.shares, seq: r.seq, warn: r.warn, dropped: r.dropped.map((x) => x.k.id), objects: r.design.objects.filter((o) => o.type === 'array').map((o) => ({ sku: o.sku, n: o.n, pos: o.pos, cellRy: o.cellRy })) };
  }
  Object.assign(S.AP, { zone: 'none', block: 'brand', order: 'cur', flow: 'rtl', weight: 'eq', snap: false, stack: true, target: {} });
  const r2 = S.apBuild('cur', 'Y');
  ap.cur_rtl = { shares: r2.shares, seq: r2.seq, warn: r2.warn, dropped: r2.dropped.map((x) => x.k.id), objects: r2.design.objects.filter((o) => o.type === 'array').map((o) => ({ sku: o.sku, n: o.n, pos: o.pos, cellRy: o.cellRy })) };
  return { input, metrics, bom, checks, pos, aggMaker, aggBrand, aggScoped, preflight, xml, stats: px.stats, ap };
});
save('shelf-case', shelfCase);

// 3. shelf operations: pack, fill depth, notch, riders, facings limited by the shelf (setArrayParam → setCount)
const shelfOps = await page.evaluate(async () => {
  const S = window.SP7;
  const snap = () => JSON.parse(JSON.stringify(S.D.objects)).map((o) => ({ id: o.id, type: o.type, pos: o.pos, n: o.n, sku: o.sku }));
  const res = {};
  const shelf = () => S.D.objects.filter((o) => o.type === 'shelf').sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y)[1];
  S.packShelf(shelf(), 'R'); res.packR = snap();
  S.packShelf(shelf(), 'D'); res.packD = snap();
  S.packShelf(shelf(), 'L'); res.packL = snap();
  S.fillDepth(shelf()); res.fill = snap();
  const sh = shelf();
  res.notch = [10, 33.3, 47.9, 101.2].map((y) => S.notchY(sh, y));
  res.riders = [...S.ridersOf([sh.id])].sort();
  const blk = S.D.objects.find((o) => o.id === 'p3');
  S.setArrayParam(blk, 'nx', 40); res.limitX = snap();
  S.setArrayParam(S.D.objects.find((o) => o.id === 'p3'), 'ny', 30); res.limitY = snap();
  S.setArrayParam(S.D.objects.find((o) => o.id === 'p3'), 'nz', 30); res.limitZ = snap();
  res.undoLen = S.undoStack.length;
  return res;
});
save('shelf-ops', shelfOps);

// 4. pallet display: hollow shell + BOM, explode / split levels / duplicate / rotate
const palletCase = await page.evaluate(async () => {
  const S = window.SP7, C = S.CATALOG;
  const carton = C.find((k) => k.form === 'carton' && !k.est && /PEPSI/.test(k.name)) || C.find((k) => k.form === 'carton' && !k.est);
  const pack = C.find((k) => k.form === 'pack' && !k.est) || carton;
  const d = { schema: 7, meta: { name: 'Parity pallet', by: '', created: 1, updated: 1 }, settings: { maxH: 150, overhang: 0, preset: 'go' }, skus: {}, objects: [
    { id: 'pal1', type: 'pallet', name: 'Pallet GO!', size: { w: 120, d: 80, h: 20 }, pos: { x: 60, y: 0, z: 40 }, ry: 0, lock: true },
    { id: 'pal2', type: 'pallet', name: 'Pallet 2', size: { w: 120, d: 80, h: 20 }, pos: { x: 180, y: 0, z: 40 }, ry: 0, lock: true },
    { id: 'c1', type: 'sku', sku: carton.id, pos: { x: 20, y: 20, z: 20 }, ry: 0 },
  ] };
  d.skus[carton.id] = JSON.parse(JSON.stringify(carton));
  d.skus[pack.id] = JSON.parse(JSON.stringify(pack));
  const input = JSON.parse(JSON.stringify(d));
  await S.loadDesign(d, {}, 'parity pallet');
  const norm = (objs) => objs.map((o) => ({ type: o.type, subtype: o.subtype, sku: o.sku, n: o.n, pos: o.pos, cellRy: o.cellRy, size: o.size })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  const all = S.D.objects.filter((o) => o.type === 'pallet');
  const shell = {};
  for (const [label, opt, side] of [['outer-lid', { lid: true, sides: 'outer', replace: true, levels: 4 }, null], ['all-nolid', { lid: false, sides: 'all', replace: true, levels: 3 }, null], ['perface', { lid: true, sides: 'outer', replace: true, levels: 5 }, { front: carton.id, back: pack.id, left: pack.id, right: carton.id, lid: carton.id }]]) {
    const r = S.shellFor(all[0], { ...opt, sku: carton.id, skuPerSide: side }, all);
    shell[label] = { n: r.n, top: r.top, objs: norm(r.objs) };
  }
  S.edit('shell', () => S.applyShell([{ pid: 'pal1', sku: carton.id, levels: 4 }, { pid: 'pal2', sku: carton.id, skuPerSide: { front: carton.id, back: pack.id, left: '', right: '', lid: carton.id }, levels: 4 }], { lid: true, sides: 'outer', replace: true }));
  const afterShell = norm(S.D.objects);
  const bom = JSON.parse(JSON.stringify(S.computeBOM(), (k, v) => (k === 'k' && v && v.id ? v.id : v)));
  // explode the first wall array, split levels of another
  const arrs = S.D.objects.filter((o) => o.type === 'array');
  S.explodeArray(arrs[0]);
  const afterExplode = norm(S.D.objects);
  const arr2 = S.D.objects.filter((o) => o.type === 'array')[1];
  S.splitLevels(arr2);
  const afterSplit = norm(S.D.objects);
  S.undo(); S.undo();
  const afterUndo = norm(S.D.objects);
  return { input, carton: carton.id, pack: pack.id, shell, afterShell, bom, afterExplode, afterSplit, afterUndo };
});
save('pallet-case', palletCase);

// 5. PDF text-layer parser on synthetic GO! and Lotte pages
const pdfCase = await page.evaluate(() => {
  const S = window.SP7;
  const row = (y, cells) => cells.map(([x, s]) => ({ s, x, y, w: s.length * 4, fs: 7 }));
  const goPage = [
    ...row(800, [[40, 'POG PHU THANH - PW - IDEALLY.plnx'], [400, 'Page 1']]),
    ...row(780, [[40, 'Product List']]),
    ...row(760, [[40, 'Fixel_ID'], [90, 'Location_ID'], [150, 'Product_ID'], [220, 'UPC'], [300, 'Name'], [520, 'Total_Facings'], [580, 'Capacity']]),
    ...row(740, [[40, '1/1'], [90, '1'], [150, 'P001'], [220, '8934588012228'], [300, 'PEPSI COLA 320ML LON'], [520, '4'], [580, '24']]),
    ...row(728, [[40, '1/1'], [90, '2'], [150, 'P002'], [220, '8934588672118'], [300, '7UP 320ML LON'], [520, '3'], [580, '18']]),
    ...row(716, [[40, '1/2'], [90, '1'], [150, 'P003'], [220, '8935049501503'], [300, 'AQUAFINA 500ML'], [520, '5']]),
    ...row(705.5, [[40, '2/1']]),
    ...row(704, [[90, '1'], [150, 'P004'], [220, '8934588063053'], [300, 'STING DAU 330ML'], [520, '2'], [580, '12']]),
  ];
  const goDrawing = [
    ...row(500, [[40, 'chieu cao 1.62m'], [140, '1/5']]),
    ...row(400, [[40, 'chieu cao 96.00cm'], [140, '1/3']]),
    ...row(300, [[40, '<====='], [200, 'LOI DI']]),
  ];
  const lottePage = [
    ...row(800, [[40, 'LOTTE MART PLANOGRAM NUOC GIAI KHAT'], [300, 'STORE: LOTTE Q7']]),
    ...row(760, [[40, 'STT'], [70, 'Sale.code'], [150, 'Name'], [350, 'Manufacturer'], [450, 'Facing'], [500, 'Wobbler-Exp']]),
    ...row(740, [[40, 'Fixel_ID 1/1']]),
    ...row(728, [[40, '1'], [70, '8934588012228'], [150, 'PEPSI COLA LON'], [350, 'SUNTORY PEPSICO'], [460, '3']]),
    ...row(716, [[150, '320ML'], [350, 'VIETNAM']]),
    ...row(704, [[40, '2'], [70, '8935049501503'], [150, 'AQUAFINA 500ML'], [350, 'SUNTORY PEPSICO'], [460, '2']]),
    ...row(690, [[40, 'Fixel_ID 1/2']]),
    ...row(678, [[40, '3'], [70, '8934588063053'], [150, 'STING DAU 330ML'], [350, 'SUNTORY PEPSICO'], [460, '6']]),
  ];
  const pages = [goDrawing, goPage];
  const go = S.parsePOGPages(pages);
  const lotte = S.parsePOGPages([lottePage]);
  const lines = S.pogLines(goPage);
  return { goPages: pages, go, lottePages: [lottePage], lotte, lines: lines.map((l) => ({ y: l.y, t: l.t })) };
});
save('pdf-case', pdfCase);

// 6. V6 migration
const v6Case = await page.evaluate(async () => {
  const S = window.SP7;
  const P = { meta: { name: 'V6 test' }, preset: 'go', cluster: '2', combine: false, pallet: { w: 120, d: 80, h: 15, maxH: 150, gap: 5 }, tol: { overhang: 2 },
    skus: [{ id: 's1', code: '8934588012228', name: 'TH. PEPSI 24 LON 320ML', w: 40, d: 27, h: 13, units: 24, kg: 8, color: '#1f4fa3' }, { id: 's2', code: '8935049501503', name: 'AQUAFINA 500ML THUNG 24', w: 39, d: 26, h: 22, units: 24 }],
    stacks: [{ pallets: [0], layers: [{ sku: 's1', boxes: [{ x: 0, y: 0, w: 40, d: 27 }, { x: 40, y: 0, w: 40, d: 27, rot: 1 }] }, { sku: 's2', boxes: [{ x: 0, y: 0, w: 39, d: 26 }] }] }],
    hid: { elements: [{ kind: 'block', sku: 's1', preset: 'can330', nx: 3, ny: 2, nz: 2, x: 10, y: 10, z: 50, name: 'Khối lon' }, { kind: 'pyramid', sku: 's2', uw: 20, ud: 13, uh: 22, nx: 3, ny: 3, nz: 2, x: 0, y: 40, z: 60, rot: 1 }, { kind: 'prop', nx: 2, ny: 1, nz: 1, uw: 10, ud: 10, uh: 20, x: 5, y: 5, z: 80 }, { kind: 'board', uw: 80, uh: 40, th: 1.2, x: 20, y: 0, z: 100 }, { kind: 'text' }], skirt: { on: true, h: 15, color: '#ffffff', faces: {} } } };
  const m = await S.migrateV6(JSON.parse(JSON.stringify(P)), {});
  const norm = (objs) => objs.map((o) => ({ type: o.type, subtype: o.subtype, sku: o.sku, n: o.n, shape: o.shape, pos: o.pos, ry: o.ry, size: o.size, name: o.name })).sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return { input: P, objects: norm(m.design.objects), skus: m.design.skus, settings: m.design.settings, rep: m.rep };
});
save('v6-case', v6Case);

console.log(errors.length ? 'page errors: ' + errors.join('\n') : 'no page errors');
await browser.close();
