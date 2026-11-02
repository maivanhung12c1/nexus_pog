# Legacy feature audit — `Nexus_POG.html`

Audited: 2026-11-02. Source: `Nexus_POG.html` (2.96 MB, 5,162 lines, UTF-8), the only application file in the repository.
The repository also holds `taste-skill/` (a design skill, not application code). There was no `package.json`, no build
system, no tests, no git history and no sample data files (no `.plnx`, `.pdf`, `.json` projects or catalog files).

## 1. What the file is made of

| Lines | Content | Size | Reuse decision |
|---|---|---|---|
| 1–137 | CSS (navy/orange theme, 3-column grid, modal, report, sheet panel) | 24 KB | Replaced (new design system) |
| 138–182 | App HTML skeleton (top bar, library, stage, side panel, status bar) | — | Replaced |
| 183–191 | three.js **r149** (minified, MIT) | 608 KB | Replaced by `three` from npm |
| 192–215 | pdf.js **3.x** main lib (minified, Apache-2.0) | 319 KB | Replaced by `pdfjs-dist` from npm |
| 216–237 | pdf.js worker inlined as `<script type="text/plain">` | 1.09 MB | Replaced by the npm worker (Vite asset) |
| 240 | `MASTER` — SPVB master catalog, 3,300 rows, `MASTER_VER='2026-10-28d'` | 406 KB | **Extracted verbatim** to `src/data/spvb-master.json` |
| 1990 | `PLNX_TPL` — Spaceman 15.2 XML record templates (16 keys) | 46 KB | **Extracted verbatim** to `src/infra/plnx/plnx-template.json` |
| 238–5160 | Application (one IIFE, global mutable design `D`) | ~460 KB | Business logic ported to TS modules; UI replaced |

Self-declared version: `APP_VERSION='1.0 (scene schema 7)'`, `SCHEMA=7`. The code is organised into commented
"files" (`core.js`, `geometry`, `render`, `interaction`, `ops`, `shelf`, `pdf`, `plnx`, `report.js`, `sheet`, `auto pog`,
`io.js`, `master.js`, `master UI`, `autosync`, `app.js`) concatenated into one IIFE. Debug handle: `window.SP7`.

### Embedded master catalog profile (`MASTER`)

Columns: `code, name, brand, maker, h, w, d, cat, pkg, ml, pack, sub`. 3,300 rows.

- Makers: OTHER 2,174 · **SPVB 269** · **KO 251** · (blank) 162 · E-MART 86 · KIRIN 65 · VINAMILK 37 · TH 36 · URC 35 · LA VIE 25 · TCP 23 · AEON 21 · MASAN 18 …
  → the master **already contains competitor products** (Coca-Cola = `KO`, URC = C2/Rong Đỏ, TCP = Number 1, …). A competitor catalog can be a real view over this data; nothing has to be invented.
- Categories: JD 1,099 · RTD TEA 486 · CSD 473 · OTHER 344 · PW 240 · ED 212 · COFFEE 119 · SPO 75 · PW+ 69 · MILK 38 · ALCOHOL 19 · BEER 4 · blank 122.
- Pack: SINGLE 2,377 · (blank) 441 · CARTON 321 · 6 PACK 160 · 3 PACK 1. Package: PET 1,383 · CAN 650 · OTHER 540 · RGB 66 …
- **1,159 rows have no dimensions** → the app estimates them (`est:true`, shown as "≈").
- No price fields. No images (images come from user-loaded "image pool").

## 2. Feature inventory

Legend — *Algorithm found*: where the business rule lives in the legacy code. *Migration*: whether persisted data must be converted.
*Rebuild status* reflects the code as delivered on 2026-11-03 (see `REBUILD_STATUS.md` for the verification evidence).

### 2.1 Scene model & editor core

