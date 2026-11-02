# Architecture — Nexus POG 2

## 1. Principles

1. **The domain is pure.** `src/domain` has no DOM, no three.js, no React, no IndexedDB. Every business rule from the
   legacy file lives here and is unit-tested in Node.
2. **One mutable document per open project, changed only through transactions.** The legacy algorithms mutate the design
   in place. They are ported as-is and run inside a transaction that snapshots the document before and diffs it after
   (the legacy undo model). This keeps the arithmetic identical and gives undo/redo for free.
3. **Infrastructure is replaceable.** File formats (zip, CSV, XLSX, PLNX, PDF, JSON) and storage (IndexedDB) live in
   `src/infra` behind small functions. Parsers that can be pure are pure (string/bytes in, data out).
4. **Rendering reads, never owns.** The three.js viewport subscribes to the document version and rebuilds or patches its
   meshes. It never holds business state.
5. **UI state is never persisted with the project.** Selection, camera, panels, filters live in UI stores.

Dependency direction (no cycles): `ui → app → (domain, infra, render)`, `render → domain`, `infra → domain`,
`domain → nothing`.

## 2. Module map

```
src/
  domain/                      pure TypeScript, Node-testable
    types.ts                   Design, SceneObject (discriminated by type), Sku, Settings, SheetData, presets
    util.ts  i18n.ts colors.ts R1/R2/clamp/norm/uid/deep/poolKey/slug/toNum, L(vi,en), colorFor
    geometry.ts                skuDims, localSize, rotExt, toWorld, boxAABB, aabb, arrayCells/Count/Levels, solids, unionBox
    scene.ts                   Scene: a Design + id index + support cache (replaces legacy global D/getObj/_solidCache)
    snap.ts                    supportUnder, snapBox
    checks.ts                  runChecks (message keys + args; formatted by i18n)
    collision.ts               collisionGuard (strict mode)
    bom.ts                     computeBOM
    history.ts                 snapState / diffState / applyDiff (undo model)
    presets.ts                 pallet presets, gondola presets, display types registry
    ops/                       editing operations on a Scene (duplicate, nudge, align, rotate, arrays, replace SKU, split)
    shelf/                     gondola, notch, riders, pack/fill, limits, facings, bays, metrics, sales import
    pallet/                    hollow shell, core fill, pallet resize
    catalog/                   SKU from master, pack form, size estimates, brand inference, merge rules, pricing, PIDs, identifiers
    analysis/                  space share (positions/aggregation/colours/changes), compare, auto POG
    operations/                Phiếu Dựng model (sheet defaults, POSM templates per display type, TOT, picking, summary)
    migration/                 V6 → V7 adapter, V7 → V8 normaliser with report
    future/                    tet2027, warehouse, compliance, priceTags: types and boundaries only
  infra/                       browser / file IO
    zip.ts csv.ts xlsx.ts      unzip (DecompressionStream), zip writer (CompressionStream), CSV, XLSX first sheet
    plnx/                      read (DOMParser) + write (template records) + plnx-template.json (extracted from legacy)
    pdf/                       pogParser.ts (pure text-layer parser), pdfjs.ts (pdf.js adapter, drawing measurement)
    images.ts                  image pool naming, MIME sniffing, shrink, PNG alpha
    idb.ts                     typed IndexedDB wrapper (projects, catalog, assets, kv)
    projectFile.ts             project JSON read/write (schema 8, reads 7 and V6)
    download.ts clipboard.ts   file save, image to clipboard
  app/                         application layer (stateful, no DOM rendering)
    projectStore.ts            open project: Scene, history, version, transactions, autosave
    catalogStore.ts            catalog, image pool, assets, master version merge
    workspaceStore.ts          project list, analysis sets (Space Share POG sets), preferences
    uiStore.ts                 selection, view, tools, panels, toasts, dialogs
    commands/                  user commands: label + domain op + transaction (editor, shelf, catalog, sheet, io)
    i18n/                      vi / en dictionaries
  render/                      three.js
    viewport.ts                renderer, views (top/3d/front/side/splits), cameras, frame, resize
    sceneSync.ts               instanced meshes per SKU, fixtures, pallets, POSM, props; fast matrix path while dragging
    textures.ts overlay.ts     face/label textures, 2D overlay (dimensions, ruler, guides, marquee, measure)
    interaction.ts             pointer/keyboard → commands (drag, marquee, orbit, pan, zoom, library drop, measure)
    snapshot.ts                offscreen PNG renders for export, sheets and reports
  ui/
    ds/                        design-system components (Button, Field, Select, Segmented, Tabs, Table, Drawer, Dialog, Menu, Pill, Toast, Empty)
    shell/                     app frame (tinted L-frame + white sheet), navigation, top bar
    screens/                   home, editor, catalog, presets, competitors, analysis, operations, automation, field
    widgets/                   ShelfStrip (signature element), ShareBars, KPI strip
  data/spvb-master.json        embedded master (verbatim from legacy, MASTER_VER 2026-10-28d)
```

