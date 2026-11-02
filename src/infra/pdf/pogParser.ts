// POG PDF parser (text layer only) — pure functions, ported verbatim from legacy pogLines / parsePOGPages /
// pogMetaLines / pogShelfLabels / pogDefaults / buildFromPOG.
// pages: [[{s, x, y, w, fs}]] (PDF units, y grows upward).
import { fillBrand, skuFromMaster, type BrandEntry } from '../../domain/catalog/sku';
import { emptyShelfDesign } from '../../domain/design';
import { fmt, L } from '../../domain/i18n';
import type { Design, FixtureObj, ShelfObj, Sku } from '../../domain/types';
import { deep, poolKey, R2, uid } from '../../domain/util';

export interface TextItem { s: string; x: number; y: number; w?: number; fs?: number }
export interface Line { y: number; c: TextItem[]; t: string }
export interface PogRow { bay: number; shelf: number; pos: number; pid?: string; code: string; name: string; maker: string; facings: number; capacity: number; stt?: number }
export interface Pog { title: string; store: string; rows: PogRow[]; fmt: 'go' | 'lotte' | ''; codeX?: number; heights: Record<number, Record<number, number>>; flow: 'ltr' | 'rtl' | null }

export function pogLines(items: TextItem[]): Line[] {
  const its = items.filter((i) => i.s && i.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x), lines: Line[] = [];
  for (const it of its) { let Ln = lines.find((l) => Math.abs(l.y - it.y) < 2.5); if (!Ln) { Ln = { y: it.y, c: [], t: '' }; lines.push(Ln); } Ln.c.push(it); }
  for (const Ln of lines) { Ln.c.sort((a, b) => a.x - b.x); Ln.t = Ln.c.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim(); }
  return lines.sort((a, b) => b.y - a.y);
}

/** GO! drawing pages: "chieu cao 1.62m … 1/5" = height of shelf 5 in bay 1 (cm from the floor); "<=====" / "=====>" = customer flow. */
export function pogMetaLines(lines: Line[], meta: { heights: Record<number, Record<number, number>>; flow: 'ltr' | 'rtl' | null }) {
  for (const l of lines) {
    const t = l.t;
    if (/<\s*={4,}/.test(t)) meta.flow = meta.flow || 'rtl';
    else if (/={4,}\s*>/.test(t)) meta.flow = meta.flow || 'ltr';
    const re = /chieu\s*cao\s*([\d.,]+)\s*(cm|m)\b(.*?)(\d+)\s*\/\s*(\d+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const v = parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'm' ? 100 : 1), b = +m[4], sh = +m[5];
      if (v > 0 && v < 400) (meta.heights[b] = meta.heights[b] || {})[sh] = Math.round(v * 10) / 10;
      re.lastIndex = m.index + m[0].length - (m[4] + '/' + m[5]).length + 1;
    }
  }
}