| Feature | Existing | Algorithm found | Data model | Migration needed | Rebuild status |
|---|---|---|---|---|---|
| Coordinate system: cm, X→right, Y↑, Z back→front, pivot = bottom-centre, `ry` degrees about Y (three.js convention) | ✓ | core header comment | `pos{x,y,z}`, `ry` | No (kept 1:1) | Ported |
| Object types `pallet`, `sku`, `array`, `posm`, `prop`, `fixture`, `shelf`, `struct` (+ `pallet.subtype='deck'`, `posm.subtype='skirt'`) | ✓ | `newDesign`, comments | `D.objects[]` | No | Ported |
| Design snapshot of used SKUs (`D.skus` id→SKU) separate from the catalog | ✓ | `ensureProjectSku` | `D.skus` | No | Ported |
| Parametric array (facing block): `n{x,y,z}`, `gap`, `shape` block/steps/pyramid, `step`, `cellRy`, `anchor{x,z}` | ✓ | `arrayCells`, `arrayCount`, `arrayLevels`, `solids`, `localSize` | array object | No | Ported + tested |
| AABB with rotation (exact for right angles, bounding box for free angles) | ✓ | `rotExt`, `toWorld`, `boxAABB`, `aabb` | — | — | Ported + tested |
| Undo/redo as per-command JSON diff of objects + skus + settings + meta (200 steps) | ✓ | `snapState`, `diffState`, `commitTx`, `applyDiff` | — | — | Ported (same diff model) + tested |
| Merged undo steps for rapid nudges (900 ms) and facing edits (1,200 ms) | ✓ | `nudge`, `countEdit` | — | — | Ported |
| Collision guard ("Chặn va chạm"): reject an edit that creates a *new* overlap (>0.3 cm) between stock / shelf / pallet / bay back panel | ✓ | `hardSolids`, `hitsOf`, `collisionGuard` | `ui.strict` (localStorage `sp7:strict`) | No | Ported + tested |
| Selection, Shift-toggle, marquee (Top/Front/Side), select all, select same SKU / level / column | ✓ | `setSel`, `onUp` marquee, `selectSame*` | UI state | — | Ported |
| Move drag (Top/3D on a horizontal plane; Front on a vertical plane with drop onto nearest surface below) | ✓ | `beginDrag`, `dragTo`, `dragFront` | — | — | Ported |
| Ctrl+drag = copy; carry riders (things standing on a moved pallet/shelf/bay) | ✓ | `beginDrag`, `ridersOf` | `ui.carry` | — | Ported |
| Auto-rest on the highest support under the footprint (contact >0.5 cm) | ✓ | `supportUnder`, `supportSolids` | `ui.autoRest` | — | Ported + tested |
| Grid snap (0.5/1/5/10 cm) and edge/centre snap with guides (threshold 9 px in cm, 0.3–8 cm) | ✓ | `snapBox` | `ui.snapOn/grid/snapEdge` | — | Ported + tested |
| Library drag & drop with ghost preview, red ghost on collision; double-click quick add | ✓ | `startLibDrag`, `libMove`, `quickAdd` | — | — | Ported |
| Drop on shelf → 1-facing block filling depth, front aligned ("fill depth" toggle) | ✓ | `shelfBlock` | `ui.fillDepth` | — | Ported + tested |
| Duplicate L/R/Back/Front/On top; copy/paste | ✓ | `duplicateSel`, `copySel`, `pasteClip` | — | — | Ported |
| Nudge (arrows 1 cm, Shift 10 cm, PgUp/PgDn height) | ✓ | `nudge` | — | — | Ported |
| Align L/C/R/Back/Front; distribute across | ✓ | `alignSel` | — | — | Ported |
| Rotate selection about its centre by step 90/45/30/15/5/1; set exact angle | ✓ | `rotateSel`, `setAngle` | `ui.rotStep` | — | Ported |
| Quick build: Row / Grid / Block with preview, direction, gaps, shape | ✓ | `openBuilder`, `arrayFromItem`, `builderPreview` | — | — | Ported |
| Edit array parameters keeping anchor corner | ✓ | `setArrayParam`, `keepCorner` | — | — | Ported + tested |
| Split array into items; split by level | ✓ | `explodeArray`, `splitLevels` | — | — | Ported + tested |
| Replace SKU (scope selection/level/all, from-SKU filter, fit centre/corner/front/fill, swap A↔B, collision preview) | ✓ | `openReplace`, `replaceCore` | — | — | Ported + tested |
| Lock / hide | ✓ | `toggleFlag` | `o.lock`, `o.hidden` | — | Ported |
| Measuring tool (2 clicks, snaps to corners/edge midpoints within 12 px) | ✓ | `measurePoint`, `drawMeasure` | — | — | Ported |
| Dimension lines (Top/Front/Side/3D), vertical ruler (Front/Side), shelf-height labels in Front | ✓ | `drawDims`, `drawDims3D`, `drawRuler` | — | — | Ported |
| Views: Top, 3D, Front, Side, Top+3D split, Front+3D split; frame all (F, double-click) | ✓ | `layoutViews`, `updateCam`, `frameBox` | `ui.view`, camera state | — | Ported |
| Orbit / pan / zoom-to-cursor | ✓ | `onMove`, `onWheel` | — | — | Ported |
| Instanced rendering per SKU (InstancedMesh), cylinders for single round units, face textures, label textures when no image | ✓ | `rebuildScene`, `skuGeoMats`, `labelTexture` | — | — | Ported |
| Fast drag path (matrices only) | ✓ | `updateObjects` | — | — | Ported |
| Pallet wood textures; fixture (back panel/uprights/kick); shelf; POSM board (cutout PNG); prop box | ✓ | `buildMesh`, `palletTextures` | — | — | Ported |
| Performance test (500 / 2,000 items: build, frame, pick, drag, checks) | ✓ | `perfTest`, `perfRun` | — | — | **Not ported yet** (instancing + fast drag path are ported; the benchmark page is not) |
| Visible error bar (uncaught errors shown, copyable) | ✓ | error reporter IIFE | — | — | Replaced by an error boundary + error panel |
| Bilingual UI vi/en (`I18N`, `L(vi,en)`) | ✓ | `t`, `L` | localStorage `sp7:lang` | — | Ported (vi default, en) |

