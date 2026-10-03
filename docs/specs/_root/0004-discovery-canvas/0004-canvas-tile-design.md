# 0004. Canvas tile design (child of 0004 discovery canvas)

Scope row 15. Governed by [index.md](index.md). This spec fixes the rules that code and tests depend on. The visual direction is the designer's call and goes into `design.md`.

## Summary

A tile is a photo with a caption below it, in one of three tiers by rank: large (title, duration, price, rating), medium (title, duration, price), small (title only). Caption heights are fixed tokens (68, 57, and 14 px), so the layout never measures text. The exit tile is the only solid accent element. Hover is desktop only. The look itself (colour mood, texture, type pairing) is the designer's call, recorded in `design.md`, and this spec records where the visual source of truth lives.

## Requirements

**User stories**:
- As a visitor, I want the best tours to look bigger and say more so that I can spot them at a glance.
- As a visitor on a phone, I want a tap to open the tour straight away so that I do not need hover.
- As a designer, I want the tokens and rules in one place so that I can change the look without touching the layout.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-T1**: A tile's tier comes from its rank: 1 to 4 `lg`, 5 to 20 `md`, 21 to 50 `sm`. The tiers show: `lg` title, duration, price, rating; `md` title, duration, price; `sm` title only.
- **AC-T2**: The caption sits below the photo and is never overlaid on it. Caption height is fixed per tier: `lg` 68 px, `md` 57 px, `sm` 14 px, set as an explicit height with `overflow: hidden` and a title line clamp of 2, 2, and 1 lines. The height is never derived from line height.
- **AC-T3**: `apps/web/src/app/globals.css` defines `--container-tile-lg: 360px`, `--container-tile-md: 240px`, `--container-tile-sm: 168px`, `--container-caption-sm: 14px`, `--container-caption-md: 57px`, `--container-caption-lg: 68px`, `--container-panel: 360px`, `--leading-xs: 16px`, `--leading-sm: 18px`, and sets `--leading-tight` (115%), `--text-lg` (20px), and `--text-base` (16px) to the Paper values only inside a `.canvas-root` scope, so the rest of the site keeps Tailwind's defaults. Because `--container-*` feeds width utilities, caption heights are applied as `h-(--container-caption-md)` or an inline style, not as a width.
- **AC-T4**: A test asserts the three caption token values equal the constants the layout uses, so the CSS and the layout cannot drift apart.
- **AC-T5**: Hover and focus are desktop only: an accent outline plus an accent title. On touch devices there is no hover state and a tap opens the tour. Keyboard focus shows the same outline.
- **AC-T6**: The exit tile is 240 by 160 px (`md` 3:2), has no caption (its copy sits inside the tile), the only solid `accent` element on the canvas, and links through `exitHref`. Its copy is a single constant so the designer can change it.
- **AC-T7**: Every colour, font, and radius a tile uses comes from a theme token, never a literal. A swap test (change `accent`, `ink`, `surface`, `font-sans`, and `radius-lg` to loud values) restyles every sampled tile property. Border widths and line heights from page 01 are exempt.
- **AC-T8**: Shape and tier never come from the source image. The photo is cropped to the tile's footprint with `object-fit: cover`, and carries `alt=""` because the title is the link's accessible name.
- **AC-T9**: The visual direction is written to `design.md` by the designer. Tiles follow it, and where it disagrees with this spec's rules, this spec's fixed heights and tiers win until this spec is changed.
- **AC-T10**: Photos that fail to load show a neutral `surface` fill, the caption still renders, and layout does not move.

## Decision

**Chosen option**: Option 1: Fixed tier tokens with captions below the photo.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| Caption position | Below the photo | Legibility does not depend on the photo | Overlay with a scrim |
| Caption height | Explicit tokens 14, 57, 68 px | The md and sm values come from fractional line heights (36.8 and 13.8 px) that render rounded, so formulas would be fragile | Derive from line height |
| Tier contents | `lg` four fields, `md` three, `sm` title | Bigger tiles earn more words | Same content on all |
| Shape | Seeded per tour, about 30% 1:1 | A category driven shape would make a bucket uniform | By category or by duration |
| Hover | Desktop only, accent outline and accent title | Touch has no hover, so a tap is direct | A hover caption on touch |
| Exit tile | `md` 3:2, solid accent, the only one | One clear way out of a bucket | A quiet text link |
| Textures | None | Scrapped on 1 Oct | Texture packs |
| `accent-ink` | Untested until hover and pressed states exist in code | Cannot swap test a state that is not built | Test it now |

