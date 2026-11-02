# Rebuild plan — Nexus POG

## Goal

Rebuild Nexus POG as a maintainable, tested, local-first web application with a new information architecture and design
system, keeping every business capability of `Nexus_POG.html` (see `LEGACY_FEATURE_AUDIT.md`).
The legacy file stays in the repository, untouched, as the behavioural reference until parity is signed off.

## Technical choices (decided)

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | The legacy bugs are mostly shape errors (wrong field names, invalid enum values); types catch these. |
| Build | Vite 6 | Fast local dev, static output that runs from any static server or a file share; no backend. |
| UI | React 18 | Many independent panels, tables and forms; predictable re-render boundaries. |
| State | Small stores (`zustand`) + a mutable design document with a version counter | The legacy algorithms mutate the design in place; keeping that model lets them be ported line for line and verified, while React subscribes to the version. |
| 3D | `three` (npm) | Same engine as legacy (r149 → current); the instancing approach is kept. |
| PDF | `pdfjs-dist` | Same engine as legacy; worker shipped as a Vite asset. |
| Persistence | IndexedDB via a thin typed wrapper | Local-first, same technology as legacy, large capacity for images. |
| Tests | Vitest (unit, happy-dom) + Playwright with the installed Chrome (parity + smoke) | Business logic is tested headless; parity fixtures are produced by running the legacy file itself. |
| Fonts | IBM Plex Sans / Mono bundled (`@fontsource`) | Works offline. |

No server, no cloud, no telemetry. Deployment is out of scope for this phase.

## Phases

| Phase | Deliverable | Exit criterion |
|---|---|---|
| 0 Discovery | `LEGACY_FEATURE_AUDIT.md`, this plan | Every legacy feature listed with its algorithm and a rebuild status |
| 1 Architecture | `ARCHITECTURE.md` | Module map, state model, persistence, migration, testing defined |
| 2 Design system | `DESIGN_SYSTEM.md`, tokens, base components | Tokens + components used by every screen |
| 3 Shell | Navigation, workspace home, editor/catalog/analysis/operations/automation shells | All routes render with real (master) data |
| 4 Core POG engine | Domain geometry, commands, undo/redo, renderer, interaction | Unit tests + parity fixtures pass; editor usable |
| 5 Catalog | Catalog workspace, pricing, import/merge, images, PIDs, competitors view | Catalog tests pass |
| 6 Import/export | JSON, PLNX in/out, PDF, CSV/XLSX, PNG, batch | Round-trip tests pass |
| 7 Analysis | Space Share workspace, compare, Auto POG, scenarios, PDF report | Parity tests for share + Auto POG pass |
| 8 Operations | Phiếu Dựng, picking, POSM, TOT, signatures, print/PDF, PNG, clipboard quick share | Smoke test passes |
| 9 Future modules | Tết 2027 shell, warehouse stacking, compliance, price tags, field mode | Module boundaries exist; nothing pretends to work |

Phases 4–8 overlap in practice; the order above is the dependency order.

## Parity strategy

1. **Extract, don't reinvent.** Business functions are ported from the legacy source into pure TypeScript modules with
   the same names and the same arithmetic. Presentation code is not ported.
2. **Reference outputs from the legacy app.** `tests/parity/capture-legacy.mjs` opens `Nexus_POG.html` in headless Chrome,
   builds designs through the legacy `window.SP7` API (gondolas, facing blocks, shells, Auto POG scenarios, Space Share
   aggregations, BOM, checks, PLNX XML, PDF text parsing) and stores the results as JSON fixtures.
3. **Parity tests** run the new modules on the same inputs and compare (numbers to 0.01 cm, ids ignored).
4. **Round-trip tests** for file formats: design → .plnx → design; project JSON v7 → v8 → load.
5. Only after parity is green is a legacy behaviour considered "preserved" in `REBUILD_STATUS.md`.

## Data migration

- Legacy project files (`smart-pallet-scene` schema 7, `nexus-pog`) open directly; they are normalised to schema 8 with a
  migration report (unknown fields are kept under `legacy` and listed).
- V6 projects and V6 libraries keep the legacy V6→V7 adapter, then the 7→8 step.
- The legacy IndexedDB (origin `file://`) cannot be read by the new app. Users bring work across by saving each project
  from the legacy app (Lưu → `.json`, which embeds the SKU snapshots and images) and opening it in the new app; SKU
  snapshots are merged into the catalog exactly as the legacy `loadDesign` did. This is stated in the app's import screen.

## Open questions (business decisions — not invented)

These are recorded as configurable inputs in the app and must be answered by VBH:

1. **Tết 2027 Auto Build** — the business plan and its four open clarification questions were not provided in the
   repository. The wizard shell lists the seven planned steps; every step whose rule is unknown is an editable input marked
   "rule not confirmed".
2. **Own manufacturer for competitor analysis** — the master uses `maker = SPVB`; the app treats SPVB as "own" by default
   (as the legacy report and status bar did) and lets the user change it.
3. **Price units and VAT** — master prices are stored as VND per selling unit (the SKU's own pack form). Whether prices
   include VAT is not specified; the field is labelled neutrally.
4. **Warehouse stacking patterns PF-1 / PF-4** — not specified anywhere in the legacy code; only the domain boundary exists.
5. **Display types beyond ụ / kệ / GE** (Plug-in, Kệ Ốp Cột, Tủ Lạnh Mở) — POSM templates for them are not defined;
   they start with an empty POSM template that the user fills.

## Risks

| Risk | Mitigation |
|---|---|
| PDF import cannot be verified without real retailer PDFs | Parser tested on synthetic text pages that follow the legacy regexes; end-to-end check listed as remaining work |
| Spaceman compatibility of exported .plnx | Same templates and field writes as legacy; XML diff test against the legacy builder output |
| three.js API drift (r149 → current) | Colour management and encoding calls updated; visual check in the browser |
| Scope: the legacy app is large | P0 first; P2 modules are boundaries only; status tracked honestly in `REBUILD_STATUS.md` |