### 2.2 Validation / warnings (`runChecks`) — list only, never auto-fixed

| Rule | Level | Threshold | Rebuild status |
|---|---|---|---|
| Overlap between solids (not pallets/fixtures/structs; POSM vs POSM ignored) | danger | >0.3 cm on all 3 axes, first 40 listed + "… +n" | Ported + tested |
| Product hits a shelf ("not enough clearance") | danger | same | Ported |
| Object top above `settings.maxH` | danger | >0.05 cm | Ported |
| Free (non-right) angle → overlap/support approximate | info | — | Ported |
| Under-supported (floating) | warn | <60 % of the base footprint on supports at ±0.6 cm | Ported |
| Overhangs its pallet/shelf | warn | footprint covered <99.5 % incl. `settings.overhang` tolerance | Ported |
| SKU without units per pack | warn | `units` not > 0 | Ported |
| SKU with estimated dimensions | info | `est` | Ported |
| Suspicious carton dimensions | warn | carton with w×d <150 cm² and not estimated | Ported |
| PLNX preflight: loose stock, overflow past shelf end, taller than gap above, deeper than shelf, overlapping positions, ≈ sizes | danger/warn/info | see `plnxPreflight` | Ported + tested |

### 2.3 Shelf / gondola system

| Feature | Existing | Algorithm found | Data model | Migration | Rebuild status |
|---|---|---|---|---|---|
| Gondola presets g100/g120/g133/g100l/wall (w, h, d, baseD, kick, n, pitch, t) | ✓ | `GONDOLA_PRESETS` | constants | — | Ported (read-only table; per-design values editable in the editor) |
| Pallet presets GO!/Big C, Co.op/Satra/WIN, Mega, Lotte, AEON (w, d, h, maxH) | ✓ | `PRESETS` | constants | — | Ported (read-only table; pallet size editable per design) |
| Bay = `fixture` (back panel 2 cm, uprights, kick plate) + `shelf` objects linked by `shelf.fixture` | ✓ | `bayObjects`, `addGondola`, `newShelfDesign` | `fixture.fx{pitch,panel,kick}` | — | Ported + tested |
| Shelf tops spread on the notch pitch | ✓ | `shelfTops` | — | — | Ported + tested |
| Notch snapping of shelves (Front drag, numeric input) | ✓ | `notchY` | — | — | Ported + tested |
| Riders: shelves of a bay, then everything resting on them (recursive) | ✓ | `ridersOf` | — | — | Ported + tested |
| Pack left / right / spread evenly | ✓ | `packShelf` | — | — | Ported + tested |
| Fill depth (all on shelf / one block) | ✓ | `fillDepth`, `fillOne` | — | — | Ported + tested |
| Physical limits for facings / stack / depth (next product, shelf run end incl. touching shelves, shelf above or bay top, back panel) with a reason message | ✓ | `shelfRun`, `shelfLimits`, `setCount` | — | — | Ported + tested |
| Facing shortcuts (Shift+←/→, digits 1–9 multi-digit, Shift+↑/↓ stack) | ✓ | `onKey` | — | — | Ported |
| Resize bay (shelves follow, bays to the right shift), delete bay (with riders), add shelf in largest gap | ✓ | `resizeBay`, `deleteBay`, `shelfAct('addShelf')` | — | — | Ported + tested |
| Shelf metrics: total/used linear, per SKU facings/linear/count/converted units, sales, days of supply, share by brand/maker, per shelf usage | ✓ | `shelfMetrics`, `metricsOf` | `settings.sales`, `settings.minDos` | — | Ported + tested (parity) |
| Sales import (AEON "Data sharing" wide format: store × barcode × months; simple code+qty) → units/week | ✓ | `salesWide`, `salesWideUI`, `salesSimpleUI` | `settings.sales{poolKey:units/wk}`, `settings.salesSrc` | — | Ported + tested |
| POG sheet PNG (front render + shelf heights + bay widths + facing labels + brand & SKU tables) | ✓ | `exportPOGSheet` | — | — | Ported |
| Pallet display: hollow shell ("Xếp viền rỗng ruột"), per-face SKU, levels, deck board + lid layer, outer faces of an island | ✓ | `shellFor`, `wallRun`, `runMix`, `lidLayer`, `exposedSides`, `applyShell` | `subtype:'deck'` | — | Ported + tested |
| Auto-fill pallet core | ✓ | `autoFillPallet` | — | — | Ported |
| Pallet resize keeping back-left corner, products follow height change (option) | ✓ | `resizePallet` | `ui.palletFollow` | — | Ported |

