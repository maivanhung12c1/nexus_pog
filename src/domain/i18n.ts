// Language for domain messages (warnings, reports). The legacy app used L(vi, en) inline everywhere; the domain keeps
// that form so messages port unchanged, and the UI switches the language here.

export type Lang = 'vi' | 'en';
let lang: Lang = 'vi';
export const setLang = (l: Lang) => { lang = l; };
export const getLang = () => lang;
export const L = (vi: string, en: string) => (lang === 'en' ? en : vi);

/** Legacy `fmt`: locale number with up to d decimals. */
export const fmt = (v: unknown, d = 1) =>
  Number(v || 0).toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN', { maximumFractionDigits: d });

export const FORM_LABEL: Record<string, [string, string]> = {
  carton: ['Thùng', 'Carton'],
  pack: ['Lốc/khay', 'Pack/tray'],
  unit: ['Lon/chai lẻ', 'Single unit'],
};
export const formLabel = (f: string) => { const e = FORM_LABEL[f]; return e ? L(e[0], e[1]) : f; };
