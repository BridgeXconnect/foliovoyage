# 0004. Canvas navigation (child of 0004 discovery canvas)

> **Superseded 8 Oct 2026 (BRI-245).** The canvas view was shelved and removed. This sub-spec was never built. Kept for history; do not build from it.

Scope row 14. Governed by [index.md](index.md): the world geometry and the analytics events live there.

## Summary

Because the canvas pans but does not zoom, you need quick ways to travel. A minimap shows the six cities and their seven category slots and jumps the view when you pick one. A search over the bucket names does the same. The current position is kept in the page address as a bucket plus an offset, so a copied link reopens the same spot, even if slot sizes change later. On a phone the minimap and search sit behind one button.

## Requirements

**User stories**:
- As a visitor, I want a minimap so that I can see where I am and jump to another city.
- As a visitor, I want to type "rome food" and land on that bucket so that I do not have to pan far.
- As a visitor, I want to copy the address and have a friend land on the same spot.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-N1**: The minimap draws the 3 by 2 city grid and each city's 4 by 2 category slots from the shared world geometry, marks the current view rectangle, and moves the view to a bucket's slot when you pick it.
- **AC-N2**: Search matches the bucket labels (city name plus category label, at most 42) on the client with no network call. Text is lowercased and accent stripped (NFD), the query splits on spaces, and a bucket matches when every query token is a substring of its label, so "rome food" and "food rome" both find Rome's Food & Drink. Results are in world order, at most 8 shown. Picking a result moves the view to that bucket.
- **AC-N3**: A jump (minimap or search) centres the bucket's slot in the viewport. The view is centred when the viewport centre equals the slot origin plus (1200, 812). The move is animated unless `prefers-reduced-motion` is set, when it is instant. The target bucket's tiles are fetched on arrival.
- **AC-N4**: The position is written to the address as `/discover?at=<citySlug>.<categorySlug>&dx=<n>&dy=<n>`, where `dx` and `dy` are whole pixel offsets of the view centre from the slot origin. It is written with `history.replaceState`, only once panning settles (150 ms idle), and at most about twice a second.
- **AC-N5**: Opening a link with `at`, `dx`, and `dy` puts the view centre at that offset inside that bucket's slot. An unknown bucket slug, a missing value, or a non numeric offset falls back to the world start (Bangkok's first slot) with no error shown. Offsets are clamped to the world bounds. When the view centre sits in the spare cell, a gutter, or a bucket with no tiles, the writer uses the nearest listed bucket with an offset that may fall outside that slot.
- **AC-N6**: Below the Tailwind `md` breakpoint the minimap and search are collapsed behind one button and open as a bottom sheet. On desktop they show in the page chrome. Both follow the Paper "04 Chrome" frames (Desktop Default, Desktop Search open, Mobile Default, Mobile Sheet open).
- **AC-N7**: The search panel is 360 px wide (`--container-panel`) on desktop and full width on mobile. Result rows use the `line-strong` separator pending the designer's review.
- **AC-N8**: `canvas_nav_jump` fires on each jump with `from_bucket`, `to_bucket`, and `method`, through the analytics helper.
- **AC-N9**: The minimap and search are reachable and operable by keyboard, with a label on each control, and the sheet traps focus while open.

## Decision

**Chosen option**: Option 1: Minimap plus client search, with a bucket relative position URL.

| Decision | Pick | Why | Runner up |
|---|---|---|---|
| URL form | `at=<city>.<category>` plus `dx`, `dy` | Survives a later change to slot size or arrangement | Absolute world pixels |
| URL writes | `replaceState` after panning settles | No history spam, no jank while panning | `pushState` on every move |
| Search | Client side over up to 42 labels | Tiny list, instant, offline of the API | A server search |
| Minimap | Drawn from the geometry as plain SVG or divs | No new dependency, exact | A rendered thumbnail of the world |
| Mobile | One button, bottom sheet | Screen is small, decided on 1 Oct | Always visible chrome |

## Feature design

**Data model sketch**: no data change. The minimap and search read the bucket summaries already loaded for first paint and the geometry from `@folio/shared`.

**API surface**: none. The page reads the bucket summaries from `GET /v1/canvas/buckets` (feed child).

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| Minimap | cell positions | world geometry in `@folio/shared` |
| Minimap | view rectangle | current view offset and viewport size |
| Minimap and search | labels | `categoryLabel` and city `name` from the bucket summaries |
| Search | bucket list | the 42 summaries (buckets with no tiles are not listed) |
| Jump | target view offset | slot origin from the geometry plus (1200, 812), minus half the viewport |
| URL write | `at`, `dx`, `dy` | the bucket under the view centre and the centre's offset from its slot origin |
| URL read | view centre | slot origin of `at` plus `dx`, `dy`, clamped to the world |

**Key invariants**:
- The URL never holds an absolute world coordinate.
- A bad URL never shows an error, it falls back to the world start.
- Search needs no network.

**Security model**: public, no user data. URL values are parsed as strings and numbers only and never inserted as HTML.

**Configuration required**: none.

**Critical test scenarios**:
- Happy path: picking Rome on the minimap centres Rome's first slot, verifies **AC-N1**, **AC-N3**
- Happy path: "rome food" finds the bucket and a pick jumps there, verifies **AC-N2**
- Round trip: pan, copy the address, open it in a fresh tab, and the view centre matches within 1 px, verifies **AC-N4**, **AC-N5**
- Failure case: `at=narnia.food` and `dx=abc` fall back to the world start, verifies **AC-N5**
- Mobile: the controls collapse behind one button and open a sheet, verifies **AC-N6**

## Build plan

Slice 2 (all six cities):
1. Position URL read and write, with the fallback rules and the round trip test, satisfies **AC-N4**, **AC-N5**
2. Minimap from the shared geometry, with the jump, satisfies **AC-N1**, **AC-N3**
3. Client search over the bucket labels, satisfies **AC-N2**, **AC-N7**
4. Desktop chrome and the mobile sheet, with keyboard and focus handling, satisfies **AC-N6**, **AC-N9**
5. The `canvas_nav_jump` event through the analytics helper, satisfies **AC-N8**

## Consequences

**Positive**:
- Shared links keep working through later layout changes.
- No server work and no new dependency.

**Negative / tradeoffs**:
- A link depends on the slug map staying stable, so renaming a slug breaks old links (they fall back to the world start).
- A bucket that later loses all its tiles also disappears from search and from old links.

**Neutral**:
- The empty eighth slot in each city is on the minimap as an empty cell and is not searchable.

## Follow-up

- [ ] Designer: review the 9 search result row separators on `line-strong`.
- [ ] Confirm the minimap's look for the empty eighth slot.

## Rationale

The canvas has a fixed scale and no zoom, so travel between far regions needs help or the visitor pans for ages. A minimap gives orientation and search gives intent, and both read data that is already on the page. Bucket relative links cost a small lookup but never break when the slot size changes. Writing the address only when panning settles avoids jank and a flood of history entries.