### 2.4 SKU master data / catalog

| Feature | Existing | Algorithm found | Data model | Migration | Rebuild status |
|---|---|---|---|---|---|
| Embedded SPVB master → catalog; merged on version change (new codes added, blank maker/brand/cat/sub filled, user edits kept) | ✓ | `init`, `skuFromMaster` | IDB `kv.catalog`, `kv.masterVer` | Yes (catalog lives in legacy IDB) | Ported + tested |
| Pack form detection from pack column + name (carton/pack/unit), units per pack | ✓ | `formFromPack`, `unitsFrom`, `fixForm` | `form`, `units` | — | Ported + tested (parity) |
| Size estimate from volume + package when master has none (`est:true`, "≈") | ✓ | `mlOf`, `estUnit`, `estDims` | `est`, `dsrc` | — | Ported + tested (parity) |
| Spaceman placeholder 4×6×2 → back to estimate | ✓ | `unPlaceholder`, `smPlaceholder` | — | — | Ported |
| Brand/maker inference from catalog for unknown codes | ✓ | `brandIndex`, `inferBrand`, `fillBrand` | — | — | Ported |
| Brand colours (PEPSI, 7UP, MIRINDA, TEA+, LIPTON, STING, AQUAFINA, ROCKSTAR, BOSS, TWISTER, MOUNTAIN DEW, SCHWEPPES) + hashed palette | ✓ | `colorFor` | `color` | — | Ported |
| SKU editor (code, brand, maker, name, form, units, kg, w/d/h, family, colour, 5 face images) | ✓ | `openSkuEditor` | SKU | — | Rebuilt as a catalog drawer (+ prices) |
| Design SKU differs from master → "update from master" | ✓ | `skuHead`, `syncMaster` | — | — | Ported |
| Catalog import CSV/XLSX with Vietnamese/English header aliases | ✓ | `parseCSV`, `COLS`, `mapHeader`, `rowsToItems`, `readXLSX`, `importCatalogFile` | — | — | Ported + tested |
| Image pool by code (Spaceman `CODE.1/.2/.3/.7/.8`, `CODE_1.jpg`, `CODE.jpg`), ZIP / folder load, leading zeros ignored, report of missing/unreadable | ✓ | `parseImageName`, `poolKey`, `loadImagePool`, `applyPool`, `refreshImages` | IDB `kv.imgpool`, `assets` | Yes | Ported (name parsing unit-tested; folder/ZIP loading not yet exercised end-to-end) |
| SKU sizes panel: edit ≈ sizes, paste from Excel, import file, re-lay shelves in order | ✓ | `openDimPanel`, `applySkuSizes`, `reflowShelf` | `dsrc` | — | Ported |
| PID generator `NXP-000001` + product master backfill (resumable, checkpointed, fingerprinted) | ✓ | `getOrCreatePid`, `backfillPids` | IDB `productMaster`, `productIdentifiers`, kv counter | Yes | Ported (simplified: PID stored on catalog SKU, deterministic backfill) |
| Product master API (create/read/search/update, identifiers EAN13/EAN8/UPC12/CHAIN_CODE/INTERNAL_CODE/OTHER, duplicate EAN review, stats) | ✓ | `master.js` | IDB stores | Yes | Partially ported (identifiers & duplicate review in catalog); retailer mappings deferred |
| Master Data tab UI (search, filters, detail, add identifier, duplicate review) | ✓ | `master UI` | — | — | Replaced by the Catalog workspace |
| AutoSync (File System Access): image folder + catalog file re-sync on start-up by mtime | ✓ | `AUTOSYNC` | IDB `autosync:*` | — | Deferred (see §4 bugs); manual import kept |
| IDB stores declared but unused: retailerProductMappings, retailerListings, sellout, pogVersions, pogItems, importHistory, sourceRegistry | declared only | `DB.open` | — | — | Not migrated (no data, no behaviour) |
| `priceNormal` / `pricePromo` on the SKU | **missing** (Phiếu Dựng reads `k.priceNormal||k.price` but nothing sets them) | — | — | — | **New** in rebuild |