export function parsePOGPages(pages: TextItem[][]): Pog[] {
  const pogs = new Map<string, Pog>();
  let cur: Pog | null = null;
  const meta: { heights: Record<number, Record<number, number>>; flow: 'ltr' | 'rtl' | null } = { heights: {}, flow: null };
  const get = (title: string): Pog => { let p: Pog | undefined = pogs.get(title); if (!p) { p = { title, store: '', rows: [], fmt: '', heights: {}, flow: null }; pogs.set(title, p); } return p; };
  for (const items of pages) {
    const lines = pogLines(items);
    if (!lines.length) continue;
    const head = lines.find((l) => /Fixel_ID/i.test(l.t));
    if (!head) pogMetaLines(lines, meta);
    // GO!/mini go (JDA Space Planning report): Fixel_ID Location_ID Product_ID UPC Name Total_Facings Capacity
    const goRow = (l: Line) => l.t.match(/^(\d+)\s*\/\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d{6,14})\s+(.+?)\s+(\d+)(?:\s+(\d+))?$/);
    if ((head && /Location_ID/i.test(head.t)) || (cur && cur.fmt === 'go' && lines.some(goRow))) {
      let p: Pog | null = cur;
      if (head && !(cur && cur.fmt === 'go' && !lines.some((l) => /\.plnx\b/i.test(l.t)) && !/Product List/i.test(lines.map((l) => l.t).join(' ')))) {
        const pi = lines.findIndex((l) => /\.plnx\b/i.test(l.t)), pl = pi < 0 ? '' : lines[pi].t, pl0 = pi > 0 && !/Product List|PLANOGRAM|\d{4}/i.test(lines[pi - 1].t) ? lines[pi - 1].t + ' ' : '';
        const title = (pl ? (pl0 + pl).replace(/\s+/g, ' ').replace(/\.plnx\b.*$/i, '').trim() : lines[0].t.replace(/Page.*$/, '').trim()) || 'PLANOGRAM';
        p = get(title); p.fmt = 'go'; cur = p;
      }
      // the Fixel_ID cell is sometimes printed a few points off the row baseline – glue it back to the nearest row
      const fxOnly = lines.filter((l) => /^\d+\s*\/\s*\d+$/.test(l.t)), noFx = /^(\d+)\s+(\S+)\s+(\d{6,14})\s+(.+?)\s+(\d+)(?:\s+(\d+))?$/;
      for (const l of lines) { if (goRow(l) || !noFx.test(l.t)) continue; let best: Line | null = null, bd = 9; for (const f of fxOnly) { const d = Math.abs(f.y - l.y); if (d < bd) { bd = d; best = f; } } if (best) l.t = best.t.replace(/\s+/g, '') + ' ' + l.t; }
      for (const l of lines) { const m = goRow(l); if (m && p) p.rows.push({ bay: +m[1], shelf: +m[2], pos: +m[3], pid: m[4], code: m[5], name: m[6].trim(), maker: '', facings: +m[7], capacity: m[8] ? +m[8] : 0 }); }
      continue;
    }
    // Lotte Mart: STT Sale.code Name Manufacturer Facing Wobbler-Exp, grouped under "Fixel_ID 1/1"
    const hdr = lines.find((l) => /Sale\.?code/i.test(l.t) && /Manufacturer/i.test(l.t));
    if (hdr) {
      const col = (n: string) => { const c = hdr.c.find((x) => new RegExp(n, 'i').test(x.s)); return c ? c.x : null; };
      const xStt = col('STT') ?? hdr.c[0].x, xName = col('^Name')!, xMaker = col('Manufacturer')!, xFace = col('Facing')!, cutNM = (xName + xMaker) / 2, cutMF = xFace - 15;
      const tl = lines.find((l) => /PLANOGRAM/i.test(l.t)), st = lines.find((l) => /STORE:/i.test(l.t));
      const store = st ? st.c.map((c) => c.s).join(' ').replace(/.*STORE:\s*/i, '').trim() : '';
      const title = (tl ? tl.c.map((c) => c.s).join(' ').replace(/STORE:.*?(?=PLANOGRAM)/i, '').replace(/DATE:.*/i, '').replace(/LOTTE\s*MART/i, '').replace(/\s+/g, ' ').trim() || 'PLANOGRAM' : 'PLANOGRAM') + (store ? ' – ' + store : '');
      const p = get(title);
      p.fmt = 'lotte'; p.store = store;
      let fx: { bay: number; shelf: number } | null = null, last: PogRow | null = null;
      for (const l of lines) {
        if (l.y >= hdr.y - 1) continue;
        const cells = l.c.filter((c) => c.x >= xStt - 12);
        if (!cells.length) continue;
        const t = cells.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
        const f = t.match(/Fixel_ID\s*(\d+)\s*\/\s*(\d+)/i);
        if (f) { fx = { bay: +f[1], shelf: +f[2] }; last = null; continue; }
        if (!fx || /^Page\s/i.test(t)) continue;
        const m = t.match(/^(\d{1,3})\s+(\d{6,14})([A-Z]?)\b/);
        const cc = cells.find((c) => /^\d{6,14}[A-Z]?$/.test(c.s.trim()));
        if (m && cc) p.codeX = cc.x;
        const cx = (p.codeX || xStt + 20) + 45;
        const nm = cells.filter((c) => c.x >= cx && c.x < cutNM).map((c) => c.s).join(' ').trim(), mk = cells.filter((c) => c.x >= cutNM && c.x < cutMF).map((c) => c.s).join(' ').trim();
        if (m) {
          const fc = cells.filter((c) => c.x >= cutMF).map((c) => c.s.trim()).find((s) => /^\d{1,3}$/.test(s));
          const fxx = fx;
          last = { bay: fxx.bay, shelf: fxx.shelf, pos: p.rows.filter((r) => r.bay === fxx.bay && r.shelf === fxx.shelf).length + 1, code: m[2] + m[3], name: nm, maker: mk, facings: fc ? +fc : 1, capacity: 0, stt: +m[1] };
          p.rows.push(last);
        } else if (last) { if (nm) last.name = (last.name + ' ' + nm).trim(); if (mk && !last.maker.includes(mk)) last.maker = (last.maker + ' ' + mk).trim(); }
      }
    }
  }
  const out = [...pogs.values()].filter((p) => p.rows.length);
  for (const p of out) { p.heights = meta.heights; p.flow = meta.flow; }
  return out;
}