## 3. Domain model

```ts
type Vec3 = { x: number; y: number; z: number }           // cm; X →, Y ↑, Z back → front
interface BaseObject { id: string; type: ObjectType; pos: Vec3; ry: number; lock?: boolean; hidden?: boolean; name?: string }
type SceneObject =
  | PalletObj   { type:'pallet', size, subtype?:'deck' }
  | SkuObj      { type:'sku', sku }
  | ArrayObj    { type:'array', sku, n, gap, shape:'block'|'steps'|'pyramid', step, cellRy, anchor, pog?, sm? }
  | PosmObj     { type:'posm', size, asset?, backAsset?, cutout?, color?, subtype?:'skirt' }
  | PropObj     { type:'prop', size, asset?, color? }
  | FixtureObj  { type:'fixture', size, fx:{ pitch, panel, kick } }
  | ShelfObj    { type:'shelf', size, fixture?, sm? }
  | StructObj   { type:'struct', size, color? }
interface Design {
  schema: 8; meta: { name, by, created, updated, displayType? }
  settings: { kind:'pallet'|'shelf', maxH, overhang, preset, sales?, salesSrc?, minDos?, flow?, src?, proposal? }
  skus: Record<string, Sku>          // snapshot of every SKU used (as legacy)
  objects: SceneObject[]
  sheet?: SheetData                  // Phiếu Dựng (prices overrides, POSM, TOT, people)
  legacy?: Record<string, unknown>   // unknown fields carried from older files
}
interface Sku { id:'c:<code>'|'u:…'|'l:…'; code; name; brand; maker; form:'carton'|'pack'|'unit'; w; d; h; units; kg; color;
  family; faces: Partial<Record<Face, assetId>>; ml; pkg; cat; sub; seg?; est?; dsrc?; src?; attr?; mov?;
  priceNormal?: number; pricePromo?: number; pid?: string; identifiers?: Identifier[]; competitor?: boolean }
```

`Scene` wraps one `Design` and owns the derived caches the legacy kept in globals (`_objIdx`, `_solidCache`). Any code
that legacy ran "with another design swapped in" (`metricsOf`, `rpPositions`, `withDesign`) simply creates a `Scene` for
that design.

## 4. State model

| Store | Contents | Persisted | Undoable |
|---|---|---|---|
| Project (`projectStore`) | `Scene` (design), history stacks, `version`, `dirty`, project id | IndexedDB `projects` (autosave 700 ms after the last commit) | Yes (design incl. sheet) |
| Catalog (`catalogStore`) | catalog SKUs (incl. prices, PIDs, identifiers), image pool, assets map, master version | IndexedDB `catalog`, `assets`, `kv.imgpool`, `kv.masterVer` | No (catalog edits are direct; design copies follow through "update from master") |
| Workspace (`workspaceStore`) | project index (recent list), Space Share POG sets, preferences (lang, strict, snap…) | IndexedDB `kv`, localStorage for prefs | No |
| UI (`uiStore`) | route, selection, view, camera, tool (measure/builder), panels, filters, dialogs, toasts | No (prefs only) | No |
| Analysis | derived on demand from designs (memoised by design version) | POG sets persisted in workspace | No |

**Transactions.** `project.edit(label, fn)` = legacy `edit()`: snapshot → run domain op(s) on the Scene → diff →
collision guard (strict mode) → push to undo stack (cap 200) → bump version → schedule checks + autosave.
Drags open a transaction at pointer-down and commit at pointer-up (with intermediate fast matrix updates).
Merged steps (nudge, facings) reuse the last transaction within the legacy time windows.