### 2.5 Import / export

| Format | Direction | Algorithm found | Notes | Rebuild status |
|---|---|---|---|---|
| Project JSON `format:'smart-pallet-scene'` (schema 7) with embedded used assets; also accepts `format:'nexus-pog'` | in/out | `projectJSON`, `openProjectFile`, `loadDesign` | file name `<slug>-v7.json` | Ported; new files use `format:'nexus-pog'` schema 8 (reader accepts 7) |
| V6 project `{version:6, project, images}` and V6 library `smart-pallet-library` → V7 with count report | in | `migrateV6`, `showMigration` | cartons, HID blocks/steps/pyramids, props, boards, skirt; text modules not converted | Ported + tested |
| Spaceman `.plnx` (zip → `planograms.xml`): commonproducts, multiple planograms, sections, fixtures, positions, decorative items; inch→cm when not metric | in | `readPlnx`, `smPog`, `smSku`, `buildFromPlnx`, `mergePlnxCatalog` | rotation inferred from position spaces; gaps capped 5 cm | Ported + tested |
| Spaceman `.plnx` builder from `PLNX_TPL` (Spaceman 15.2 records), bays/shelves/positions, MaxMerch, product records, store stats, zip with deflate | out | `plnxModel`, `buildPlnxXML`, `plnxBlob`, `zipFiles` | `checksums.xml` intentionally omitted | Ported + round-trip tested |
| POG PDF (text layer): GO!/mini go (JDA "Fixel_ID Location_ID …"), Lotte Mart (STT/Sale.code/Manufacturer/Facing); shelf heights "chieu cao"; flow arrows | in | `pogLines`, `parsePOGPages`, `pogMetaLines`, `buildFromPOG`, `pogDefaults` | image-only PDFs are rejected with a message | Ported + tested (synthetic text pages) |
| POG PDF drawing measurement: cm/PDF-unit fit from shelf labels, facing pictures → product width/height and cropped product picture | in | `pdfImageBoxes`, `pogShelfLabels`, `pogDrawingSizes`, `applyDrawingSizes` | | Ported (needs a real PDF to verify end-to-end) |
| Batch PDFs → designs → .plnx each → one .zip; add all to Space Share | in/out | `openBatch` | | Ported |
| Catalog CSV/XLSX | in | see 2.4 | XLSX reader is a built-in mini parser (first sheet, shared strings) | Ported + tested |
| Sales CSV/XLSX | in | see 2.3 | | Ported |
| PNG Top / 3D / Front snapshot (1600×1100, white background, framed) | out | `snapshotPNG`, `exportPNG` | | Ported |
| BOM CSV (UTF-8 BOM, families, POSM, props, pallets) | out | `exportBOM` | | Ported + tested |
| Compare change list CSV | out | `showCompare` | | Ported |
| Space Share "Excel" (.xls = HTML tables) | out | `exportReportXls` | | Ported as CSV (UTF-8 BOM, opens in Excel) + printable PDF report |
| Phiếu Dựng PNG (1240 px canvas) and print/PDF (popup window) | out | `buildSheetCanvas`, `printSheet` | | Rebuilt (one HTML document → print/PDF, PNG, clipboard) |
| Space Share PDF report | **missing** | — | | **New** |

