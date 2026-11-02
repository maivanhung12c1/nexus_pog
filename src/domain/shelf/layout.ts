// Bays / shelves / positions of a shelf design (legacy plnxModel). Used by the .plnx writer, the preflight and Auto POG.
import { fmt, L } from '../i18n';
import { isStock, type Scene } from '../scene';
import type { Box, FixtureObj, SceneObject, ShelfObj, StockObj, Warning } from '../types';
import { unionBox, ov1 } from '../geometry';
import { shelfUnder } from './gondola';

export interface LayoutShelf { s: ShelfObj; b: Box; fixel: string; items: { o: StockObj; b: Box }[] }
export interface LayoutBay {
  o: FixtureObj | { name: string; id: string; type?: undefined };
  b: Box; panel: number; kick: number; pitch: number; ids?: Set<string>;
  num: number; seg: number; shelves: LayoutShelf[];
}
export interface Layout { bays: LayoutBay[]; X0: number; H: number; loose: number; sb: Box }

export function shelfLayout(s: Scene): Layout | null {
  const D = s.d;
  const shelves = D.objects.filter((o): o is ShelfObj => o.type === 'shelf' && !o.hidden);
  if (!shelves.length) return null;
  const sb = unionBox(shelves.map((o) => s.aabb(o)))!;
  let bays: LayoutBay[] = D.objects.filter((o): o is FixtureObj => o.type === 'fixture').map((o) => ({ o, b: s.aabb(o), panel: (o.fx && o.fx.panel) || 2, kick: (o.fx && o.fx.kick) || 0, pitch: (o.fx && o.fx.pitch) || 3, num: 0, seg: 0, shelves: [] }));
  if (!bays.length) {
    // no gondola (e.g. a design read from a .plnx): bays = groups of shelves sharing the same x-range
    const s0 = D.objects.filter((o) => o.type === 'struct'), ub = s0.length ? unionBox([sb, ...s0.map((o) => s.aabb(o))])! : sb, grp = new Map<string, { s: ShelfObj; b: Box }[]>();
    for (const x of shelves) { const b = s.aabb(x), key = Math.round(b.x0 / 2) + '|' + Math.round(b.x1 / 2); if (!grp.has(key)) grp.set(key, []); grp.get(key)!.push({ s: x, b }); }
    bays = [...grp.values()].sort((a, b) => a[0].b.x0 - b[0].b.x0).map((g, i) => {
      const x0 = Math.min(...g.map((e) => e.b.x0)), x1 = Math.max(...g.map((e) => e.b.x1));
      const m = /^(\d+)\s*\//.exec((g[0].s.sm && g[0].s.sm.id) || '');
      return { o: { name: 'Bay ' + (m ? m[1] : i + 1), id: '_v' + i }, b: { x0, x1, y0: ub.y0, y1: ub.y1, z0: sb.z0, z1: sb.z1 }, panel: 0, kick: 0, pitch: 3, ids: new Set(g.map((e) => e.s.id)), num: 0, seg: 0, shelves: [] };
    });
  }
  bays.sort((a, b) => a.b.x0 - b.b.x0);
  const X0 = Math.min(bays[0].b.x0, sb.x0);
  bays.forEach((y, i) => { const m = /(\d+)\s*$/.exec(y.o.name || ''); y.num = m ? +m[1] : i + 1; y.seg = i + 1; y.shelves = []; });
  if (new Set(bays.map((y) => y.num)).size !== bays.length) bays.forEach((y, i) => (y.num = i + 1));
  const stock = D.objects.filter((o): o is StockObj => isStock(o) && !o.hidden), onShelf = new Map<string, StockObj[]>();
  let loose = 0;
  for (const o of stock) { const x = shelfUnder(s, o); if (!x) { loose++; continue; } if (!onShelf.has(x.id)) onShelf.set(x.id, []); onShelf.get(x.id)!.push(o); }
  for (const x of shelves) {
    const b = s.aabb(x), cx = (b.x0 + b.x1) / 2;
    let bay = (x.fixture && bays.find((y) => y.o.id === x.fixture)) || bays.find((y) => y.ids && y.ids.has(x.id));
    if (!bay) bay = bays.find((y) => cx >= y.b.x0 - 0.5 && cx <= y.b.x1 + 0.5) || bays[0];
    bay.shelves.push({ s: x, b, fixel: '', items: [] });
  }
  for (const y of bays) {
    y.shelves.sort((a, b) => a.b.y0 - b.b.y0);
    const named = y.shelves.map((e) => /(\d+)\s*\/\s*(\d+)/.exec(e.s.name || ''));
    const okNames = named.every((m) => m && +m[1] === y.num) && new Set(named.map((m) => m && m[2])).size === named.length;
    y.shelves.forEach((e, i) => {
      e.fixel = okNames ? `${y.num}/${+named[i]![2]}` : `${y.num}/${i + 1}`;
      e.items = (onShelf.get(e.s.id) || []).map((o) => ({ o, b: s.aabb(o) })).sort((a, b) => a.b.x0 - b.b.x0);
    });
  }
  const H = Math.max(...bays.map((y) => y.b.y1), sb.y1);
  return { bays, X0, H, loose, sb };
}

