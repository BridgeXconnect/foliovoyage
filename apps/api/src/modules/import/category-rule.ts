/**
 * Primary-category derivation (BRI-224) — a pure function, no I/O.
 *
 * Viator's tag hierarchy is a DAG, not a tree: a tag can list several parents,
 * so a walk toward the root can reach more than one, and a cycle (however
 * unlikely in practice) must not loop forever. Only 8 tags count as category
 * roots; everything else in the vocabulary either climbs to one of them, climbs
 * to a never-category root (the legacy 12518–12521 set, or a parentless
 * ops-flag tag like "Zombie" — BRI-228's problem), or is missing from the
 * vocabulary entirely (reported, never silently dropped — see
 * {@link unresolvedTagIds}).
 *
 * The decided rule is "rarest root wins": collect every category root
 * reachable from any of a tour's tags, then take the first one present in
 * {@link CATEGORY_ROOTS_PRIORITY} (rarest first — 83% of tagged tours carry
 * 21913, so it sorts last).
 */

/** A tag id → its direct parent tag ids, exactly as `/products/tags` gives them. */
export type TagGraph = ReadonlyMap<number, readonly number[]>;

/** The 8 tags that count as a category, ordered rarest → most common. */
export const CATEGORY_ROOTS_PRIORITY: readonly number[] = [
  21915, // Classes & Workshops
  21916, // Seasonal & Special Occasions
  21911, // Food & Drink
  21914, // Travel & Transportation Services
  21912, // Tickets & Passes
  21909, // Outdoor Activities
  21910, // Art & Culture
  21913, // Tours, Sightseeing & Cruises
];

const CATEGORY_ROOT_SET: ReadonlySet<number> = new Set(CATEGORY_ROOTS_PRIORITY);

/**
 * Every category root reachable by climbing `tagId`'s `parentTagIds`,
 * repeated for each parent (the DAG can fan out to several). A tag missing
 * from `graph` contributes nothing — it is neither a root nor a link further
 * up — and a cycle is cut by the visited set instead of looping.
 */
export function ancestorCategoryRoots(tagId: number, graph: TagGraph): Set<number> {
  const roots = new Set<number>();
  const visited = new Set<number>();
  const stack = [tagId];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    if (visited.has(current)) continue;
    visited.add(current);
    if (CATEGORY_ROOT_SET.has(current)) {
      roots.add(current);
      continue; // Category roots carry no parents in practice; nothing further up.
    }
    const parents = graph.get(current);
    if (!parents) continue; // Missing from the vocabulary: ignored, not a root.
    for (const parent of parents) stack.push(parent);
  }
  return roots;
}

/**
 * The tour's primary category: the rarest root (by {@link CATEGORY_ROOTS_PRIORITY})
 * among every category root reachable from any of `tagIds`. `null` when none of
 * the tags reach a category root — an untagged tour, a legacy-root-only tour,
 * or a tour tagged only with ops flags.
 */
export function derivePrimaryCategory(
  tagIds: readonly number[],
  graph: TagGraph,
): number | null {
  const roots = new Set<number>();
  for (const tagId of tagIds) {
    for (const root of ancestorCategoryRoots(tagId, graph)) roots.add(root);
  }
  for (const candidate of CATEGORY_ROOTS_PRIORITY) {
    if (roots.has(candidate)) return candidate;
  }
  return null;
}

/** Tag ids on a tour that are not in `graph` — an acceptance criterion: never silently dropped. */
export function unresolvedTagIds(tagIds: readonly number[], graph: TagGraph): number[] {
  return tagIds.filter((id) => !graph.has(id));
}