### 2.6 Analysis

| Feature | Existing | Algorithm found | Rebuild status |
|---|---|---|---|
| Space Share positions: every stock object, linear = Spaceman HorizSpace when known else x-extent; facings = n.x; area = linear × depth; stock = units | ✓ | `rpPositions` | Ported + parity tested |
| Aggregation by any product field (maker, brand, cat, sub, seg, pkg, ml, form, DescA–L, SubSegment, String1–3); only dims that vary are offered | ✓ | `rpAgg`, `RP_DIMS`, `rpVal`, `rpNorm` | Ported + tested |
| Metrics Linear / Facings / SKU / Area / Stock; focus group; scope filter (dim = value); baseline; multiple POGs; include/exclude; colours (SPVB = blue, KO = red, OTHER grey) | ✓ | `renderReport`, `rpColors` | Ported (redesigned workspace) |
| Comparison cards, 100 % stacked bars, share table with Δ pp vs baseline, shelf map coloured by group, focus share by scope values, SKU changes (new/removed/more/fewer facings) | ✓ | `renderReport`, `rpMap`, `rpSkuChanges` | Ported (redesigned) |
| Current ↔ proposal compare (KPIs, share by maker/brand, change list, CSV) | ✓ | `showCompare` | Merged into Space Share compare |
| Auto POG proposal: CDT zone → vertical blocks; order (CDT/current); traffic flow; focus first; snap block edges to bays; golden zone; big packs to bottom; facings by sales/current/equal within min–max; stack option; scenarios A (current share) / B (sales fair share) / C (target share); target form upload/template; dropped SKUs & warnings; result added to Space Share | ✓ | `apShelves`, `apCurrent`, `apShares`, `apOrder`, `apBounds`, `apLayBlock`, `apBuild`, `openAutoPOG` | Ported + parity tested |

### 2.7 Operations — Phiếu Dựng

