// pdf.js adapter: text layer extraction + drawing measurement (legacy pdfTextPages / pdfImageBoxes / pogDrawingSizes /
// applyDrawingSizes). The drawing page is to scale: every shelf carries "chieu cao 96.00cm … 1/3", so a linear fit of label
// position vs. height gives cm per PDF unit; each facing is one picture standing on its shelf.
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { L } from '../../domain/i18n';
import { poolKey } from '../../domain/util';
import { parsePOGPages, pogShelfLabels, type Pog, type TextItem } from './pogParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDoc = Awaited<ReturnType<typeof pdfjsLib.getDocument>['promise']>;
export type Pages = TextItem[][] & { doc?: PdfDoc };

export async function pdfTextPages(file: Blob, onProg?: (i: number, n: number) => void): Promise<Pages> {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, pages: Pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const pg = await doc.getPage(i), tc = await pg.getTextContent();
    pages.push(tc.items.filter((it): it is Extract<typeof it, { str: string }> => 'str' in it).map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width, fs: Math.hypot(it.transform[2], it.transform[3]) || it.height || 5 })));
    onProg?.(i, doc.numPages);
  }
  pages.doc = doc;
  return pages;
}

export async function readPOGFile(file: Blob, onProg?: (i: number, n: number) => void) {
  const pages = await pdfTextPages(file, onProg);
  const pogs = parsePOGPages(pages) as Pog[] & { pages?: Pages };
  pogs.pages = pages;
  if (!pogs.length) throw Error(L('không tìm thấy danh sách sản phẩm (Fixel_ID…) trong PDF – có thể PDF chỉ là ảnh', 'no product list (Fixel_ID…) found – the PDF may be image-only'));
  return pogs;
}

async function pdfImageBoxes(page: Awaited<ReturnType<PdfDoc['getPage']>>) {
  const ops = await page.getOperatorList(), O = pdfjsLib.OPS, out: { x0: number; x1: number; y0: number; y1: number }[] = [];
  let m = [1, 0, 0, 1, 0, 0];
  const st: number[][] = [];
  const mul = (a: number[], b: number[]) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i];
    if (f === O.save) st.push(m);
    else if (f === O.restore) m = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (f === O.transform) m = mul(m, a);
    else if (f === O.paintFormXObjectBegin) { st.push(m); if (a && a[0]) m = mul(m, a[0]); }
    else if (f === O.paintFormXObjectEnd) m = st.pop() || [1, 0, 0, 1, 0, 0];
    else if (f === O.paintImageXObject || f === O.paintInlineImageXObject || f === O.paintImageXObjectRepeat) {
      const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
      out.push({ x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) });
    }
  }
  return out;
}

export interface DrawingSize { code: string; name: string; w: number; h: number; stack: number; box: { x0: number; x1: number; y0: number; y1: number }; img?: string }

