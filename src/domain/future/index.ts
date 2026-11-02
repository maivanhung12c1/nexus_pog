// Future modules — boundaries only. Nothing here computes a result: each module states its inputs and the decisions
// that are still open, so the UI can show an honest "planned" screen and the data model is ready when rules arrive.

/** Tết 2027 Auto Build POG — 7-step wizard. The business plan (and its four open clarification questions) was not
 *  supplied with the repository, so every rule is an unconfirmed, user-editable input. */
// Step list as given in the rebuild brief; the exact split into 7 steps is not confirmed by the business plan.
export const TET2027_STEPS = [
  { id: 'brandBlock', vi: 'Khối thương hiệu (brand block)', en: 'Brand blocks' },
  { id: 'goldenZone', vi: 'Vùng vàng (golden zone)', en: 'Golden zone' },
  { id: 'segmentation', vi: 'Phân khúc', en: 'Segmentation' },
  { id: 'traffic', vi: 'Dòng chảy khách hàng', en: 'Traffic flow' },
  { id: 'constraints', vi: 'Ràng buộc', en: 'Constraints' },
  { id: 'generate', vi: 'Tạo POG', en: 'POG generation' },
  { id: 'compare', vi: 'So sánh phương án & chốt', en: 'Scenario comparison & finalisation' },
] as const;

export interface Tet2027Input {
  storeId?: string;
  fixture?: { bays: number; bayWidth: number; shelves: number };
  brandBlocks: { key: string; minSharePct?: number; order?: number }[];
  goldenZone?: { fromCm: number; toCm: number };
  segmentation?: string;          // product field used for segments (e.g. 'sub')
  traffic?: 'ltr' | 'rtl';
  constraints: { text: string; confirmed: boolean }[];
  /** The four business questions from the Tết 2027 plan, to be answered by VBH (not invented here). */
  openQuestions: { question: string; answer?: string }[];
}
export const TET2027_STATUS = { implemented: false, reason: 'Business rules not confirmed (Tết 2027 plan with four open questions not supplied).' } as const;

/** Warehouse auto stacking (Mode A, SPVB stacking patterns PF-1 / PF-4). Patterns are not specified anywhere. */
export interface StackingPattern { id: string; name: string; layers: { cartons: number; orientation: 'long' | 'short' | 'mixed' }[]; maxHeightCm?: number; maxWeightKg?: number }
export const WAREHOUSE_STATUS = { implemented: false, reason: 'PF-1 / PF-4 pattern definitions and carton constraints not supplied.' } as const;

/** Compliance: proposed POG vs actual (photo / imported POG / manual shelf). The comparison engine for two designs
 *  already exists (analysis/compare + spaceShare.skuChanges); photo recognition is not implemented. */
export type ComplianceIssue = 'missing' | 'extra' | 'facings' | 'position' | 'shelf' | 'competitor' | 'shareDeviation';
export interface ComplianceFinding { issue: ComplianceIssue; code: string; expected?: string; actual?: string }
export const COMPLIANCE_STATUS = { implemented: 'partial', reason: 'Design-vs-design comparison is available; photo input is planned.' } as const;

/** Price tag generator: master prices → printable tags. Template design not specified. */
export interface PriceTagTemplate { id: string; name: string; widthMm: number; heightMm: number; showPromo: boolean; showPack: boolean }
export const PRICE_TAG_STATUS = { implemented: false, reason: 'Tag template and print size not specified.' } as const;
