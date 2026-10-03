# Paper 04 chrome resume: result (3 Oct)

Paper file `01M3VHFY502GXVVB8RJ9VW1QBH`. The brief `paper-04-chrome-resume.md` was not on disk; work followed the "Pending" list in `2026-10-01-canvas-design-decisions.md`.

**Paper MCP calls: 32 of the ~35 cap.** Session 1: 11. Step 0 (`get_tokens`): 1 (12). Step 1: 10 (22). Step 2: 10 (32). `finish_working_on_nodes` is included in the 32. No work is left unfinished.

## Step 1: fixes (done, read back with `get_computed_styles`)

| Fix | What changed |
| --- | --- |
| Exit-tile line-heights | All four frames. "See them all" → `--leading-xs` (16px), "in Bangkok · Art & C…" → `--leading-sm` (18px); "All 312 →" already `--leading-tight`. |
| Dividers → `line-strong` | Top-bar divider (Desktop Default, Desktop Search open), mobile bottom-sheet divider, plus the 9 result-row separators. The separators are a judgment call (easy to revert). Top-bar hairlines, panel/field outlines and minimap cell outlines stay `--color-line`. |
| Panel width token | `--container-panel` = 360px (new). Bound to Bucket search (Desktop Default and Desktop Search open) and Search results. |
| Mobile search width | No panel token. It is `align-self: stretch` inside the bottom sheet (16px inline padding), so it is full-width by design. |
| `overlay` contract text | Page 01 caption "Photo scrim base" → "Any dimming layer". |

## Step 2: swap regression (passed)

Originals (call 12, hash `1466f1d5`): `--color-accent` #1E5BD6 · `--color-ink` #081C3A · `--color-surface` #F7F8FC · `--font-sans` Inter · `--radius-lg` 12px.

Swapped to accent #FF00AA, ink #FF6A00, surface #FFF200, font-sans Fraunces, radius-lg 37px. Searched the whole file (all pages) for the five original literals. **Hits: none.** Positive control: searching #FF00AA found 17 nodes bound to `--color-accent`, so the search does work. Border widths and page 01 line-heights are exempt.

Limit: the colour and font/radius searches match computed values on any property; I did not sample ink/surface/font/radius positive controls separately.

Restored all five straight after. `get_tokens` shows hash `1466f1d5` again and every value matches the originals. No sentinel left in the file.

## Step 3: for `/architect`

**(1) Step 1 token names.** Leadings: `--leading-xs` 16px, `--leading-sm` 18px, `--leading-tight` 115%. Caption heights: `--container-caption-sm` 14px, `--container-caption-md` 57px, `--container-caption-lg` 68px. Panel: `--container-panel` 360px. Caption tokens are used in all four frames of 04 Chrome (the search hit list was truncated at 200, so usage is shown per tier, not counted). `--leading-xs`/`--leading-sm` are used by the exit tile in all four frames.

**(2) Caption arithmetic** (title clamped to 2 lines on lg and md, 1 on sm; 4px gap):

| Tier | Formula | Value |
| --- | --- | --- |
| lg | 2 × (`--text-lg` 20 × `--leading-tight` 1.15 = 23) + 4 + `--leading-sm` 18 | 68 |
| md | 2 × (`--text-base` 16 × 1.15 = 18.4) = 36.8 (renders 37) + 4 + `--leading-xs` 16 | 57 |
| sm | 1 × (`--text-xs` 12 × 1.15 = 13.8, renders 14) | 14 |

The md and sm values round up from fractional line boxes. Spec them as the token values, not the formula.

**(3) Clearance.** Ran `~/dev/canvas-Gallery/atlas-cluster/cluster.mjs` locally against `chrome/tokens-step1.json` (caption tokens match Paper's current values) and the sample `tours-bkk-ac.json` (60 tours, 15 at 1:1, 45 at 3:2). Output went to the scratchpad, not the canvas-Gallery files. The 6px minimum **holds**: minimum measured clearance **10.61px**, violations none, out of bounds none, no tile straightened. Artboard 2400×1624, exit tile at (2112, 1416). This is one sample of one bucket, not a guarantee for every bucket.

## Not done / caveats

- Not screenshotted: Desktop Default, Mobile Default, Mobile Sheet open (only Desktop Search open was, to save calls). Fixes were read back with `get_computed_styles` instead.
- Untracked `swap-test/` exists in canvas-Gallery (not mine, not touched).
