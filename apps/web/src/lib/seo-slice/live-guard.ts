/**
 * The live guard (spec 0006 AC-8, Live set): a pull request may not take a
 * live slice page out of the live set unless the head manifest marks it held.
 * Pure; `scripts/seo-live-guard.ts` feeds it the base and head files.
 */

import type { SeoSliceManifest } from "@folio/shared";

/** Reads the `LIVE_SLUGS` literal out of a `live.generated.ts` source text. */
export function parseLiveSlugs(source: string): string[] {
  const m = /export const LIVE_SLUGS[^=]*=\s*(\[[^\]]*\])/.exec(source);
  if (!m) throw new Error("live.generated.ts has no LIVE_SLUGS array");
  const parsed: unknown = JSON.parse(m[1]);
  if (!Array.isArray(parsed) || !parsed.every((s) => typeof s === "string")) {
    throw new Error("LIVE_SLUGS is not an array of strings");
  }
  return parsed;
}

export interface LiveGuardInput {
  /** Null when the base branch has no `live.generated.ts` yet (before the first slice PR). */
  baseSlugs: string[] | null;
  headSlugs: string[];
  headManifest: SeoSliceManifest | null;
  /** Why each head page is not live, from `deriveLiveSet`. */
  headNotLive: Record<string, string>;
}

/** One line per dropped slug; empty means the guard passes. */
export function liveGuardFailures(input: LiveGuardInput): string[] {
  if (!input.baseSlugs) return [];
  const head = new Set(input.headSlugs);
  const failures: string[] = [];
  for (const slug of input.baseSlugs) {
    if (head.has(slug)) continue;
    const page = input.headManifest?.pages.find((p) => p.slug === slug);
    if (!page) {
      failures.push(`${slug}: live on the base branch but removed from the manifest`);
    } else if (!page.held) {
      const why = input.headNotLive[slug] ?? "unknown";
      failures.push(`${slug}: live on the base branch, not live here (${why}); approve it again in this PR or mark it "held": true`);
    }
  }
  return failures;
}