Caption arithmetic (for reference, not for code): `lg` is 2 × 23 + 4 + 18 = 68. `md` is 2 × 18.4 (36.8, renders 37) + 4 + 16 = 57. `sm` is 13.8, renders 14. Titles are clamped to 2, 2, and 1 lines.

## Feature design

**Data model sketch**: no data change. The tile props come from the feed tile (price, duration, rating, title, image).

**Visual source of truth**: Paper file `01M3VHFY502GXVVB8RJ9VW1QBH`. Page 01 holds the contract and tokens. Page "04 Chrome" holds four frames: Desktop Default, Desktop Search open, Mobile Default, Mobile Sheet open. The same file holds Bucket search and Search results frames. Tokens were read back on 3 Oct (token hash `1466f1d5`) and the swap test passed (208 of 208 sampled properties restyled). This spec reads no new values from Paper.

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Tile | title | feed tile `title` |
| Tile (`lg`, `md`) | duration | feed tile `durationMin`, formatted by one helper |
| Tile (`lg`, `md`) | price | feed tile `price`, shown as "from" plus the amount in USD |
| Tile (`lg`) | rating | feed tile `ratingAvg` and `ratingCount`, omitted when unrated |
| Tile | tier, shape, size | rank and tile id through `layoutBucket` (layout child) |
| Tile | caption height | fixed tokens (AC-T2, AC-T3) |
| Exit tile | copy | one constant, with `total`, city name, and `categoryLabel` from the bucket summary |
| Exit tile | link | `exitHref(city)` |

**Key invariants**:
- Caption height depends only on tier.
- Tile code holds no colour, font, or radius literal.

**Security model**: public, no user data. Titles come from the provider and are rendered as text, never as HTML.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: one tile per tier renders the right fields and the right caption height, verifies **AC-T1**, **AC-T2**
- Token parity: CSS token values equal the layout constants, verifies **AC-T4**
- Swap test: change the five brand tokens and check no tile property stays on an old value, verifies **AC-T7**
- Touch: on a touch viewport there is no hover state, a tap navigates, verifies **AC-T5**
- Failure case: a broken photo URL keeps the caption and the layout, verifies **AC-T10**

## Build plan

Slice 3 (the tile build itself starts in slice 1 as plain placeholders, then this slice finishes it):
1. Add the caption, leading, and panel tokens, and the three overrides, to `globals.css`, with the parity test, satisfies **AC-T3**, **AC-T4**
2. Build the tile component with three tiers, fixed caption heights, and the line clamps, satisfies **AC-T1**, **AC-T2**, **AC-T8**, **AC-T10**
3. Add hover and focus states (desktop only) and the exit tile, satisfies **AC-T5**, **AC-T6**
4. Run the swap test (a script that sets the five tokens to loud values and checks computed styles with Playwright) and fix any literal, satisfies **AC-T7**
5. The designer writes `design.md`, and the tiles are brought in line with it, satisfies **AC-T9**

## Consequences

**Positive**:
- Captions never reflow, so scrolling and layout stay stable.
- The look can change without touching placement.

**Negative / tradeoffs**:
- A long title is cut at two lines (one on `sm`) and the full title shows only on the tour page.
- The md and sm heights are rounded up, which wastes a pixel or so per tile.

**Neutral**:
- The old brief's "hover caption (`aiSummary` or title)" is replaced by the fixed caption below the photo, since the tile carries no `aiSummary`.

## Follow-up

- [ ] Designer: write `design.md` (visual direction).
- [ ] Designer: decide the exit tile copy, since "All N in {City} · {Category}" promises a category and count the unfiltered city page does not show.
- [ ] Designer: review the 9 search result row separators on `line-strong` (an unreviewed judgment call).
- [ ] Designer: confirm the city order, category order, and category labels in the world geometry (index.md).
- [ ] Test `accent-ink` for the swap test once hover and pressed states exist in code.

## Rationale

The layout must be a pure function, so caption height cannot depend on fonts. Fixed tokens plus a line clamp make height a constant per tier. Specifying the token values instead of the formulas avoids rounding bugs, since the md and sm numbers come from fractional line boxes. Seeding shape per tour keeps buckets from looking uniform, which a category rule would cause since a bucket is one category.
