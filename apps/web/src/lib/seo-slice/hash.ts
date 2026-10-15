/**
 * The SEO slice hash recipe (spec 0006 index.md, Hashes).
 *
 * `canonicalHash(value)` = `"v1:" + sha256(JSON with keys sorted at every
 * level, no whitespace)`, hex. The same recipe lives in apps/api
 * (`seo-slice-hash.ts`); both apps pin it with the same golden vector test, so
 * the two copies cannot drift without CI failing.
 *
 * Node only (`node:crypto`): it runs in `seo:index`, at build and in tests,
 * never in the edge middleware.
 */

import { createHash } from "node:crypto";

export const SEO_SLICE_HASH_VERSION = "v1";

/** JSON with object keys sorted at every level, array order kept, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

export function canonicalHash(value: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(value)).digest("hex");
  return `${SEO_SLICE_HASH_VERSION}:${digest}`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
