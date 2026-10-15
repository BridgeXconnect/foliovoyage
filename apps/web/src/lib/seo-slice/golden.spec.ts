import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";
import type { SeoSliceCopy, SeoSliceManifest, SeoSliceNotes, SeoSliceSnapshot } from "@folio/shared";
import { canonicalHash } from "./hash";
import { checkHashFor, checkHashInput, groundingHashFor } from "./live-set";
import type { SliceContent } from "./types";

/**
 * Golden vectors for the page hashes (spec 0006 index.md, Hashes). The input
 * is a plain JSON file outside both apps, read with fs, so apps/api can pin the
 * same values against the same file without importing anything from here.
 * A failure means the hashed shape changed: update apps/api in step.
 */
const FIXTURE = path.resolve(__dirname, "../../../../../packages/shared/fixtures/seo-slice-golden.json");

interface Golden {
  targetSlug: string;
  manifest: SeoSliceManifest;
  snapshot: SeoSliceSnapshot;
  copy: SeoSliceCopy;
  notes: SeoSliceNotes;
}

const golden: Golden = JSON.parse(readFileSync(FIXTURE, "utf8"));
const page = golden.manifest.pages.find((p) => p.slug === golden.targetSlug)!;
const content: SliceContent = {
  manifest: golden.manifest,
  snapshots: { [golden.targetSlug]: golden.snapshot },
  copies: { [golden.targetSlug]: golden.copy },
  notes: { [golden.targetSlug]: golden.notes },
};

const FACTS_HASH = "v1:14eb0600e3ac1d197e9ea1c21a6474efe5f5bd70c036b9be0cedf0e828a5d0c2";
const PICKS_HASH = "v1:f09da8ed1fbcbe1372f0462e11a4031fe9b493e6bdf86a3bff50cb6be499f653";
const GROUNDING_HASH = "v1:56d4bb6d38432602db18836709b5339c1f23818ddb732ab8772c7f2c4d9dda31";
const CHECK_HASH = "v1:ac3948365b4a237fb0aa3ec639b75efe61902b76d9963d47d1f25c066d1e3513";

describe("golden vectors (spec 0006 index.md, Hashes)", () => {
  it("factsHash is canonicalHash of the snapshot facts", () => {
    expect(canonicalHash(golden.snapshot.facts)).toBe(FACTS_HASH);
    expect(golden.snapshot.factsHash).toBe(FACTS_HASH);
  });

  it("picksHash is canonicalHash of the picks", () => {
    expect(canonicalHash(golden.snapshot.picks)).toBe(PICKS_HASH);
    expect(golden.snapshot.picksHash).toBe(PICKS_HASH);
  });

  it("groundingHash covers exactly the AC-H2 inputs", () => {
    expect(groundingHashFor(golden.manifest, page, golden.snapshot)).toBe(GROUNDING_HASH);
    expect(golden.copy.groundingHash).toBe(GROUNDING_HASH);
  });

  it("checkHashInput has exactly this shape", () => {
    expect(checkHashInput(content, page)).toEqual({
      seoTitle: "Floating market tours from Bangkok",
      metaDescription: "How the floating market tours from Bangkok compare, by length and by what they include.",
      intro: "Most of the 42 tours here spend half a day on the water.",
      notes: golden.notes.notes,
      sourceFacts: page.sourceFacts,
      picksHash: PICKS_HASH,
      ogImageExperienceId: "exp-fm-1",
      ogImageUrl: "https://img.test/fm-1.jpg",
      rendered: {
        hubH1: "Things to do in Bangkok",
        tagNames: ["Floating markets"],
        keywordLabels: ["boat ride", "market visit"],
      },
    });
  });

  it("checkHash is canonicalHash of that input", () => {
    expect(checkHashFor(content, page)).toBe(CHECK_HASH);
  });
});