| Feature | Existing | Notes | Rebuild status |
|---|---|---|---|
| Preview (3D snapshot, fallback colour map) | ✓ | uses `snapshotPNG('persp')` | Ported |
| Four summary metrics: total facings, linear cm, SKU count, preset | ✓ | Preset reads `D.meta.preset` which never exists → always "—" (bug) | Fixed |
| Display type ụ / kệ / GE with POSM templates per type | ✓ | `POSM_TEMPLATES`, `DISPLAY_LABELS` | Generalised to a display-type registry (+ Plug-in, Kệ Ốp Cột, Tủ Lạnh Mở, Other) |
| Price scorecard: normal / promo per SKU, manual entry | ✓ | stored in `D.sheet.prices` | Prices now default from master data, overrides kept per project |
| POSM checklist (type, location, qty; reset to template; add/remove) | ✓ | `D.sheet.posm` | Ported |
| TOT "Mua X thùng [Brand] tặng Y [quà]" (gift list: Thùng đá, Bình đá, Bộ chén đĩa, Ly giữ nhiệt, Bình giữ nhiệt) | ✓ | `D.sheet.tot` | Ported |
| Picking list (code, name, brand, form, facings, linear) | ✓ | | Ported + units to pick (from BOM) |
| Signatures: Người lập (prepared by), Người dựng (installer), Kiểm tra / Account | ✓ | | Ported (names editable) |
| PNG export, A4 print/PDF, persistence inside the design (`D.sheet`) | ✓ | sheet edits bypass undo **and do not trigger autosave** (bug) | Fixed: edits are undoable commands and autosaved |

### 2.8 Persistence

| Item | Legacy | Rebuild |
|---|---|---|
| IndexedDB `smart-pallet-7` v2: `kv` (`autosave`, `catalog`, `masterVer`, `imgpool`, `nexus:pid_counter`, `nexus:migration_v2`, `autosync:*`), `assets` (dataURL by hash id), 9 master stores | single autosave slot (700 ms debounce) | New DB `nexus-pog` with `projects` (many projects, recent list), `catalog`, `assets`, `kv`; autosave per project |
| localStorage `sp7:lang`, `sp7:strict`, `sp7:rp` (report settings), `sp7:ap` (auto POG settings) | | `nexus:prefs` (UI prefs only) |
| Origin | `file://` page | `http://localhost` (dev) / built `index.html`. The legacy IndexedDB is **not readable** from a different origin → legacy data moves through project JSON files (see `ARCHITECTURE.md` §Migration) |

### 2.9 Keyboard & mouse (legacy)

| Input | Action |
|---|---|
| Esc | exit measure → cancel library drag → cancel drag → cancel quick build → close modal → blur field → clear selection |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | undo / redo |
| Ctrl+S | save project JSON |
| Ctrl+Shift+E | export .plnx |
| Ctrl+D | duplicate to the right |
| Alt+← → ↑ ↓ / Alt+PgUp | duplicate left / right / back / front / on top |
| Ctrl+C / Ctrl+V / Ctrl+A | copy / paste (offset right) / select all unlocked visible |
| ← → ↑ ↓ (Shift ×10), Ctrl+arrows | nudge X/Z 1 cm |
| PgUp / PgDn (Shift ×10) | raise / lower 1 cm |
| Shift+← / Shift+→ | facings − / + |
| 1–9 (multi-digit within 900 ms) | set facings |
| Shift+↑ / Shift+↓ | stack + / − |
| Delete / Backspace | delete unlocked selection |
| R / Shift+R | rotate +step / −step |
| F | frame selection / all |
| M | measure tool |
| H | hollow shell dialog |
| Drag object / Ctrl+drag / Alt while dragging | move / copy / snap off |
| Shift+click | toggle selection |
| Drag empty | marquee (Top/Front/Side), orbit (3D) |
| Right / middle drag, wheel | pan, zoom (to cursor in ortho views) |
| Double-click empty / library card | frame all / quick add |

## 3. Business rules that must not change

