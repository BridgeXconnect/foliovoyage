import { describe, expect, it } from "@jest/globals";
import { SEO_SLICE_LEAK_TERMS as SHARED } from "@folio/shared";
import { SEO_SLICE_LEAK_TERMS } from "./seo-slice.constants";

describe("SEO slice leak list parity (spec 0006 AC-T6)", () => {
  it("matches the @folio/shared list exactly", () => {
    expect(SEO_SLICE_LEAK_TERMS).toEqual(SHARED);
  });
});
