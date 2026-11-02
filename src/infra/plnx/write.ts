// Export a shelf planogram as a Spaceman (NIQ) .plnx (legacy buildPlnxXML / plnxBlob). Built from records copied from a
// real Spaceman 15.2 file (plnx-template.json, extracted verbatim from the legacy app), so every field Spaceman expects is
// present. Axes: X → right from the left edge of the section, Y ↑ from the floor, Z = depth from the back of a fixture.
// checksums.xml is left out (its scheme is not public); Spaceman then reads the file without verifying it.
import { arrayCount } from '../../domain/geometry';
import type { Scene } from '../../domain/scene';
import { shelfLayout } from '../../domain/shelf/layout';
import type { Sku } from '../../domain/types';
import { R2 } from '../../domain/util';
import { withBom, zipFiles } from '../zip';
import TPL from './plnx-template.json';

const T = TPL as Record<string, string>;
const xesc = (s: unknown) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fnum = (v: unknown) => { const n = Math.round((+v! || 0) * 1e4) / 1e4; return Object.is(n, -0) ? '0' : String(n); };
/** Replace the value of the first <tag>…</tag> in an XML record. */
function xset(x: string, tag: string, val: unknown) { const re = new RegExp('<' + tag + '>[^<]*</' + tag + '>'); if (!re.test(x)) return x; const v = typeof val === 'number' ? fnum(val) : xesc(val); return x.replace(re, () => '<' + tag + '>' + v + '</' + tag + '>'); }
function xsetAll(x: string, o: Record<string, unknown>) { for (const [k, v] of Object.entries(o)) x = xset(x, k, v); return x; }
const bgr = (hex: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 16777215; const n = parseInt(m[1], 16); return ((n & 255) << 16) | (n & 0xff00) | ((n >> 16) & 255); };
export function guid() { const h = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; }

export interface PlnxStats { bays: number; shelves: number; positions: number; facings: number; skus: number; loose: number; est: number }

