import { describe, expect, it } from "@jest/globals";
import { isSlicePreview } from "./preview";

describe("isSlicePreview (AC-T15)", () => {
  it("is true only for SEO_SLICE_PREVIEW=1 under next dev off Vercel", () => {
    expect(isSlicePreview({ SEO_SLICE_PREVIEW: "1", NODE_ENV: "development" })).toBe(true);
  });

  it("is false in a production build, on Vercel, or with the variable unset", () => {
    expect(isSlicePreview({ SEO_SLICE_PREVIEW: "1", NODE_ENV: "production" })).toBe(false);
    expect(isSlicePreview({ SEO_SLICE_PREVIEW: "1", NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(isSlicePreview({ NODE_ENV: "development" })).toBe(false);
    expect(isSlicePreview({ SEO_SLICE_PREVIEW: "true", NODE_ENV: "development" })).toBe(false);
  });
});