1. Quantities are counted **from the scene model only**; an array is one object and the BOM counts it from its parameters; splitting replaces it in one undo step (no double counting).
2. Converted units: `unit` = 1; carton/pack = `units` when known, otherwise "unknown" (never guessed in the BOM). Families add up only SKUs with an explicit family key.
3. POSM boards and props are never stock and never supports. Decorative cans printed on artwork are never counted.
4. Linear for Space Share = Spaceman HorizSpace when the position came from a .plnx, else x-extent; stacked positions count their own linear (Spaceman rule).
5. Shelf metric share = SKU linear / used linear; `shareTotal` = / total shelf linear.
6. Days of supply = converted units / (weekly sales / 7), only when sales > 0 and every unit is known.
7. Sales are stored per design (sales differ per store) keyed by `poolKey(code)` (code without leading zeros) in single units per week.
8. Shelf height on PDF import = tallest product on the shelf below + 4 cm clearance + thickness, rounded up to the notch pitch; printed heights ("chieu cao") win. GO!/mini go: shelves numbered from the bottom, positions from the right (unless flow is LTR); Lotte: shelves from the top, positions from the left.
9. Bay is widened when products do not fit (`autoW`), rounded up to 5 cm; overflows are reported.
10. Auto POG: blocks narrower than max(15 cm, 1.6 × median product width) are merged with neighbours; boundaries snap to bay edges within 12 cm when ≥15 cm from the previous edge; big = height ≥ `big` cm or carton → bottom shelves; others to golden zone (mid of the shelf's first 40 cm of clearance inside [gz0, gz1]); each shelf filled edge to edge (max 2×fmax facings).
11. Catalog merge from .plnx: real sizes replace only estimated (≈) ones; unknown codes are added; placeholders 4×6×2 ignored.
12. Image pool keys ignore leading zeros; newest pictures win on refresh; bottom face is ignored.

## 4. Defects and gaps found in the legacy code

| # | Where | Defect | Rebuild action |
|---|---|---|---|
| 1 | Phiếu Dựng | "Preset" badge reads `D.meta.preset` (never set; preset lives in `D.settings.preset`) → always "—" | Fixed: resolves pallet preset name, or gondola bay count/size |
| 2 | Phiếu Dựng | price/POSM/TOT/name edits mutate `D` directly: no undo step and **no autosave** until another edit happens | Fixed: commands + autosave |
| 3 | Phiếu Dựng | prices are manual only; `k.priceNormal` is read but never exists | New master pricing with per-project override |
| 4 | AutoSync catalog | creates SKUs with `id` = raw EAN (catalog ids are `c:<code>`) and `form:'bottle'` (not a valid form) → duplicates and broken BOM conversion | Not ported; catalog import uses the tested `rowsToItems` path |
| 5 | AutoSync catalog | `.xlsx` requires a global `XLSX` (SheetJS) that is not bundled → always fails | Not ported; built-in XLSX reader used |
| 6 | Master data | PID records duplicate catalog fields and drift (catalog edits never update `productMaster`) | PID now stored on the catalog SKU itself; identifiers kept beside it |
| 7 | Report | settings persisted to localStorage but loaded POGs are lost on reload | POG sets are saved in the workspace (IndexedDB) |
| 8 | Single autosave slot | opening a file silently replaces the only autosave (only undo history protects it until reload) | Multiple projects with a recent list |
| 9 | `collisionGuard` | the filter `others.filter(q=>isStock(q.o)||!isStock(o)||true)` is always true (dead condition) | Ported with the same effective behaviour, dead condition removed |
| 11 | `shelfMetrics` | a facing block standing across two shelf segments (e.g. over the joint between two bays) adds its facings once per segment → facings double-counted in metrics, status bar and the Phiếu-Dựng-adjacent shelf share (linear is split correctly) | Fixed: facings count once, on the segment with the largest overlap; single-segment blocks unchanged (parity tests still pass) |
| 10 | Tết 2027 / Warehouse stacking / compliance / competitor / price tags | not present in code | Module boundaries + honest "planned" screens; no invented rules |

## 5. What is *not* in the repository

- The **Tết 2027 business plan** and its four open clarification questions are not in the repository. The rebuild creates
  the `tet2027` module with configurable inputs only; the four questions must be supplied by VBH (see `REBUILD_PLAN.md` §Open questions).
- No sample `.plnx`, POG PDFs, catalog files, sales files or saved projects were supplied. Import paths are tested with
  synthetic fixtures generated by the test suite (and, for parity, with designs built inside the legacy app itself).
