// Product colours (legacy `colorFor`): brand rules first, then a stable hash into the palette.
export const PALETTE = ['#f0b52f', '#25a2a2', '#e55e67', '#7569cb', '#5aa04a', '#e0842f', '#3a7bd5', '#c75b9b', '#a07c3b', '#2f9e8f', '#d4c22a', '#8f5bd6'];
const BRAND_COLORS: [RegExp, string][] = [
  [/PEPSI/, '#1f4fa3'], [/7 ?UP|REVIVE/, '#2f9e4f'], [/MIRINDA/, '#f28a1e'], [/TEA\+|OOLONG|OLONG/, '#c9b21c'],
  [/LIPTON/, '#f2c230'], [/STING/, '#d62839'], [/AQUAFINA/, '#4aa3df'], [/ROCK ?STAR/, '#2b2b2b'], [/BOSS/, '#6b4a2e'],
  [/TWISTER/, '#ff8c1a'], [/MOUNTAIN|DEW/, '#7cc242'], [/SCHWEPPES/, '#e9c46a'],
];
export function colorFor(name: unknown, brand?: unknown) {
  const s = (String(brand || '') + ' ' + String(name || '')).toUpperCase();
  for (const [re, c] of BRAND_COLORS) if (re.test(s)) return c;
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}
export function lum(hex: string) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
export function shade(hex: string, f: number) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  return '#' + [16, 8, 0].map((k) => Math.min(255, Math.max(0, Math.round(((n >> k) & 255) * f))).toString(16).padStart(2, '0')).join('');
}
