// Phiếu Dựng (build sheet) model. Legacy data model kept (D.sheet: prices / posm / tot / preparedBy / displayType) and
// extended: display-type registry, installer + checker names, master prices with project overrides, picking units.
import { computeBOM } from '../bom';
import { resolvePrice } from '../catalog/pricing';
import { L } from '../i18n';
import { displayType, GONDOLA_PRESETS, LEGACY_DISPLAY_IDS, PALLET_PRESETS } from '../presets';
import { Scene } from '../scene';
import { skuSummary } from '../analysis/spaceShare';
import type { Design, SheetData, Sku } from '../types';

export function defaultSheet(d: Design): SheetData {
  const base = d.settings.kind === 'shelf' ? 'ke' : 'u';
  return { displayType: base, preparedBy: d.meta.by || '', installer: '', checker: '', store: '', prices: {}, posm: displayType(base).posm.map((p) => ({ ...p })), tot: {} };
}

/** Normalise a legacy sheet (display ids 'ụ' / 'kệ' / 'ge'). */
export function normaliseSheet(sh: Partial<SheetData> | undefined, d: Design): SheetData {
  const def = defaultSheet(d);
  if (!sh) return def;
  const dt = LEGACY_DISPLAY_IDS[sh.displayType || ''] || sh.displayType || def.displayType;
  return { ...def, ...sh, displayType: dt, prices: sh.prices || {}, posm: Array.isArray(sh.posm) ? sh.posm : def.posm, tot: sh.tot || {} };
}

/** What the "Preset" badge shows (legacy read a field that never existed → always "—"). */
export function presetLabel(d: Design) {
  const p = PALLET_PRESETS[d.settings.preset];
  if (p) return p.name;
  const bays = d.objects.filter((o) => o.type === 'fixture');
  if (bays.length) {
    const ws = [...new Set(bays.map((b) => (b as { size: { w: number } }).size.w))];
    const h = Math.max(...bays.map((b) => (b as { size: { h: number } }).size.h));
    const g = Object.values(GONDOLA_PRESETS).find((x) => ws.length === 1 && x.w === ws[0] && x.h === h);
    return `${bays.length} bay × ${ws.join('/')} cm` + (g ? ` (${g.name})` : '');
  }
  return d.settings.kind === 'shelf' ? L('Kệ tuỳ chỉnh', 'Custom shelf') : '—';
}

export interface SheetLine { k: Sku; fac: number; lin: number; stk: number; units: number | null; priceNormal: number | null; pricePromo: number | null; priceSrc: string }
export interface SheetSummary { lines: SheetLine[]; totalFac: number; totalLin: number; skuCount: number; preset: string; displayLabel: string; tot: { k: Sku; buyQty?: number; giftQty?: number; item?: string }[] }

/** master: live master-data lookup — prices come from the catalog (the design keeps only a snapshot of the SKU). */
export function sheetSummary(d: Design, master?: (id: string) => Pick<Sku, 'priceNormal' | 'pricePromo'> | undefined): SheetSummary {
  const sh = normaliseSheet(d.sheet, d), bom = computeBOM(new Scene(d)), conv = new Map(bom.rows.map((r) => [r.k.id, r.conv]));
  const lines = skuSummary(d).map(({ k, fac, lin, stk }) => {
    const mk = master?.(k.id), p = resolvePrice(mk ? { ...k, priceNormal: mk.priceNormal ?? k.priceNormal, pricePromo: mk.pricePromo ?? k.pricePromo } : k, sh);
    return { k, fac, lin, stk, units: conv.get(k.id) ?? null, priceNormal: p.normal, pricePromo: p.promo, priceSrc: p.normalSrc };
  });
  const dt = displayType(sh.displayType);
  return {
    lines, totalFac: lines.reduce((a, l) => a + l.fac, 0), totalLin: lines.reduce((a, l) => a + l.lin, 0), skuCount: lines.length,
    preset: presetLabel(d), displayLabel: L(dt.label, dt.en),
    tot: lines.filter((l) => sh.tot[l.k.id]?.item).map((l) => ({ k: l.k, ...sh.tot[l.k.id] })),
  };
}

export const totLine = (t: { k: Sku; buyQty?: number; giftQty?: number; item?: string }) => `Mua ${t.buyQty || '?'} thùng ${t.k.brand} tặng ${t.giftQty || 1} ${t.item || ''}`.trim();
