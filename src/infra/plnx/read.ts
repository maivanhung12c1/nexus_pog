// Spaceman (NIQ) .plnx import → shelf design with the real fixture & position coordinates (legacy readPlnx / smPog /
// smSku / buildFromPlnx / mergePlnxCatalog). planograms.xml: <commonproducts> + one or more <planogram>.
// Spaceman front elevation: X → right, Y ↑, Z = depth from the back; cm when <IsMetric>True</IsMetric> (else inches).
import { skuFromMaster, fixForm } from '../../domain/catalog/sku';
import { emptyShelfDesign } from '../../domain/design';
import { arraySizeWith, skuDims } from '../../domain/geometry';
import { L } from '../../domain/i18n';
import type { ArrayObj, Design, Sku } from '../../domain/types';
import { deep, R2, uid } from '../../domain/util';
import { unzipEntries } from '../zip';

export const SM_PF = ['Name', 'Upc', 'Manufacturer', 'Brand', 'Category', 'SubCategory', 'Segment', 'SubSegment', 'Size', 'DescA', 'DescB', 'DescC', 'DescD', 'DescE', 'DescF', 'DescG', 'DescH', 'DescI', 'DescJ', 'DescK', 'DescL', 'String1', 'String2', 'String3', 'String4', 'String5', 'Width', 'Height', 'Depth', 'UnitsCase', 'RegMovement'];
const SM_RE = Object.fromEntries(SM_PF.map((f) => [f, new RegExp('<' + f + '>([^<]*)</' + f + '>')]));
export const xdec = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e.toLowerCase()]));
const Nn = (v: unknown) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : 0; };

const kids = (el: Element | undefined, tag: string) => { const o: Element[] = []; if (!el) return o; for (const c of Array.from(el.children)) if (c.tagName === tag) o.push(c); return o; };
const leaf = (el: Element) => { const o: Record<string, string> = {}; for (const c of Array.from(el.children)) if (!c.children.length) o[c.tagName] = (c.textContent || '').trim(); return o; };

export interface SmPosition { pid: string; x: number; y: number; z: number; hs: number; vs: number; ds: number; hf: number; vf: number; df: number; units: number; orient: number }
export interface SmFixture { id: string; type: string; name: string; x: number; y: number; z: number; w: number; h: number; d: number; comb: number; positions: SmPosition[] }
export interface SmPog { name: string; store: string; storeId: string; sections: { x: number; y: number; z: number; w: number; h: number; d: number; name: string }[]; fixtures: SmFixture[]; labels: { text: string; x: number; y: number; w: number; h: number }[] }
export type SmProduct = Record<string, string>;

export function parsePlanogramXml(xml: string): SmPog {
  const j = xml.indexOf('<specificproducts');
  if (j >= 0) { const k = xml.indexOf('</specificproducts>', j); if (k >= 0) xml = xml.slice(0, j) + xml.slice(k + 19); }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw Error('XML');
  const root = doc.documentElement;
  const store = kids(root, 'store')[0], sl = store ? leaf(store) : {};
  const sections = [...kids(root, 'section'), ...kids(kids(root, 'sections')[0], 'section')].map((s) => { const Lf = leaf(s); return { x: Nn(Lf.X), y: Nn(Lf.Y), z: Nn(Lf.Z), w: Nn(Lf.Width), h: Nn(Lf.Height), d: Nn(Lf.Depth), name: Lf.Name || Lf.ID || '' }; });
  const fixtures = kids(kids(root, 'fixtures')[0], 'fixture').map((fe) => {
    const Lf = leaf(fe);
    return {
      id: fe.getAttribute('id') || '', type: fe.getAttribute('type') || '', name: Lf.Name || '', x: Nn(Lf.X), y: Nn(Lf.Y), z: Nn(Lf.Z), w: Nn(Lf.Width), h: Nn(Lf.Height), d: Nn(Lf.Depth), comb: Nn(Lf.Combine),
      positions: kids(kids(fe, 'positions')[0], 'position').map((pe) => { const P = leaf(pe); return { pid: P.ProdPos || '', x: Nn(P.X), y: Nn(P.Y), z: Nn(P.Z), hs: Nn(P.HorizSpace), vs: Nn(P.VertSpace), ds: Nn(P.DepthSpace), hf: Nn(P.Horizontal), vf: Nn(P.Vertical), df: Nn(P.DepthFacings), units: Nn(P.TotalUnits), orient: Nn(P.Orientation) }; }),
    };
  });
  const labels = kids(kids(root, 'decorativeitems')[0], 'decorativeitem').map((d) => { const Lf = leaf(d); return { text: (Lf.Text || '').trim(), x: Nn(Lf.X), y: Nn(Lf.Y), w: Nn(Lf.Width), h: Nn(Lf.Height) }; }).filter((l) => l.text && l.text.length < 80);
  return { name: root.getAttribute('name') || 'Planogram', store: sl.Name || '', storeId: sl.ID || '', sections, fixtures, labels };
}

