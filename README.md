# Nexus POG by VBH — v2 (rebuild)

Planogram editor, Space Share analysis and build sheets for SPVB retail execution. Local-first: runs entirely in the
browser, data stays in this computer's IndexedDB.

The previous single-file app (`Nexus_POG.html`) is kept unchanged as the behavioural reference.

## Run

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build        # static app in dist/ (serve with any static server: npm run preview)
```

## Verify

```bash
npm run typecheck
npm test                 # unit + parity tests (parity fixtures come from the legacy app)
npm run parity:capture   # re-record legacy reference outputs (needs Chrome / Edge installed)
npm run e2e              # browser smoke test against the dev server (needs Chrome / Edge)
```

## Bringing work from the old app

Open `Nexus_POG.html` → **Lưu** (saves a `.json` with images) → in the new app **Planograms → Nhập → Project**.
Schema-7 files, V6 projects and V6 libraries are converted with a migration report.

## Documentation

- `docs/rebuild/LEGACY_FEATURE_AUDIT.md` — every legacy feature, where its rule lives, and its status
- `docs/rebuild/REBUILD_PLAN.md` — phases, parity strategy, open business questions
- `docs/rebuild/ARCHITECTURE.md` — layers, state, persistence, migration, testing
- `docs/rebuild/DESIGN_SYSTEM.md` — tokens, components, the chosen direction
- `docs/rebuild/REBUILD_STATUS.md` — what is done, verified, deferred, and open
