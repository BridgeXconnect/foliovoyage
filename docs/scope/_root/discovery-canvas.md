# Scope: discovery canvas (EP-20, BRI-223)

A Pinterest style discovery surface that pans freely in every direction, with tours at fixed positions clustered by city and category. It is the main top of funnel discovery surface, so its features run at the Beta tier (the project default is Alpha). Design input: [the canvas design brief](../../superpowers/plans/2026-09-27-canvas-design-brief.md). What it lists under Decided is settled; `/architect` should confirm or override only what it lists under Recommended and Ask Roy. See the legend in [index.md](index.md#legend) for the status words and the feature lifecycle.

## Slice 1: thin thread, one city

### 12. Canvas feed endpoint (BRI-225) · planned · needs a decision · Beta
The server feed the canvas reads: a small summary of every city and category bucket for first paint, and one bucket's ranked tours on request. It applies the feed rules (no Travel & Transportation Services, no tours without a primary category) and ranks each bucket.
**Done when:** the feed serves bucket summaries and a bucket's tours for the six cities, the exclusion and ranking rules apply, and a bucket loads without paging through the whole catalogue.
- [ ] Design it (spec): `/architect canvas feed endpoint`

### 13. Canvas layout and rendering (region layout, culler, pan) · planned · needs a decision · Beta
A pure layout that gives every tile a stable position inside its city and category region, and a discovery page that pans freely and mounts only the tiles near the viewport. Bangkok first, then all six cities.
**Done when:** a discovery page shows Bangkok's buckets with free pan and only nearby tiles mounted, and a tile click opens that tour's own page.
- [ ] Design it (spec): `/architect canvas layout and rendering`

## Slice 2: all six cities

### 14. Canvas navigation (minimap, bucket search, shareable position URLs) · planned · needs a decision · Beta
Ways to travel between regions on a canvas that pans but does not zoom: a minimap, a search that jumps to a bucket, and a position kept in the page address so a shared link reopens the same spot.
**Done when:** picking a region on the minimap or a result in the search moves the view to that bucket, and a copied link reopens the same position.
- [ ] Design it (spec): `/architect canvas navigation`

## Slice 3: tile design

### 15. Canvas tile design (tile shape rules, hover caption, visual direction) · planned · needs a decision · Beta
How a tile looks: size and shape rules that work within the photo crops the provider offers, a hover caption, and the visual direction, which becomes `design.md`.
**Done when:** `design.md` is written and tiles follow its size and shape rules, with a hover caption.
- [ ] Design it (spec): `/architect canvas tile design`
