# Open items for the designer

The discovery canvas (`/discover`) is built for Bangkok and works. What is left is the look. Each section below is one open item, with the context you need and the one constraint that matters. The rules the code depends on live in spec 0004 (`docs/specs/_root/0004-discovery-canvas/`, tile design child). Where this file and the spec disagree, the spec wins until it is changed.

Last updated 2026-10-04.

## 1. The layout is not editorial enough yet

**Context.** Tiles are placed by a pure function, so every device sees the same positions. The result is tidy but still reads as a grid with jitter. It does not yet feel like a magazine spread.

**Constraint.** Variety has to come from size, spacing, overlap, typography and non-photo tiles. It cannot come from the photos (item 2) or from transformed text (item 3). Three sizes by rank are fixed: rank 1 to 4 large, 5 to 20 medium, 21 to 50 small. A bucket shows at most 50 tiles plus the exit tile. A new tile type or spacing rule has to be expressible in the layout function, which never measures text, so any new element needs a fixed height.

## 2. Photos only come as 1:1 and 3:2, up to about 720 px wide

**Context.** The provider supplies a small set of crops. The largest is about 720 px wide (typically 674×446 or 720×480). Shape is picked per tour from a seed, about 30% square, and the photo is cropped to the tile with `object-fit: cover`.

**Constraint.** No other aspect ratio exists, and nothing sharper than about 720 px. Large tiles must not be designed to display the photo much wider than that. Shape and tier never come from the source image.

## 3. No transform on text

**Context.** Rotating the caption cost about 8 ms per frame while panning on an iPhone 16 (95th percentile 26 ms with the whole tile rotated, 18 ms with only the photo rotated, 17 ms with no tilt).

**Constraint.** Only the photo may tilt (about ±1.5° around the tile's top left corner). Captions and everything in them are never rotated, scaled or otherwise transformed. This holds for the tour page too wherever it sits on the canvas.

## 4. Paper file, tokens and the swap test

**Context.** The visual source of truth is the Paper file `01M3VHFY502GXVVB8RJ9VW1QBH`. Page 01 holds the contract and tokens, and page "04 Chrome" holds four frames (Desktop Default, Desktop Search open, Mobile Default, Mobile Sheet open). The swap test passed on 3 Oct: accent, ink, surface, `font-sans` and `radius-lg` were set to loud values (#FF00AA, #FF6A00, #FFF200, Fraunces, 37 px), 208 of 208 sampled properties restyled, and no original literal was found anywhere in the file. The original values were restored afterwards (token hash `1466f1d5`).

**Constraint.** Every colour, font and radius must be a token, never a literal. Border widths and page 01 line heights are exempt. The swap test has to be re-run after any change that adds colours or type. `accent-ink` is untested until hover and pressed states exist in code.

## 5. The nine search result row separators

**Context.** In the bucket search panel, the separators between the nine result rows were moved to the `line-strong` token on 3 Oct. This was a judgment call, not a reviewed decision. The top bar hairlines, panel and field outlines and minimap cell outlines stay on `line`.

**Constraint.** Review them. Reverting is a one token change per row.

## 6. Exit tile wording

**Context.** The tile at the end of each bucket links to the city page. The code currently reads "Explore {City} →". An earlier version, "All N in {City} · {Category}", promised a category and a count that the unfiltered city page does not show, so it was dropped. Spec 0004 still lists the wording as open.

**Constraint.** The copy is a single constant, so changing it is cheap. The tile is 240 by 160 px, has no caption (the words sit inside it) and is the only solid `accent` element on the canvas. Do not promise something the destination page does not show.

## 7. City and category order

**Context.** The world is 6 cities by 7 categories, in a fixed order. Cities: Bangkok, Kyoto, Hanoi, Rome, Lisbon, Bali. Categories: Outdoor Activities, Art & Culture, Food & Drink, Tickets & Passes, Tours Sightseeing & Cruises, Classes & Workshops, Seasonal & Special Occasions. Category labels are the long forms from the shared geometry file.

**Constraint.** Order and labels are defined once, in `@folio/shared`, and the layout, minimap, search and links all read them. Confirm them or send a replacement list. Do not copy them into designs as free text that could drift.

## 8. `design.md`

**Context.** The written visual direction (colour mood, type pairing, texture, spacing feel) is not yet written. Textures were scrapped on 1 Oct.

**Constraint.** `design.md` has to fit the rules in item 3 and the fixed caption heights in item 9. Where it disagrees with spec 0004's fixed heights and tiers, the spec wins until the spec is changed.

## 9. Rounded corners and the caption look

**Context.** The caption sits below the photo and is never laid over it. Its height is a fixed token per tier: 68 px (large, title clamped to 2 lines plus duration, price and rating), 57 px (medium, title clamped to 2 lines plus duration and price), 14 px (small, title only, 1 line). The tokens in Paper are `--container-caption-lg/md/sm`, `--leading-xs` 16 px, `--leading-sm` 18 px and `--leading-tight` 115%. The corner radius comes from `radius-lg`, 12 px today.

**Constraint.** Caption height depends only on the tier, never on the text. Titles are cut at the clamp. If you change a font size or line height, the three heights must be recalculated and given back as token values, not formulas, because the medium and small values come from fractional line boxes and render rounded. Hover is desktop only (accent outline plus accent title). On touch a tap opens the tour.

## 10. A clearance caveat

**Context.** The layout keeps tiles at least 6 px apart. A local run against a 60 tour sample (an older number, the cap is now 50) found a minimum of 10.61 px with no violations. That is one sample of one bucket. The layout's property test covers many buckets and seeds.

**Constraint.** Do not rely on the clearance for a new overlap effect. Overlap has to be designed through the layout function, not drawn on top of it.

---

## From the tour page spec (0005), pending its merge

This section describes a spec that is not merged yet (it is in a separate pull request). Treat it as the likely brief, and check the spec before designing against it. The page is `/tours/:id`, opened from a canvas tile, `noindex`, with one button to Viator. These are the design items:

- **Section order and layout.** Title, cover image, price, duration, cancellation text, summary text, then the button. Any element that has no data is hidden, but the button always shows.
- **Header and footer.** How the page frames itself against the canvas, and the affiliate disclosure link to `/legal/disclosure`.
- **Price, duration and cancellation.** Price reads "From {price}" with the note "Final price shown by Viator at booking." The supplier's currency is shown as is and must not be converted or altered. Cancellation text is shown exactly as stored, never rewritten.
- **The rating placeholder and loading state.** The star rating is protected content. It never appears in the page source and is filled in by a script after the page loads. The design needs an empty state that holds its space (no layout jump), and a state for "no rating", where nothing shows.
- **The button.** "Book on Viator", or "Search on Viator" when there is no valid link. It leads through `/go/tours/:id` on our server.
- **The back link.** "Back to {City} · {Category}" when the visitor came from the canvas, otherwise "Back to {City}".
- **The 404 page.** A real not found page with a link back to `/discover`.
- **The hero image crop for a 720 px source.** The image is at most about 720 px wide (item 2). Decide the crop and the largest size it may display at without looking soft.
- **The mobile layout.** The page is tested on an iPhone 16 from tile to button.
- **A possible label for AI written copy.** The summary is AI written when valid copy exists, otherwise the supplier's description. Decide whether the AI copy needs a visible label.
