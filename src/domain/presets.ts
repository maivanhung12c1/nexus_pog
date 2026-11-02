// Presets: pallet displays (legacy PRESETS), gondola bays (legacy GONDOLA_PRESETS) and the display-type registry
// used by Phiếu Dựng. Presets are data: the app copies them into the workspace where users can edit/add their own.

export interface PalletPreset { id: string; name: string; w: number; d: number; h: number; maxH: number; retailer?: string }
export interface GondolaPreset { id: string; name: string; w: number; h: number; d: number; baseD: number; kick: number; n: number; pitch: number; t: number }

export const PALLET_PRESETS: Record<string, PalletPreset> = {
  go: { id: 'go', name: 'GO! / Big C', w: 120, d: 80, h: 20, maxH: 150, retailer: 'GO!' },
  coop: { id: 'coop', name: 'Co.op / Satra / WIN', w: 100, d: 100, h: 40, maxH: 150, retailer: 'CoopMart' },
  mega: { id: 'mega', name: 'Mega Market', w: 120, d: 100, h: 20, maxH: 150, retailer: 'Mega' },
  lotte: { id: 'lotte', name: 'Lotte Mart', w: 120, d: 80, h: 20, maxH: 150, retailer: 'Lotte' },
  aeon: { id: 'aeon', name: 'AEON', w: 120, d: 80, h: 15, maxH: 140, retailer: 'AEON' },
};

export const GONDOLA_PRESETS: Record<string, GondolaPreset> = {
  g100: { id: 'g100', name: 'Gondola 100 × 200', w: 100, h: 200, d: 45, baseD: 55, kick: 12, n: 5, pitch: 2.5, t: 2.5 },
  g120: { id: 'g120', name: 'Gondola 120 × 200', w: 120, h: 200, d: 45, baseD: 55, kick: 12, n: 5, pitch: 2.5, t: 2.5 },
  g133: { id: 'g133', name: 'Gondola 133 × 200', w: 133, h: 200, d: 45, baseD: 55, kick: 12, n: 5, pitch: 2.5, t: 2.5 },
  g100l: { id: 'g100l', name: 'Gondola 100 × 180', w: 100, h: 180, d: 40, baseD: 50, kick: 12, n: 5, pitch: 2.5, t: 2.5 },
  wall: { id: 'wall', name: 'Kệ tường 100 × 220', w: 100, h: 220, d: 50, baseD: 60, kick: 12, n: 6, pitch: 2.5, t: 2.5 },
};

/** Build-sheet display types. POSM templates for ụ / kệ / GE come from the legacy app; the others start empty
 *  because no template was defined (business decision pending — see REBUILD_PLAN.md). */
export interface DisplayType { id: string; label: string; en: string; base: 'pallet' | 'shelf' | 'other'; posm: { type: string; qty: number; loc: string }[]; templateConfirmed: boolean }

export const DISPLAY_TYPES: DisplayType[] = [
  { id: 'u', label: 'Ụ Đảo Pallet', en: 'Pallet island', base: 'pallet', templateConfirmed: true, posm: [
    { type: 'Bảng Giá Thùng', qty: 1, loc: 'Chính giữa mỗi cây hàng thùng (gắn tương ứng với SP trưng bày)' },
    { type: 'Bảng Giá Chữ A', qty: 1, loc: 'Bên trên cây hàng thùng' },
    { type: 'Tentcard', qty: 0, loc: '1 cái / SKU · tại Ụ Đảo (nếu có CTKM)' },
    { type: 'L-shape', qty: 0, loc: 'Nếu có CTKM' },
  ] },
  { id: 'ke', label: 'Kệ Chính', en: 'Main shelf (gondola)', base: 'shelf', templateConfirmed: true, posm: [
    { type: 'Wobbler tay vẫy', qty: 0, loc: 'Gắn vị trí sản phẩm có khuyến mãi (kệ chính / GE / cột / Plug-in)' },
  ] },
  { id: 'ge', label: 'GE – Đầu Kệ', en: 'GE – end cap', base: 'shelf', templateConfirmed: true, posm: [
    { type: 'Wobbler tay vẫy', qty: 0, loc: 'Gắn vị trí sản phẩm có khuyến mãi tại GE' },
    { type: 'POSM theo CTKM', qty: 0, loc: 'Trưng bày đầy đủ theo chương trình khuyến mãi' },
  ] },
  { id: 'plugin', label: 'Plug-in', en: 'Plug-in', base: 'shelf', templateConfirmed: false, posm: [] },
  { id: 'cot', label: 'Kệ Ốp Cột', en: 'Pillar wrap rack', base: 'shelf', templateConfirmed: false, posm: [] },
  { id: 'tulanh', label: 'Tủ Lạnh Mở', en: 'Open chiller', base: 'shelf', templateConfirmed: false, posm: [] },
  { id: 'other', label: 'Khác', en: 'Other', base: 'other', templateConfirmed: false, posm: [] },
];
/** Legacy sheet ids ('ụ', 'kệ', 'ge') → registry ids. */
export const LEGACY_DISPLAY_IDS: Record<string, string> = { 'ụ': 'u', 'kệ': 'ke', ge: 'ge' };
export const displayType = (id: string) => DISPLAY_TYPES.find((t) => t.id === (LEGACY_DISPLAY_IDS[id] || id)) || DISPLAY_TYPES[DISPLAY_TYPES.length - 1];

export const TOT_ITEMS = ['Thùng đá', 'Bình đá', 'Bộ chén đĩa', 'Ly giữ nhiệt', 'Bình giữ nhiệt'];