export interface PlnxFile { pogs: SmPog[]; products: Map<string, SmProduct>; scale: number; used: Set<string> }

export function parsePlanogramsXml(s: string): PlnxFile {
  const metric = !/<IsMetric>\s*False/i.test(s.slice(0, 3000));
  const cpEnd = s.indexOf('</commonproducts>'), parts: string[] = [];
  let i = Math.max(0, cpEnd);
  for (;;) { const a = s.indexOf('<planogram ', i); if (a < 0) break; const b = s.indexOf('</planogram>', a); if (b < 0) break; parts.push(s.slice(a, b + 12)); i = b + 12; }
  if (!parts.length) throw Error(L('file không có planogram', 'no planogram in file'));
  const pogs = parts.map(parsePlanogramXml), used = new Set<string>();
  pogs.forEach((p) => p.fixtures.forEach((f) => f.positions.forEach((x) => used.add(x.pid))));
  const products = new Map<string, SmProduct>(), re = /<commonproduct id="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (cpEnd > 0 && m.index > cpEnd) break;
    const id = xdec(m[1]), en = s.indexOf('</commonproduct>', m.index), blk = s.slice(m.index, en), o: SmProduct = {};
    for (const f of SM_PF) { const r = SM_RE[f].exec(blk); o[f] = r ? xdec(r[1]).trim() : ''; }
    products.set(id, o);
    re.lastIndex = en;
  }
  return { pogs, products, scale: metric ? 1 : 2.54, used };
}

export async function readPlnx(file: Blob | ArrayBuffer | Uint8Array): Promise<PlnxFile> {
  const ents = await unzipEntries(file);
  const e = ents.find((x) => /(^|\/)planograms\.xml$/i.test(x.name));
  if (!e) throw Error(L('không thấy planograms.xml – không phải file .plnx của Spaceman?', 'planograms.xml not found – not a Spaceman .plnx?'));
  const b = await e.get();
  return parsePlanogramsXml(new TextDecoder().decode(b!));
}

/** Spaceman's default size for an unmeasured product (4×6×2 cm) is not a real size. */
export const smPlaceholder = (p: SmProduct) => Nn(p.Width) === 4 && Nn(p.Height) === 6 && Nn(p.Depth) === 2;

export interface CatalogHooks { byId: (id: string) => Sku | undefined; applyPool: (k: Sku) => void }

export function smSku(id: string, p: SmProduct, k: number, hooks: CatalogHooks): Sku {
  const code = (p.Upc || id).trim(), name = p.Name || code, w = Nn(p.Width) * k, h = Nn(p.Height) * k, d = Nn(p.Depth) * k;
  const base = skuFromMaster({ code, name, brand: p.Brand, maker: p.Manufacturer, w, h, d, pack: p.DescL, ml: p.DescK || p.Size, pkg: p.DescI, cat: p.Category });
  base.sub = p.SubCategory || ''; base.seg = p.Segment || '';
  if (+p.UnitsCase > 0 && base.form !== 'unit') base.units = +p.UnitsCase;
  base.mov = Nn(p.RegMovement);
  base.attr = {};
  for (const f of ['SubSegment', 'Size', 'DescA', 'DescB', 'DescC', 'DescD', 'DescE', 'DescF', 'DescG', 'DescH', 'DescI', 'DescJ', 'DescK', 'DescL', 'String1', 'String2', 'String3', 'String4', 'String5']) if (p[f]) base.attr[f] = p[f];
  hooks.applyPool(base);
  const c = hooks.byId(base.id);
  if (c && c.faces) for (const [f, a] of Object.entries(c.faces)) if (!base.faces[f as keyof Sku['faces']]) base.faces[f as keyof Sku['faces']] = a;
  if (c) { base.priceNormal = c.priceNormal; base.pricePromo = c.pricePromo; base.pid = c.pid; }
  return base;
}

/** Every product of the file feeds the catalog: real sizes replace estimated (≈) ones, unknown codes are added. */
export function mergePlnxCatalog(catalog: Sku[], products: Map<string, SmProduct>, k: number, hooks: CatalogHooks) {
  let add = 0, fix = 0;
  const by = new Map(catalog.map((c) => [c.id, c]));
  for (const [id, p] of products) {
    if (!(Nn(p.Width) > 0 && Nn(p.Height) > 0 && Nn(p.Depth) > 0) || smPlaceholder(p)) continue;
    const sk = smSku(id, p, k, hooks), c = by.get(sk.id);
    if (!c) { catalog.push(sk); by.set(sk.id, sk); add++; continue; }
    if (c.est) { c.w = sk.w; c.h = sk.h; c.d = sk.d; delete c.est; if (!c.maker && sk.maker) c.maker = sk.maker; if (!c.brand && sk.brand) c.brand = sk.brand; fixForm(c); fix++; }
  }
  return { add, fix };
}

