# Design system — Nexus POG 2

Built with the `taste-skill` app-screen run (`references/app-screens.md`), style dealt with
`draw.mjs --app --kind builder --screens builder,analytics,list,report --theme light` → **Framed sheet**
(seed 1890638811, `.taste-skill/app/direction.json`). No redraws.

## Why this direction fits Nexus POG

- People work in it for long sessions (planners building a gondola) and for short field glances (an installer checking
  a build sheet). A quiet light frame with one white sheet keeps the planogram itself — which is full of product
  colours — as the only loud thing on screen.
- The style's colour budget (<3 %, colour on data only) matches the product: the data **is** colourful (brand hues
  on facings, manufacturer shares). Chrome stays grey so a Pepsi-blue facing or a red KO share is never confused with UI.
- "Builder" pattern (palette + canvas well + inspector) is the editor; "analytics with share tables" is Space Share;
  report and list screens are composed from the house rules.

### Its face (chosen)

1. **The SPVB blue as the one data hue** (`--chart-1: #1f5aa6`): the focus manufacturer's share, the selected POG,
   the main series. Taken from the legacy brand colour for PEPSI (`#1f4fa3`) lifted slightly for contrast (6.6:1 on white).
   It is a blue, not violet/indigo.
2. **The frame tinted blue-grey** (`--ground: #f5f7fa`) — one low-chroma step of that hue; the sheet stays white.
3. **IBM Plex Mono for codes only** (EAN/SKU codes, PIDs, fixel ids like `2/4`). Figures in tables use Plex Sans tabular.

### Signature element — the shelf strip

A miniature front elevation of a planogram drawn from its real positions (each facing block a rectangle at its true
x/y, coloured by manufacturer: focus in `--chart-1`, the largest competitor in `--chart-competitor`, the rest in greys).
It appears on project rows (home), on POG chips and comparison rows (Space Share), and on the build sheet. It is the one
element only this product has: a planner recognises a planogram by its silhouette.

## Tokens

```css
:root {
  --ground: #f5f7fa;   --surface: #ffffff;  --raised: #f2f4f7;  --active: #e8ebef;   --well: #eef1f5;
  --border: #e5e8ec;   --rule: #eef0f3;     --control: #c9ced5;
  --text: #131416;     --muted: #5b6068;    --faint: #6b7078;
  --accent: #1f5aa6;   --primary: #1b1d20;  --primary-ink: #ffffff;
  --positive: #1e7b4f; --negative: #c4242a; --warning: #92400e;
  --chart-1: #1f5aa6;  --chart-competitor: #c4242a;  --chart-2: #2f70bb; --chart-3: #a86f0c; --chart-muted: #c3c9d1;
  --pill-positive-bg: #dcfae5; --pill-positive-ink: #04250e;
  --pill-negative-bg: #ffedea; --pill-negative-ink: #831c1e;
  --pill-warning-bg:  #fffbeb; --pill-warning-ink:  #92400e;
  --pill-neutral-bg:  #ebedee; --pill-neutral-ink:  #353736;
  --radius-sheet: 16px; --radius-card: 8px; --radius-control: 6px; --radius-chip: 4px;
  --sheet-inset: 8px;  --sidebar-width: 228px; --topbar: 48px;
  --gap: 24px;  --pad: 24px;  --control-height: 32px;  --row-height: 44px;
  --fs-title: 22px; --fs-section: 16px; --fs-kpi: 28px; --fs-body: 14px; --fs-small: 12px;
  --font: "IBM Plex Sans", system-ui, sans-serif;  --mono: "IBM Plex Mono", ui-monospace, monospace;
}
```

Contrast: `--text` 17.8:1, `--muted` 6.3:1, `--faint` 4.9:1 on white; `--accent` 6.6:1. Every word on screen ≥ 4.5:1.

## Typography

| Role | Size / weight | Notes |
|---|---|---|
| Page title (h1) | 22 / 600 | a noun: "Planograms", "Space Share", the project name |
| Section heading | 16 / 600 | one grey 14px sentence under it when it helps |
| KPI value | 28 / 400, tabular | label 12 / 500 grey above it |
| Body, table cells, nav | 14 / 400 | |
| Labels, meta, axis | 12 / 400–500 | never below 11 |
| Codes | 13 Plex Mono | IDs only |

