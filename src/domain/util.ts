// Small helpers ported verbatim from the legacy core (R1/R2/clamp/norm/uid/deep/poolKey/slug/toNum/fmt).

export const EPS = 1e-6;
export const R2 = (v: number) => Math.round(v * 100) / 100;
export const R1 = (v: number) => Math.round(v * 10) / 10;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const deep = <T>(o: T): T => JSON.parse(JSON.stringify(o));

/** Lower-case, strip Vietnamese diacritics, trim (legacy `norm`). */
export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();

let uidN = 0;
export const uid = (p = 'o') =>
  p + Date.now().toString(36).slice(-5) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);

/** Product code key: trimmed, leading zeros dropped (image pool, sales, PDF matching). */
export const poolKey = (c: unknown) => String(c ?? '').trim().replace(/^0+(?=\d)/, '');

export const slug = (s: unknown) =>
  norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'display';

/** Number from a spreadsheet cell: "1.234,5" style commas handled like legacy `toNum`. */
export const toNum = (v: unknown) => {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function hashStr(s: string) {
  let h1 = 0x811c9dc5, h2 = 0x1234567;
  const n = s.length, step = n > 200000 ? Math.ceil(n / 200000) : 1;
  for (let i = 0; i < n; i += step) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + n.toString(36);
}