export function buildPlnxXML(s: Scene, name: string, opts: { guid?: string } = {}): { xml: string; file: string; stats: PlnxStats } | null {
  const NL = '\r\n', M = shelfLayout(s);
  if (!M) return null;
  const { bays, X0, H } = M;
  const used = new Map<string, Sku>(), maxHigh = new Map<string, number>();
  let nPos = 0, nFac = 0, nUnits = 0, lin = 0, area = 0, cube = 0;
  const fixtures: string[] = [], W = R2(Math.max(...bays.map((y) => y.b.x1)) - X0), kick = Math.max(0, ...bays.map((y) => y.kick));
  const ind = (n: number, x: string) => ' '.repeat(n) + x;
  fixtures.push(xsetAll(T.fxBase.replace(/id="[^"]*"/, 'id="Baseboard/1"'), { Name: 'Base', X: 0, Width: W, Height: kick || 0.01, SectionId: 'Section/1' }));
  for (const y of bays) {
    const bx = y.b.x0 - X0, bw = y.b.x1 - y.b.x0, h = Math.max(1, y.b.y1 - y.kick);
    if (y.panel || y.o.type === 'fixture') {
      fixtures.push(xsetAll(T.fxNotch.replace(/id="[^"]*"/, `id="Left/${y.seg}"`), { Name: 'Left Notch/' + y.seg, X: bx, Y: y.kick, Width: 3, Height: h, Segment: y.seg, SectionId: 'Section/1' }));
      fixtures.push(xsetAll(T.fxBack.replace(/id="[^"]*"/, `id="Back/${y.seg}"`), { Name: 'Back/' + y.seg, X: bx + 3, Y: y.kick, Width: Math.max(1, bw - 6), Height: h, Segment: y.seg, SectionId: 'Section/1' }));
      fixtures.push(xsetAll(T.fxNotch.replace(/id="[^"]*"/, `id="Right/${y.seg}"`), { Name: 'Right Notch/' + y.seg, X: bx + bw - 3, Y: y.kick, Width: 3, Height: h, Segment: y.seg, SectionId: 'Section/1' }));
    }
    const zBack = y.b.z0 + y.panel;
    y.shelves.forEach((e, si) => {
      const b = e.b, sw = b.x1 - b.x0, above = y.shelves[si + 1], gapUp = above ? Math.max(0, above.b.y0 - b.y1) : Math.max(0, H - b.y1);
      const tallest = Math.max(0, ...e.items.map((it) => it.b.y1 - it.b.y0)), maxMerch = tallest > 0 ? Math.min(gapUp, Math.ceil(tallest + 0.5)) : gapUp;
      let usedW = 0;
      // MaxMerch = the stack actually planned (Spaceman would otherwise stack units up to the next shelf / top of the section)
      const pos = e.items.map((it, li) => {
        const o = it.o, k = s.skuOf(o), ib = it.b;
        if (!k) return '';
        used.set(k.id, k);
        const n = o.type === 'array' ? o.n : { x: 1, y: 1, z: 1 }, hs = ib.x1 - ib.x0, vs = ib.y1 - ib.y0, ds = ib.z1 - ib.z0, units = o.type === 'array' ? arrayCount(o) : 1;
        usedW += hs; nPos++;
        maxHigh.set(k.id, Math.max(maxHigh.get(k.id) || 0, n.y));
        nFac += n.x; nUnits += units; lin += hs; area += hs * vs; cube += hs * vs * ds;
        return ind(12, xsetAll(T.pos, { DepthFacings: n.z, DepthSpace: ds, FIXLPOS: e.fixel, HorizSpace: hs, Horizontal: n.x, ID: `_${nPos}-1`, LocationID: li + 1, Orientation: 0, ProdPos: k.code, TotalFacings: n.x, TotalUnits: units, VertSpace: vs, Vertical: n.y, X: ib.x0 - b.x0, Y: Math.max(0, ib.y0 - b.y1), Z: Math.max(0, ib.z0 - b.z0), HorizGap: 0, VertGap: 0 }));
      }).filter(Boolean);
      // shelf fields first (xset changes the FIRST match – once positions are inside, their X/Y/Z would come first)
      let f = xsetAll(T.fxShelf.replace(/id="[^"]*"/, `id="${xesc(e.fixel)}"`), { Name: 'Shelf/' + (si + 1), X: b.x0 - X0, Y: b.y0, Z: Math.max(0, b.z0 - zBack), Width: sw, Height: b.y1 - b.y0, Depth: b.z1 - b.z0, Top: b.y1, Segment: y.seg, SectionId: 'Section/1', Available: Math.max(0, sw - usedW), MaxMerch: maxMerch, FixtureDistance: gapUp });
      if (pos.length) f = f.replace('<positions count="0" />', `<positions count="${pos.length}">${NL}${pos.join(NL)}${NL}${ind(10, '</positions>')}`);
      fixtures.push(f);
    });
  }
  const prods = [...used.values()];
  const cps = prods.map((k) => {
    const a = k.attr || {}, form = ({ carton: 'CARTON', pack: 'PACK', unit: 'SINGLE' } as Record<string, string>)[k.form] || 'SINGLE';
    let x = T.cp.replace(/id="[^"]*"/, `id="${xesc(k.code)}"`);
    x = xsetAll(x, {
      Name: k.name || k.code, Upc: k.code, Gtin: '', Brand: k.brand || '', Manufacturer: k.maker || 'OTHER', Category: k.cat || '', SubCategory: k.sub || '', Width: +k.w || 1, Height: +k.h || 1, Depth: +k.d || 1, Peg1Depth: +k.d || 1, Colour: bgr(k.color), UnitsCase: k.form === 'unit' ? 1 : +k.units || 1,
      DescA: a.DescA || '', DescB: a.DescB || '', DescC: a.DescC || '', DescD: a.DescD || '', DescE: a.DescE || '', DescF: a.DescF || '', DescG: a.DescG || '', DescH: a.DescH || '', DescI: a.DescI || '', DescJ: a.DescJ || k.pkg || '', DescK: a.DescK || k.ml || '', DescL: a.DescL || form, Size: a.Size || k.ml || '',
    });
    x = xset(x, 'MaxHigh', maxHigh.get(k.id) || 1);
    if (k.seg) x = xset(x, 'Segment', k.seg);
    return ind(4, x);
  });
  const sps = prods.map((k) => ind(8, T.sp.replace(/id="[^"]*"/, `id="${xesc(k.code)}"`)));
  const store = xsetAll(T.store, { ID: '*Store*', Allocated: prods.length, ArealSpace: area, CubicSpace: cube, LinealSpace: lin, Name: '', Title: name, TotalPositions: nPos, TotalFacings: nFac, TotalUnits: nUnits, Unallocated: 0, ZeroMovement: prods.length, CustomSegmentString: '' });
  const segW = R2(bays[0].b.x1 - bays[0].b.x0), section = xsetAll(T.section, { Width: W, BaseWidth: W, Height: H, BaseHeight: kick, SegmentWidth: segW, NotchSpacing: bays[0].pitch || 3, X: 0, Y: 0, Z: 0, Name: '' });
  const file = name.replace(/[\\/:*?"<>|]/g, '_') + '.plnx';
  const head = T.head.replace(/<planogramgroup name="[^"]*"/, `<planogramgroup name="${xesc(file)}"`);
  const xml = head + `<commonproducts count="${prods.length}">` + NL + cps.join(NL) + NL + '  </commonproducts>' + NL + '  <planograms count="1" type="single">' + NL +
    `    <planogram name="${xesc(file)}" id="${opts.guid || guid()}" archiveaction="0" fromdatabaseid="" fromid="" templateid="0" open="True" active="False" uri="">` + NL +
    ind(6, store) + NL + ind(6, section) + NL + ind(6, `<specificproducts count="${prods.length}">`) + NL + sps.join(NL) + NL + ind(6, '</specificproducts>') + NL + ind(6, T.mid) +
    `<fixtures count="${fixtures.length}">` + NL + fixtures.map((f) => ind(8, f)).join(NL) + NL + ind(6, '</fixtures>') + NL + ind(6, '<decorativeitems count="0" />') + NL + ind(6, T.tail);
  return { xml, file, stats: { bays: bays.length, shelves: bays.reduce((a, y) => a + y.shelves.length, 0), positions: nPos, facings: nFac, skus: prods.length, loose: M.loose, est: prods.filter((k) => k.est).length } };
}

export async function plnxBlob(s: Scene, name: string, opts: { store?: boolean } = {}) {
  const r = buildPlnxXML(s, name);
  if (!r) return null;
  const now = new Date().toISOString().slice(0, 19);
  const info = T.info.replace(/<CreatedDate>[^<]*<\/CreatedDate>/, `<CreatedDate>${now}</CreatedDate>`).replace(/<ModifiedDate>[^<]*<\/ModifiedDate>/, `<ModifiedDate>${now}</ModifiedDate>`);
  const blob = await zipFiles([
    { name: 'planograms.xml', data: withBom(r.xml) },
    { name: 'printsettings.xml', data: withBom(T['printsettings.xml']) },
    { name: 'autoplace.xml', data: withBom(T['autoplace.xml'].replace(/planogramname="[^"]*"/, `planogramname="${xesc(r.file)}"`)) },
    { name: 'info.xml', data: withBom(info) },
  ], opts);
  return { ...r, blob };
}