## 5. Rendering

- One `WebGLRenderer` per editor; views are scissored viewports exactly as legacy (`top`, `persp`, `front`, `side`,
  `split` = top+3D, `fsplit` = front+3D).
- `sceneSync` keeps one `InstancedMesh` per SKU (capacity ×1.5), rebuilt when the document version changes and the
  object set changed; while dragging only the moved objects' matrices are rewritten (`updateObjects`).
- A 2D overlay canvas draws dimensions, rulers, guides, marquee, measuring and the drag tooltip.
- Snapshots render one camera off-screen at a given size with a white background (PNG export, sheets, reports).

## 6. Persistence

IndexedDB database `nexus-pog` (v1):

| Store | Key | Value |
|---|---|---|
| `projects` | project id | `{ id, name, kind, updated, design, thumb? }` |
| `catalog` | `'catalog'` | SKU array (single record; ~3.3k SKUs ≈ 1.5 MB) |
| `assets` | asset id (`a<hash>`) | data URL |
| `kv` | string | `masterVer`, `imgpool`, `pidCounter`, `spaceShareSets`, `lastProject` |

Project files: `format: 'nexus-pog'`, `schema: 8`, `{ design, assets }` with every used asset embedded (same idea as legacy).

## 7. Import / export

| Path | Module | Notes |
|---|---|---|
| JSON project in/out | `infra/projectFile.ts` + `domain/migration` | reads schema 7 (`smart-pallet-scene`, `nexus-pog`), V6 project and V6 library |
| PLNX in | `infra/plnx/read.ts` → `domain` builders | multi-planogram; catalog merge of real sizes |
| PLNX out | `infra/plnx/write.ts` | templates extracted verbatim; preflight in `domain/shelf/preflight.ts` |
| PDF POG | `infra/pdf/pogParser.ts` (pure) + `infra/pdf/pdfjs.ts` | GO!/mini go/Lotte text layer; drawing measurement |
| CSV/XLSX catalog & sales | `infra/csv.ts`, `infra/xlsx.ts` + `domain/catalog/import.ts`, `domain/shelf/sales.ts` | |
| PNG | `render/snapshot.ts` | Top / 3D / Front, POG sheet |
| BOM CSV | `domain/bom.ts` + `infra/download.ts` | |
| Phiếu Dựng | `ui/screens/operations` (HTML document) → print/PDF, PNG (canvas), clipboard | |
| Space Share report PDF | `ui/screens/analysis/report` (print-optimised HTML document) | browser "Save as PDF"; PNG via canvas |

## 8. Migration

`legacy file → normaliseDesign() → Design (schema 8) + MigrationReport { notes[], kept[], dropped[] }`.

- Schema 7 → 8: adds `settings.kind` (`'pallet'` when absent), moves `meta.preset`→ ignored, keeps `sheet`, coerces
  numbers, fixes SKU forms (`fixForm`), restores placeholder sizes (`unPlaceholder`), keeps unknown top-level fields
  under `legacy` and lists them in the report.
- V6 → 7: the legacy adapter, ported unchanged, then the 7 → 8 step.
- SKU snapshots in a loaded project are added to the catalog when the catalog does not know them (legacy behaviour).

## 9. Testing

| Layer | Tool | What |
|---|---|---|
| Domain | Vitest (Node) | geometry, BOM, checks, collision, undo diff, shelf ops & limits, metrics, sales, shell, catalog rules, pricing, share, compare, auto POG, sheet model, migration |
| Infra | Vitest (jsdom) | CSV, XLSX (built in test), zip round-trip, PLNX write→read round-trip, POG text parser |
| Parity | Playwright + legacy file | `tests/parity/capture-legacy.mjs` produces fixtures from `Nexus_POG.html`; `tests/parity/*.test.ts` compares |
| Smoke | Playwright (installed Chrome) | app boots, create gondola, add SKU, facings, undo/redo, save/reload, Space Share, Phiếu Dựng |

## 10. Performance

- Instanced meshes per SKU; matrix-only updates during drag (legacy measured 2,000 items).
- Support solids cached per document version; checks debounced (120 ms); autosave debounced (700 ms).
- Analysis results memoised by `(design, version)`; catalog search runs on a pre-normalised index.
- Large tables are windowed (catalog: 3,300+ rows).