export interface PlnxBuildReport { positions: number; skus: number; fixtures: number; newSkus: Sku[] }

/** Build one design. Fixtures with products become 'shelf' objects (load-bearing); uprights/bases/back sections become 'struct'. */
export function buildFromPlnx(pog: SmPog, products: Map<string, SmProduct>, k: number, fname: string, hooks: CatalogHooks): { design: Design; rep: PlnxBuildReport } {
  const d = emptyShelfDesign(pog.name + (pog.store ? ' – ' + pog.store : ''));
  d.settings = { maxH: 200, overhang: 0, preset: 'custom', kind: 'shelf', sales: {}, src: { fmt: 'plnx', file: fname, store: pog.store, storeId: pog.storeId } };
  const rep = { positions: 0, skus: new Set<string>(), fixtures: 0, newSkus: [] as Sku[] };
  let maxY = 0;
  for (const s of pog.sections) {
    if (!(s.w > 0 && s.h > 0)) continue;
    d.objects.push({ id: uid('t'), type: 'struct', name: s.name || 'Section', size: { w: s.w * k, d: Math.max(0.5, s.d * k), h: s.h * k }, pos: { x: R2((s.x + s.w / 2) * k), y: R2(s.y * k), z: R2((s.z - Math.max(0.5, s.d) / 2) * k) }, ry: 0, lock: true, color: '#e4e8ee' });
    maxY = Math.max(maxY, (s.y + s.h) * k);
  }
  for (const f of pog.fixtures) {
    const has = f.positions.length > 0, isShelf = /shelf|pallet|chest|bar|rod/i.test(f.type);
    if (!has && !isShelf) {
      if (f.w > 0 && f.h > 0) d.objects.push({ id: uid('t'), type: 'struct', name: f.name || f.type, size: { w: f.w * k, d: Math.max(0.3, f.d * k), h: f.h * k }, pos: { x: R2((f.x + f.w / 2) * k), y: R2(f.y * k), z: R2((f.z + Math.max(0.3, f.d) / 2) * k) }, ry: 0, lock: true, color: f.type === 'notchbar' ? '#8b95a2' : '#c9d0d8' });
      continue;
    }
    rep.fixtures++;
    const onTop = /shelf|pallet|chest/i.test(f.type);
    const base = { id: uid('s'), name: f.name || f.id, size: { w: f.w * k, d: Math.max(1, f.d * k), h: Math.max(0.5, f.h * k) }, pos: { x: R2((f.x + f.w / 2) * k), y: R2(f.y * k), z: R2((f.z + f.d / 2) * k) }, ry: 0 };
    if (onTop) d.objects.push({ ...base, type: 'shelf', sm: { id: f.id, type: f.type, comb: f.comb } });
    else d.objects.push({ ...base, type: 'struct', color: '#b8c0ca', lock: true });
    for (const p of f.positions) {
      const pr = products.get(p.pid);
      if (!pr) continue;
      const sk = smSku(p.pid, pr, k, hooks);
      if (!hooks.byId(sk.id)) rep.newSkus.push(deep(sk));
      const ck = d.skus[sk.id] || (d.skus[sk.id] = sk);
      rep.skus.add(sk.id); rep.positions++;
      const H = Math.max(1, p.hf | 0), V = Math.max(1, p.vf | 0), Dp = Math.max(1, p.df | 0), cw = (p.hs * k) / H, cd = (p.ds * k) / Dp;
      const rot = Math.abs(cw - ck.d) + 0.01 < Math.abs(cw - ck.w) && Math.abs(cd - ck.w) < Math.abs(cd - ck.d) ? 90 : 0;
      const dims = skuDims(ck, rot);
      const gx = H > 1 ? Math.max(0, (p.hs * k - H * dims.w) / (H - 1)) : 0, gy = V > 1 ? Math.max(0, (p.vs * k - V * dims.h) / (V - 1)) : 0;
      const a: ArrayObj = { id: uid(), type: 'array', sku: ck.id, n: { x: H, y: V, z: Dp }, gap: { x: R2(Math.min(gx, 5)), y: R2(Math.min(gy, 5)), z: 0 }, shape: 'block', step: 1, cellRy: rot, ry: 0, anchor: { x: -1, z: 1 }, pos: { x: 0, y: 0, z: 0 }, sm: { fx: f.id, units: p.units, hs: p.hs * k } };
      const S = arraySizeWith(a, ck), x0 = (f.x + p.x) * k, y0 = ((onTop ? f.y + f.h : f.y) + p.y) * k, zf = (f.z + f.d) * k;
      a.pos = { x: R2(x0 + S.w / 2), y: R2(y0), z: R2(zf - S.d / 2) };
      d.objects.push(a);
      maxY = Math.max(maxY, y0 + S.h);
    }
  }
  d.settings.maxH = Math.ceil(maxY + 5);
  return { design: d, rep: { positions: rep.positions, skus: rep.skus.size, fixtures: rep.fixtures, newSkus: rep.newSkus } };
}
