// Master-data pricing (new in schema 8). Prices are VND per selling unit of the SKU (its own pack form).
// Phiếu Dựng shows the master price unless the project overrides it; an override of '' means "use master".
import type { SheetData, Sku } from '../types';

export interface ResolvedPrice { normal: number | null; promo: number | null; normalSrc: 'override' | 'master' | 'none'; promoSrc: 'override' | 'master' | 'none' }

export const parsePrice = (v: unknown): number | null => {
  if (v == null) return null;
  const s = String(v).replace(/[^\d.,-]/g, '').trim();
  if (!s) return null;
  // Vietnamese style "12.500" or "12,500" are thousands separators for VND; keep digits only
  const n = Number(s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

export function resolvePrice(k: Sku, sheet?: SheetData | null): ResolvedPrice {
  const o = sheet?.prices?.[k.id] || {};
  const legacy = (k as unknown as { price?: unknown }).price;
  const mNormal = k.priceNormal ?? parsePrice(legacy) ?? null, mPromo = k.pricePromo ?? null;
  const oN = o.normal != null && String(o.normal).trim() !== '' ? parsePrice(o.normal) : null;
  const oP = o.promo != null && String(o.promo).trim() !== '' ? parsePrice(o.promo) : null;
  return {
    normal: oN ?? mNormal, promo: oP ?? mPromo,
    normalSrc: oN != null ? 'override' : mNormal != null ? 'master' : 'none',
    promoSrc: oP != null ? 'override' : mPromo != null ? 'master' : 'none',
  };
}

export const formatVnd = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('vi-VN') + ' ₫');
