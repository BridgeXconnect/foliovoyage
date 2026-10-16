import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import type { SeoSliceManifest } from "@folio/shared";
import { destinations } from "@/data/destinations";
import { SLICE_CONTENT_DIR } from "./index-files";

/**
 * Slice slugs (spec 0006 AC-M9). A slice page lives at
 * `/destinations/bangkok/{slug}`, beside the `/destinations/{slug}` editorial
 * pages, so no slice slug may equal a destination slug, and slugs are unique.
 */

const manifest = JSON.parse(readFileSync(path.join(SLICE_CONTENT_DIR, "manifest.json"), "utf8")) as SeoSliceManifest;
const slugs = manifest.pages.map((p) => p.slug);

describe("slice page slugs (spec 0006 AC-M9)", () => {
  it("are unique", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("never equal a destination slug", () => {
    const destinationSlugs = new Set(destinations.map((d) => d.slug));
    expect(slugs.filter((s) => destinationSlugs.has(s))).toEqual([]);
  });
});