/** Labels on one drawing page: "<height>(cm|m) … b/s" on one line → {bay, shelf, cm, x0, x1, y, fs}. */
export function pogShelfLabels(items: TextItem[]) {
  const lines = pogLines(items), out: { bay: number; shelf: number; cm: number; ch: boolean; x0: number; x1: number; y: number; fs: number }[] = [], HRE = /(\d+(?:[.,]\d+)?)\s*(cm|m)\b/gi;
  for (const l of lines) {
    const c = l.c;
    for (let i = 0; i < c.length; i++) {
      const t = c[i].s, m = /(\d+)\s*\/\s*(\d+)\s*$/.exec(t.trim());
      if (!m) continue;
      let h: { v: number; x: number; fs: number } | null = null;
      for (let j = i; j >= 0 && !h; j--) {
        let s0 = c[j].s;
        if (j === i) s0 = s0.slice(0, s0.lastIndexOf(m[0].trim()));
        let mm: RegExpExecArray | null, last: RegExpExecArray | null = null;
        HRE.lastIndex = 0;
        while ((mm = HRE.exec(s0))) last = mm;
        if (last) h = { v: parseFloat(last[1].replace(',', '.')) * (last[2].toLowerCase() === 'm' ? 100 : 1), x: c[j].x, fs: c[j].fs || 5 };
      }
      if (!h || !(h.v > 0 && h.v < 400)) continue;
      const left = c.slice(0, i + 1).reverse().find((q) => /chieu/i.test(q.s) && q.x <= h!.x + 1);
      out.push({ bay: +m[1], shelf: +m[2], cm: h.v, ch: !!left, x0: left ? left.x : h.x, x1: c[i].x + (c[i].w || 10), y: l.y, fs: h.fs });
    }
  }
  return out;
}

// ---------------- build a shelf design from a parsed POG ----------------
export interface PogOptions { bayW: number; h: number; d: number; baseD: number; kick: number; pitch: number; t: number; shelfFrom: 'top' | 'bottom'; posFrom: 'left' | 'right'; bayFrom: 'left' | 'right'; useH: boolean; autoW: boolean }

/** GO!/mini go number shelves from the bottom and positions from the right; Lotte from the top and from the left. */
export function pogDefaults(p: Pog): PogOptions {
  return { bayW: 120, h: 200, d: 45, baseD: 55, kick: 12, pitch: 2.5, t: 2.5, shelfFrom: p.fmt === 'lotte' ? 'top' : 'bottom', posFrom: p.flow === 'ltr' ? 'left' : p.fmt === 'go' ? 'right' : 'left', bayFrom: p.flow === 'rtl' ? 'right' : 'left', useH: !!(p.heights && Object.keys(p.heights).length), autoW: true };
}

export interface PogHooks { findByCode: (key: string) => Sku | undefined; addToCatalog: (k: Sku) => void; brandIdx: BrandEntry[]; applyPool: (k: Sku) => void }
export interface PogReport { matched: number; newSkus: Sku[]; overflow: string[]; widened: string[]; rows: number; drawing?: { dims: number; pics: number } }

function pogSku(r: PogRow, rep: PogReport, hooks: PogHooks) {
  const key = poolKey(r.code);
  let k = hooks.findByCode(key);
  if (!k) { k = skuFromMaster({ code: r.code, name: r.name, brand: '', maker: r.maker || '', pack: '', ml: '' }); k.src = 'POG'; fillBrand(hooks.brandIdx, k); hooks.addToCatalog(k); rep.newSkus.push(k); }
  else rep.matched++;
  return k;
}

/** Shelf heights: each shelf gets the tallest product on the shelf below + 4 cm clearance (snapped to the notch pitch);
 *  heights printed on the POG win. */
