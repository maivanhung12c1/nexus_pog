// User preferences (UI only, never inside a project): language, collision guard, snapping, own manufacturer.
import { create } from 'zustand';
import { setLang, type Lang } from '../domain/i18n';

export interface Prefs {
  lang: Lang;
  strict: boolean;        // block new collisions (legacy "Chặn va chạm")
  snapOn: boolean; grid: number; snapEdge: boolean; autoRest: boolean;
  carry: boolean;         // move what rides on a pallet / shelf / bay
  fillDepth: boolean;     // drop on shelf → facing block filling the depth
  palletFollow: boolean;  // products follow a pallet height change
  rotStep: number;
  ownMaker: string;       // focus manufacturer (SPVB by default)
  competitor: string;     // main competitor key for colours (KO by default)
  preparedBy: string;
  theme: 'system' | 'light' | 'dark';
}

const KEY = 'nexus:prefs';
const DEFAULTS: Prefs = { lang: 'vi', strict: true, snapOn: true, grid: 1, snapEdge: true, autoRest: true, carry: true, fillDepth: true, palletFollow: true, rotStep: 90, ownMaker: 'SPVB', competitor: 'KO', preparedBy: '', theme: 'system' };

function load(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}

/** The theme actually shown (for canvases that cannot use CSS variables). */
export const useResolvedTheme = create<{ dark: boolean }>(() => ({ dark: false }));
// ---- theme: 'system' follows the OS; data-theme on <html> forces light/dark ----
const mql = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export function applyTheme(t: Prefs['theme']) {
  if (typeof document === 'undefined') return;
  if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && !!mql?.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1012' : '#f5f7fa');
  useResolvedTheme.setState({ dark });
}

export const usePrefs = create<Prefs>(() => { const p = load(); setLang(p.lang); applyTheme(p.theme); return p; });
mql?.addEventListener?.('change', () => applyTheme(usePrefs.getState().theme));
export function setPref<K extends keyof Prefs>(k: K, v: Prefs[K]) {
  usePrefs.setState({ [k]: v } as Partial<Prefs>);
  if (k === 'lang') setLang(v as Lang);
  if (k === 'theme') applyTheme(v as Prefs['theme']);
  try { localStorage.setItem(KEY, JSON.stringify(usePrefs.getState())); } catch { /* private mode */ }
}
export const prefs = () => usePrefs.getState();