/** What would come out wrong in Spaceman (legacy plnxPreflight). */
export function plnxPreflight(s: Scene): Warning[] {
  const M = shelfLayout(s);
  if (!M) return [];
  const out: Warning[] = [], push = (level: Warning['level'], msg: string, ids: string[]) => out.push({ level, msg, ids });
  const loose = s.d.objects.filter((o) => isStock(o) && !o.hidden && !shelfUnder(s, o));
  if (loose.length) push('danger', L(`${loose.length} vật không nằm trên tấm kệ nào – sẽ không được xuất`, `${loose.length} objects stand on no shelf – not exported`), loose.map((o) => o.id));
  for (const y of M.bays) y.shelves.forEach((e, si) => {
    const b = e.b, up = y.shelves[si + 1];
    const over = e.items.filter((it) => it.b.x1 > b.x1 + 0.5 || it.b.x0 < b.x0 - 0.5);
    if (over.length) push('danger', L(`Kệ ${e.fixel}: hàng tràn ra ngoài tấm kệ (${fmt(Math.max(...over.map((it) => Math.max(it.b.x1 - b.x1, b.x0 - it.b.x0))))} cm)`, `Shelf ${e.fixel}: products run past the shelf end`), over.map((it) => it.o.id));
    if (up) { const tall = e.items.filter((it) => it.b.y1 > up.b.y0 + 0.3); if (tall.length) push('warn', L(`Kệ ${e.fixel}: ${tall.length} vị trí cao hơn khoảng trống tới kệ trên (${fmt(up.b.y0 - b.y1)} cm)`, `Shelf ${e.fixel}: ${tall.length} positions taller than the gap to the shelf above`), tall.map((it) => it.o.id)); }
    const deep = e.items.filter((it) => it.b.z1 - it.b.z0 > b.z1 - b.z0 + 0.5);
    if (deep.length) push('warn', L(`Kệ ${e.fixel}: ${deep.length} vị trí sâu hơn tấm kệ`, `Shelf ${e.fixel}: ${deep.length} positions deeper than the shelf`), deep.map((it) => it.o.id));
    for (let i = 1; i < e.items.length; i++) {
      const a = e.items[i - 1].b, c = e.items[i].b;
      if (a.x1 > c.x0 + 0.5 && ov1(a.z0, a.z1, c.z0, c.z1) > 0.5) { push('warn', L(`Kệ ${e.fixel}: 2 vị trí chồng lên nhau`, `Shelf ${e.fixel}: two positions overlap`), [e.items[i - 1].o.id, e.items[i].o.id]); break; }
    }
  });
  const usedIds = new Set(s.d.objects.filter(isStock).map((o) => o.sku));
  const est = [...usedIds].map((id) => s.d.skus[id]).filter((k) => k && k.est);
  if (est.length) push('info', L(`${est.length} SKU còn kích thước ước tính (≈)`, `${est.length} SKUs still have estimated sizes (≈)`), s.d.objects.filter((o) => isStock(o) && est.some((k) => k.id === o.sku)).map((o) => o.id));
  return out;
}

export const usedSkus = (s: Scene) => { const ids = new Set(s.d.objects.filter(isStock).map((o) => o.sku)); return [...ids].map((id) => s.d.skus[id]).filter(Boolean); };
export type { SceneObject };