export function buildFromPOG(p: Pog, o: PogOptions, hooks: PogHooks): { design: Design; rep: PogReport } {
  const rep: PogReport = { matched: 0, newSkus: [], overflow: [], widened: [], rows: p.rows.length };
  const d = emptyShelfDesign(p.title);
  d.settings = { maxH: o.h, overhang: 0, preset: 'custom', kind: 'shelf', sales: {}, src: { title: p.title, fmt: p.fmt }, flow: p.flow || '' };
  const bays = [...new Set(p.rows.map((r) => r.bay))].sort((a, b) => (o.bayFrom === 'right' ? b - a : a - b));
  let x0 = 0;
  const HS = (o.useH && p.heights) || {};
  for (const bay of bays) {
    const rows = p.rows.filter((r) => r.bay === bay), ns = Math.max(...rows.map((r) => r.shelf));
    const sh: { n: number; items: { r: PogRow; k: Sku }[]; need: number; hmax: number }[] = [];
    for (let i = 1; i <= ns; i++) {
      const it = rows.filter((r) => r.shelf === i).sort((a, b) => a.pos - b.pos);
      const ks = it.map((r) => ({ r, k: pogSku(r, rep, hooks) }));
      sh.push({ n: i, items: ks, need: ks.reduce((a, e) => a + e.r.facings * e.k.w, 0), hmax: Math.max(0, ...ks.map((e) => e.k.h)) });
    }
    if (HS[bay]) for (let i = sh.length - 1; i >= 0; i--) if (!sh[i].items.length && !HS[bay][sh[i].n]) sh.splice(i, 1); // an empty shelf the POG does not draw
    const W = o.autoW ? Math.max(o.bayW, Math.ceil(Math.max(...sh.map((s) => s.need)) / 5) * 5) : o.bayW;
    if (W > o.bayW) rep.widened.push(`Bay ${bay}: ${o.bayW} → ${W} cm (${L('kệ cần nhiều nhất', 'widest shelf')} ${fmt(Math.max(...sh.map((s) => s.need)))} cm)`);
    const order = o.shelfFrom === 'top' ? [...sh].reverse() : sh; // bottom → top
    const panel = 2, D0 = o.baseD + panel;
    const fx: FixtureObj = { id: uid('f'), type: 'fixture', name: 'Bay ' + bay, size: { w: W, d: D0, h: o.h }, pos: { x: R2(x0 + W / 2), y: 0, z: R2(D0 / 2) }, ry: 0, lock: true, fx: { pitch: o.pitch, panel, kick: o.kick } };
    d.objects.push(fx);
    let top = o.kick;
    order.forEach((s, i) => {
      if (i > 0) { const prev = order[i - 1]; top = o.kick + Math.ceil((top - o.kick + prev.hmax + 4 + o.t) / o.pitch) * o.pitch; }
      const hs = HS[bay] && HS[bay][s.n];
      if (hs > 0) top = hs; // shelf height printed on the POG wins
      const depth = i === 0 ? o.baseD : o.d;
      const so: ShelfObj = { id: uid('s'), type: 'shelf', name: L('Kệ ', 'Shelf ') + bay + '/' + s.n, fixture: fx.id, size: { w: W, d: depth, h: o.t }, pos: { x: R2(x0 + W / 2), y: R2(top - o.t), z: R2(panel + depth / 2) }, ry: 0 };
      d.objects.push(so);
      if (s.need > W + 0.5) rep.overflow.push(`${bay}/${s.n}: ${fmt(s.need)} > ${fmt(W)} cm`);
      let x = o.posFrom === 'right' ? x0 + W : x0;
      for (const e of s.items) {
        const k = e.k;
        d.skus[k.id] = deep(k);
        hooks.applyPool(d.skus[k.id]);
        const per = e.r.capacity > 0 ? Math.round(e.r.capacity / Math.max(1, e.r.facings)) : 0, maxZ = Math.max(1, Math.floor(depth / k.d));
        const nz = per > 0 ? Math.min(per, maxZ) : maxZ, ny = per > maxZ ? Math.max(1, Math.round(per / maxZ)) : 1;
        const w = e.r.facings * k.w, bx = o.posFrom === 'right' ? x - w : x;
        d.objects.push({ id: uid(), type: 'array', sku: k.id, n: { x: e.r.facings, y: ny, z: nz }, gap: { x: 0, y: 0, z: 0 }, shape: 'block', step: 1, cellRy: 0, ry: 0, anchor: { x: o.posFrom === 'right' ? 1 : -1, z: 1 }, pos: { x: R2(bx + w / 2), y: R2(top), z: R2(panel + depth - (nz * k.d) / 2) }, pog: { bay, shelf: s.n, pos: e.r.pos, capacity: e.r.capacity || null } });
        x = o.posFrom === 'right' ? x - w : x + w;
      }
    });
    const lastS = order[order.length - 1];
    if (top + (lastS ? lastS.hmax : 0) > o.h) { fx.size.h = Math.ceil(top + lastS.hmax + 5); rep.overflow.push(`Bay ${bay}: ${L('cao hơn', 'taller than')} ${o.h} cm → ${fx.size.h} cm`); }
    x0 += W;
  }
  d.settings.maxH = Math.max(o.h, ...d.objects.filter((q): q is FixtureObj => q.type === 'fixture').map((q) => q.size.h));
  return { design: d, rep };
}