Sentence case everywhere. No tracked capitals. Weights 400/500/600 only.

## Spacing, borders, elevation

- 4 px base. One gutter (`--gap` 24) between blocks; 12 inside dense editor panels.
- Surfaces separate by one tone step or a 1 px `--border`, never both, never a shadow at rest.
- Shadows only on what floats: menus, popovers, dialogs, drawers, toasts (`0 12px 32px rgba(16,24,40,.14)`).
- Radius is tight: controls 6, cards 8, the sheet 16. Chips 4.

## Components

| Component | Rules |
|---|---|
| Button | 32 px. **Primary**: near-black fill, white label — one per screen. **Secondary**: white, 1 px `--control` border. **Ghost**: text only, grey hover fill. **Danger**: red text, outlined. Icon buttons 32×32 with `aria-label` and a tooltip. |
| Fields | Label above (12/500), 32 px input, white, 1 px `--control`, focus ring 2 px `--accent` at 35 %. Units as grey suffix inside the field ("cm"). |
| Select / Segmented | Segmented as wide as its options; selected = white pill on `--raised` track. |
| Tabs | Underline tabs on a full-width rule; active = 2 px ink underline + 600 label. |
| Tables | 12 px grey sentence-case headers, no fill band; 44 px rows, `--rule` row lines, numbers right-aligned tabular; identity column widest; missing = grey "—"; real zero printed. Sticky header in long lists; windowed for >200 rows. |
| Pills | 20 px, pale tint + dark ink of the same hue; one status mark per row. |
| Drawer | Right-side, 440 px, for editing one object (SKU, preset) without leaving the list. |
| Dialog | Only for confirmations and imports that need a decision (≤ 640 px). |
| Menu / popover | White, 1 px border, shadow, 8 px radius, 32 px items. |
| Toast | Bottom centre, near-black, 2.6 s; danger variant red. |
| Empty state | Keeps the block's frame and header; one sentence and the first action ("No products on this shelf yet. Drag a SKU from the library."). |
| Loading | Final layout with grey bars at real sizes, no shimmer. |
| Error | Inside the block that failed: one sentence + "Try again". |

## Navigation & shell

- **Tinted L-frame**: 228 px sidebar + 48 px top bar on `--ground`, no rule between; the page on a white sheet inset 8 px
  right and bottom, 16 px radius, 1 px edge, no shadow.
- Sidebar: product mark + "Nexus POG", then groups — **Work** (Planograms, Space Share, Build sheets), **Data**
  (Catalog, Competitors, Presets), **Automation** (Auto POG, Tết 2027, Warehouse stacking, Compliance, Price tags).
  Active item: neutral grey pill. Planned modules carry a quiet "Planned" pill — they open honest boundary screens.
- **Editor exception (builder pattern)**: the editor replaces the global navigation with a 44 px project bar (back,
  name, save state, undo/redo, view switch, tools, Export menu, Share, Build sheet) and three panels on the ground:
  library (left), canvas well (centre), inspector (right), plus a 32 px status strip (snap, warnings, counts).

## Data visualisation

- One hue per chart; the focus manufacturer is `--chart-1`, the main competitor (`KO` by default) `--chart-competitor`,
  everything else on a grey ramp. Legacy's 12-colour rainbow is replaced by: focus blue, competitor red, three greys,
  and per-brand colours **only inside the planogram itself** (they are product colours, not chart colours).
- Share as 100 % stacked bars with 2 px seams, or as rows whose fill is the bar (one-figure lists).
- Deltas in percentage points with a sign; colour says good/bad for the focus group only; zero is grey.

## Phone / field mode

- The frame disappears; 48 px top bar (menu, title, one action). Editor routes open the read-only field view (front
  elevation + picking list) instead of the builder. Build sheets, picking lists and reports reflow to one column.
- Touch targets ≥ 44 px; tables become two-line lists below 640 px.

## States checklist (every block)

empty · zero · loading · error · hover · selected · focus · disabled (with a reason).
