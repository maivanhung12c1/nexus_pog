# Rebuild status — Nexus POG 2 (2.0.0-alpha.1)

Status as of 2026-11-03. Everything below was built and verified locally (Windows 11, Node 20.12, Chrome 156).
The legacy `Nexus_POG.html` is untouched and still runs; it is the parity reference.

## A. Rebuild status

| Area | Status | Notes |
|---|---|---|
| Domain model, geometry, undo/redo, collision guard | Done, parity-tested | Same diff-based undo as legacy; build sheet edits are now undoable too |
| POG editor (3D/Top/Front/Side/splits, drag & drop, snapping, auto-rest, marquee, Ctrl+drag copy, rotation, measuring, dimensions, ruler) | Done, e2e-tested (core paths) | three.js 0.170, instancing per SKU, fast matrix path while dragging |
| Gondola / shelf system (bays, notch pitch, riders, pack/spread/fill depth, facing/stack/depth limits, bay resize/delete, add shelf) | Done, parity-tested | |
| Pallet display (presets, quick build row/grid/block, steps/pyramid, split, hollow shell, core fill, pallet resize) | Done, parity-tested + e2e | |
| Validation (overlap, height, support, overhang, units, ≈ sizes, suspect cartons) | Done, parity-tested | Identical messages (vi/en) |
| SKU catalog (SPVB master 3,300 SKUs, merge on version, edit drawer, search/filters, windowed table, images, PIDs, identifiers, duplicate review) | Done, e2e-tested | Catalog generation is identical to legacy for all 3,300 rows |
| Master pricing (`priceNormal`, `pricePromo`) | **New**, done | In the catalog, CSV/XLSX import columns, flows into build sheets with per-sheet override |
| Spaceman `.plnx` import / export / preflight | Done, parity + round-trip tested | Exported XML is byte-identical to the legacy builder for the same design |
| POG PDF import (GO!/mini go, Lotte; heights; flow; drawing measurement) | Done; text parser parity-tested; import e2e-tested with a generated PDF | Drawing measurement (sizes + picture crops) needs a real retailer PDF to verify |
| Batch PDF → .plnx zip | Done (not e2e-tested) | |
| JSON projects (new schema 8; opens schema 7, V6 project, V6 library) | Done, tested | Migration report lists kept / repaired / placeholder fields |
| CSV/XLSX catalog & sales import, BOM CSV, PNG (3D/Front/Top/labelled POG sheet) | Done | Sales parsers unit-tested |
| Space Share workspace (POG set, group by any field, 5 metrics, focus, scope, baseline, deltas, shelf map, SKU changes, CSV) | Done, parity-tested + e2e | |
| Space Share PDF report | **New**, done | Print-ready A4 document → browser "Save as PDF" |
| Auto POG proposal (CDT, vertical blocks, golden zone, scenarios A/B/C, targets form) | Done, parity-tested (all scenarios) + e2e | Results become projects and enter Space Share with the current POG as baseline |
| Phiếu Dựng (preview, 4 KPIs, price scorecard, POSM, TOT, picking list, 3 signatures, PNG, A4 print/PDF, clipboard) | Done, e2e-tested | Display-type registry incl. Plug-in, Kệ Ốp Cột, Tủ Lạnh Mở, Other |
| Quick share (copy image for Zalo, PNG, print/PDF) | **New**, done | Clipboard needs a secure context (localhost / https) |
| Competitor catalog | **New**, foundation done | Real view over the master's manufacturer field; own maker + main competitor configurable |
| Compliance (proposed vs actual) | Partial | Design-vs-design comparison works; photo recognition not built |
| Field mode (phone) | **New**, done | Picking checklist, layout, build sheet, read-only |
| Tết 2027 Auto Build | Boundary only (honest planned screen) | Business rules + the 4 open questions not supplied |
| Warehouse stacking (PF-1 / PF-4) | Boundary only | Pattern definitions not supplied |
| Price tag generator | Boundary only | Tag template / print size not specified |
| AutoSync (File System Access re-sync) | Not ported | Legacy version was defective (see audit #4–5); manual import replaces it |
| Retailer mappings / listings / sell-out stores (legacy IDB) | Not ported | Declared but unused in legacy |
| Performance benchmark page | Not ported | |

## B. Functional parity

**Preserved (same algorithm, verified against the legacy app):** catalog generation (form, units, size estimates, colours) for all 3,300 master rows; shelf metrics; BOM; checks; space-share positions and aggregation; Spaceman preflight; Spaceman XML (byte-identical); Auto POG scenarios A/B/C and the keep-order/RTL/stack variant; pack left/right/spread; fill depth; notch snapping; riders; facing/stack/depth limits under the strict collision guard; hollow shell (3 variants) + apply + BOM; explode / split levels / undo; GO! and Lotte PDF text parsing; V6 migration.

**Preserved (ported, exercised in the browser, not compared numerically):** editor interaction model and keyboard map, library drag with ghost, quick add, POSM boards / props, sales import UI, compare current ↔ proposal, SKU-sizes panel, POG sheet PNG.

**Improved:**
- Many projects with a recent list (legacy: one autosave slot overwritten by every open).
- Build sheet: prices from master data, edits undoable and autosaved, preset badge fixed, installer/checker names, units to pick, field checklist.
- Facings of a block straddling two bays no longer double-counted (legacy defect #11).
- Space Share sets persist across sessions; PDF report; CSV export.
- Collision blocks explained in a toast; keyboard focus returns to the canvas after a library drop.
- New design system, information architecture and phone views.

**Intentionally deferred:** Tết 2027 rules, warehouse PF patterns, price-tag template, photo compliance, AutoSync, retailer mapping stores.

**Not yet migrated:** the legacy IndexedDB contents (different origin; projects move via the legacy app's "Lưu" .json, catalog edits are carried inside those files), the performance benchmark page.

## C. Architecture

`src/domain` (pure TypeScript business rules, Node-tested) ← `src/infra` (zip, CSV, XLSX, PLNX, PDF, IndexedDB, project files) ← `src/app` (stores: session with undo/autosave, catalog, workspace, prefs, editor UI; commands; IO workflows) ← `src/render` (three.js viewport, interaction, snapshots, canvas documents) ← `src/ui` (design system, shell, screens). No cycles; the domain imports nothing from the other layers. The legacy global `D` became a `Scene` object wrapping one design, so the ported algorithms keep their arithmetic. Details: `ARCHITECTURE.md`.

## D. Design system

"Framed sheet" app style from taste-skill (seed 1890638811): a tinted blue-grey L-frame, the work on one white sheet, colour only on data — the planogram's own product colours, the focus maker in SPVB blue, the main competitor in red. IBM Plex Sans (bundled, works offline) with Plex Mono only for codes. The editor follows the builder pattern (library | canvas well | inspector + status strip). Signature element: the shelf strip, a miniature front elevation on project rows and results. Details: `DESIGN_SYSTEM.md`.

## E. Test results (2026-11-03)

```
npm run typecheck   → OK (tsc strict, 0 errors)
npm test            → 2 files, 42 tests passed (17 parity vs legacy + 25 unit)
npm run build       → built in ~4 s (dist/: app 1.43 MB + pdf.js 0.34 MB + worker 1.38 MB)
npm run e2e         → 21/21 steps passed in headless Chrome, 0 console errors:
  boot · create gondola · drag SKU onto shelf · facings/stack via keyboard with shelf limit · undo/redo ·
  view switching · autosave + reload · export menu · inspector shelf ops · build sheet · Space Share ·
  catalog search · phone width (no horizontal scroll) · .plnx + .json real downloads · .plnx re-import ·
  .json re-open · POG PDF import (generated GO! PDF) · Space Share PDF report · master price → build sheet ·
  Auto POG scenarios · pallet display + hollow shell
taste-skill lint --app src/ui → 0 FAIL, 15 WARN (mono for codes, floating-layer shadows, data dashes — kept on purpose)
```

The taste-skill browser inspector (`inspect.mjs`) needs Node 22 and was not run; screenshots from the e2e run
(`tests/e2e/out/*.png`) were reviewed instead and three layout issues found that way were fixed.

## F. Remaining work

**Bugs / gaps known**
- POG PDF drawing measurement and picture cropping are ported but unverified without real GO!/Lotte PDFs.
- Batch PDF, image-pool folder/ZIP loading, sales-import UI and the labelled POG sheet PNG are not covered by automated tests.
- Copy-to-clipboard requires a secure context; opened from `file://` it falls back to "use Download PNG".
- Very large scenes (>2,000 instances) have not been benchmarked in the new renderer.

**Technical debt**
- The main bundle is 1.4 MB (three.js + master catalog); split the master JSON and the editor into lazy chunks.
- Several screens are long single files (`Inspector.tsx`, `dialogs.tsx`); split per object type when they grow.
- UI strings use inline `L(vi, en)` like the legacy app; move to dictionaries if more languages are needed.
- No git history yet — the repository is not under version control.

**Business decisions needed (not invented)**
1. Tết 2027 plan and its four open clarification questions.
2. PF-1 / PF-4 stacking patterns, load limits, interlocking rules.
3. POSM templates for Plug-in, Kệ Ốp Cột, Tủ Lạnh Mở.
4. Whether master prices include VAT; price per selling unit vs per single unit.
5. Price-tag template and print size.
6. Official retailer fixture standards to replace the assumed presets.

**Future features**
Photo-based compliance, Tết 2027 wizard logic, warehouse auto stacking, price tags, competitor price/space history, multi-user sharing (deployment is out of scope for this phase).