export async function pogDrawingSizes(pogs: Pog[] & { pages?: Pages }, onProg?: (s: string) => void): Promise<Map<string, DrawingSize>> {
  const res = new Map<string, DrawingSize>(), pagesText = pogs.pages, doc = pagesText?.doc;
  if (!doc || !pagesText) return res;
  // the drawing page = the page with the most shelf labels
  let best = -1, bl: ReturnType<typeof pogShelfLabels> = [];
  for (let i = 0; i < pagesText.length; i++) { const ls = pogShelfLabels(pagesText[i]); const n = new Set(ls.map((l) => l.bay + '/' + l.shelf)).size; if (n > (bl.length ? new Set(bl.map((l) => l.bay + '/' + l.shelf)).size : 0)) { best = i; bl = ls; } }
  if (best < 0 || bl.length < 2) return res;
  const p0 = pogs[0];
  if (!p0) return res;
  const page = await doc.getPage(best + 1), imgs = await pdfImageBoxes(page);
  onProg?.(L('đang đo bản vẽ', 'measuring the drawing'));
  const lab = new Map<string, (typeof bl)[number]>();
  for (const l of bl) { const k = l.bay + '/' + l.shelf; if (!lab.has(k)) lab.set(k, l); }
  const labels = [...lab.values()];
  // cm per PDF unit, per bay (least squares of label y vs height); fallback: median of the others
  const kOf: Record<number, number> = {};
  for (const b of new Set(labels.map((l) => l.bay))) {
    const L0 = labels.filter((l) => l.bay === b);
    if (L0.length < 2) continue;
    const mx = L0.reduce((a, l) => a + l.cm, 0) / L0.length, my = L0.reduce((a, l) => a + l.y, 0) / L0.length;
    let sxy = 0, sxx = 0;
    for (const l of L0) { sxy += (l.cm - mx) * (l.y - my); sxx += (l.cm - mx) ** 2; }
    if (sxx > 0 && sxy > 0) kOf[b] = sxx / sxy;
  }
  const ks = Object.values(kOf).sort((a, b) => a - b), kMed = ks.length ? ks[ks.length >> 1] : 0;
  if (!kMed) return res;
  const flowRtl = p0.flow === 'rtl', rowsBy = new Map<string, Pog['rows']>();
  for (const r of p0.rows) { const k = r.bay + '/' + r.shelf; if (!rowsBy.has(k)) rowsBy.set(k, []); rowsBy.get(k)!.push(r); }
  const crops: DrawingSize[] = [];
  for (const l of labels) {
    const rows = rowsBy.get(l.bay + '/' + l.shelf);
    if (!rows || !rows.length) continue;
    const k = kOf[l.bay] || kMed, surf = l.y + l.fs * 0.95;
    const above = labels.filter((u) => u.bay === l.bay && u.y > l.y + 2).map((u) => u.y).sort((a, b) => a - b)[0] ?? Infinity;
    const prevX1 = Math.max(-Infinity, ...labels.filter((u) => u !== l && Math.abs(u.y - l.y) < 3 && u.x1 <= l.x0 + 1).map((u) => u.x1)), left = Math.max(l.x0 - (l.ch ? 3 : 12), prevX1);
    const mine = imgs.filter((b) => { const cx = (b.x0 + b.x1) / 2; return cx >= left && cx <= l.x1 && b.y0 >= surf - 6 && b.y1 <= above + 2 && b.x1 - b.x0 > 1 && b.y1 - b.y0 > 1; }).sort((a, b) => a.x0 - b.x0 || a.y0 - b.y0);
    const cols: { x0: number; w: number; h: number; bot: number; n: number; imgs: typeof mine }[] = [];
    for (const b of mine) { const c = cols[cols.length - 1]; if (c && Math.abs(c.x0 - b.x0) < 1) { c.n++; c.h = Math.max(c.h, b.y1 - b.y0); c.bot = Math.min(c.bot, b.y0); c.imgs.push(b); continue; } cols.push({ x0: b.x0, w: b.x1 - b.x0, h: b.y1 - b.y0, bot: b.y0, n: 1, imgs: [b] }); }
    const C = cols.filter((c) => c.bot <= surf + 6), R = [...rows].sort((a, b) => (flowRtl ? b.pos - a.pos : a.pos - b.pos)), F = R.reduce((a, r) => a + r.facings, 0);
    if (C.length !== F) continue;
    let i = 0;
    for (const r of R) {
      const cs = C.slice(i, i + r.facings);
      i += r.facings;
      const w = (cs.reduce((a, c) => a + c.w, 0) / cs.length) * k, h = Math.max(...cs.map((c) => c.h)) * k;
      if (!(w > 0.5 && h > 0.5)) continue;
      const key = poolKey(r.code);
      if (!res.has(key)) { const e = { code: r.code, name: r.name, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, stack: Math.max(...cs.map((c) => c.n)), box: cs[0].imgs[0] }; res.set(key, e); crops.push(e); }
    }
  }
  if (crops.length && typeof document !== 'undefined') {
    try {
      onProg?.(L('đang cắt hình sản phẩm', 'cutting product pictures'));
      const [, , vw, vh] = page.view, sc = Math.min(4, 3000 / Math.max(vw, vh)), vp = page.getViewport({ scale: sc }), cv = document.createElement('canvas');
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
      await page.render({ canvasContext: cv.getContext('2d')!, viewport: vp }).promise;
      for (const e of crops) {
        const b = e.box, [x0, y0, x1, y1] = vp.convertToViewportRectangle([b.x0, b.y0, b.x1, b.y1]), X = Math.min(x0, x1), Y = Math.min(y0, y1), W = Math.abs(x1 - x0), H = Math.abs(y1 - y0);
        if (W < 4 || H < 4) continue;
        const c = document.createElement('canvas');
        c.width = Math.round(W); c.height = Math.round(H);
        c.getContext('2d')!.drawImage(cv, X, Y, W, H, 0, 0, c.width, c.height);
        e.img = c.toDataURL('image/jpeg', 0.88);
      }
    } catch (err) { console.warn('crop', err); }
  }
  return res;
}
