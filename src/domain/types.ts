// Nexus POG domain model (scene schema 8).
// Coordinate system (unchanged from legacy schema 7):
//   unit = cm everywhere. X = left → right, Y = up, Z = back → front (the front faces +Z, toward the viewer).
//   Origin = floor level, back-left corner of the first pallet / bay.
//   pos = world position of the object's BOTTOM-CENTRE (pivot); ry = rotation about Y in degrees (three.js convention:
//   ry = +90 turns local +X toward world −Z).
//   Local frame of a product: +Z = front artwork, +X = right, −X = left, −Z = back, +Y = top.

export const SCHEMA = 8;

export interface Vec3 { x: number; y: number; z: number }
export interface Size3 { w: number; d: number; h: number }
export interface Box { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export type PackForm = 'carton' | 'pack' | 'unit';

export interface Identifier {
  type: 'EAN13' | 'EAN8' | 'UPC12' | 'CHAIN_CODE' | 'INTERNAL_CODE' | 'OTHER';
  value: string;
  primary?: boolean;
  status?: 'verified' | 'unverified' | 'needs_review';
  chain?: string;
  note?: string;
}

/** A product as used by the catalog and snapshotted into designs. */
export interface Sku {
  id: string;            // 'c:<code>' (catalog), 'u:<uid>' (user), 'l:<…>' (V6 loose)
  code: string;
  name: string;
  brand: string;
  maker: string;
  form: PackForm;
  w: number; d: number; h: number;
  units: number;         // single units per selling unit (carton/pack); 1 for unit; 0 = unknown
  kg: number;
  color: string;
  family: string;
  faces: Partial<Record<Face, string>>; // asset ids
  ml: string | number;
  pkg: string;
  cat: string;
  sub: string;
  seg?: string;
  est?: boolean;         // dimensions estimated from volume (≈)
  dsrc?: string;         // dimension source: 'PDF' | 'tay' (manual) | …
  src?: string;          // 'POG' (created by a PDF import) | 'CATALOG_FILE' | …
  attr?: Record<string, string>; // extra Spaceman descriptors (DescA…, String1…)
  mov?: number;          // Spaceman RegMovement
  // ---- new in schema 8 ----
  priceNormal?: number | null;   // VND per selling unit (master data)
  pricePromo?: number | null;    // VND per selling unit (master data)
  pid?: string;                  // NXP-000001 (product identity, immutable once set)
  identifiers?: Identifier[];
  updated?: number;
}

export type ObjectType = 'pallet' | 'sku' | 'array' | 'posm' | 'prop' | 'fixture' | 'shelf' | 'struct';
export type ArrayShape = 'block' | 'steps' | 'pyramid';

interface Base {
  id: string;
  pos: Vec3;
  ry: number;
  lock?: boolean;
  hidden?: boolean;
  name?: string;
}

export interface PalletObj extends Base { type: 'pallet'; size: Size3; subtype?: 'deck' }
export interface SkuObj extends Base { type: 'sku'; sku: string }
export interface ArrayObj extends Base {
  type: 'array';
  sku: string;
  n: { x: number; y: number; z: number };
  gap: { x: number; y: number; z: number };
  shape: ArrayShape;
  step: number;
  cellRy: number;
  anchor?: { x: number; z: number };
  pog?: { bay: number; shelf: number; pos: number; capacity: number | null };
  sm?: { fx?: string; units?: number; hs?: number };
}
export interface PosmObj extends Base {
  type: 'posm'; size: Size3; asset?: string | null; backAsset?: string | null; cutout?: boolean; color?: string; subtype?: 'skirt';
}
export interface PropObj extends Base { type: 'prop'; size: Size3; asset?: string | null; color?: string }
export interface FixtureObj extends Base { type: 'fixture'; size: Size3; fx: { pitch: number; panel: number; kick: number } }
export interface ShelfObj extends Base { type: 'shelf'; size: Size3; fixture?: string; sm?: { id: string; type: string; comb: number } }
export interface StructObj extends Base { type: 'struct'; size: Size3; color?: string }

export type SceneObject = PalletObj | SkuObj | ArrayObj | PosmObj | PropObj | FixtureObj | ShelfObj | StructObj;
export type StockObj = SkuObj | ArrayObj;
export type SizedObj = PalletObj | PosmObj | PropObj | FixtureObj | ShelfObj | StructObj;

export interface DesignSettings {
  kind?: 'pallet' | 'shelf';
  maxH: number;
  overhang: number;
  preset: string;
  sales?: Record<string, number>;   // poolKey(code) → single units per week
  salesSrc?: string;
  minDos?: number;
  flow?: '' | 'ltr' | 'rtl';
  src?: Record<string, unknown>;
  proposal?: { mode: string; shares: Record<string, number>; zone: string; block: string };
  [k: string]: unknown;
}

export interface SheetPosm { type: string; qty: number; loc: string }
export interface SheetTot { buyQty?: number; giftQty?: number; item?: string }
export interface SheetData {
  displayType: string;                     // id from the display-type registry ('u', 'ke', 'ge', …)
  preparedBy: string;
  installer?: string;
  checker?: string;
  store?: string;
  prices: Record<string, { normal?: string; promo?: string }>; // per-project overrides (blank = use master)
  posm: SheetPosm[];
  tot: Record<string, SheetTot>;
  notes?: string;
}

export interface DesignMeta { name: string; by: string; created: number; updated: number }

export interface Design {
  schema: number;
  meta: DesignMeta;
  settings: DesignSettings;
  skus: Record<string, Sku>;
  objects: SceneObject[];
  sheet?: SheetData;
  legacy?: Record<string, unknown>;
}

export interface Warning {
  level: 'danger' | 'warn' | 'info';
  msg: string;
  ids: string[];
}
