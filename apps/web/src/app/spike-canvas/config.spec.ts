import { describe, expect, it } from "@jest/globals";
import { describeConfig, imageVariant, parseConfig } from "./config";

const defaults = { sectionSize: 512, overscan: 1 };
const FEED = "https://media-cdn.tripadvisor.com/media/attractions-splice-spp-674x446/11/7c/e8/f7.jpg";

describe("parseConfig", () => {
  it("reads every switch after the overlay flag", () => {
    const c = parseConfig("?overlay=1&img=1x&tilt=0&cap=20&decode=pre&layers=0", defaults);
    expect(c).toMatchObject({ overlay: true, imageMode: "1x", tilt: false, cap: 20, decodePre: true, layers: false, invalid: [] });
  });

  it("runs the defaults when nothing is given", () => {
    expect(parseConfig("", defaults)).toMatchObject({
      sectionSize: 512,
      overscan: 1,
      overlay: false,
      imageMode: "full",
      tilt: true,
      cap: null,
      decodePre: false,
      layers: true,
      invalid: [],
    });
  });

  it("flags an unknown value instead of silently running full images", () => {
    const c = parseConfig("?overlay=1&img=tier", defaults);
    expect(c.imageMode).toBe("full");
    expect(c.invalid).toEqual(["img=tier"]);
  });

  it("flags a value with the wrong case, an unknown name and a repeated name", () => {
    expect(parseConfig("?img=1X", defaults).invalid).toEqual(["img=1X"]);
    expect(parseConfig("?imgs=1x", defaults).invalid).toEqual(["imgs=1x"]);
    const repeated = parseConfig("?img=1x&img=full", defaults);
    expect(repeated.imageMode).toBe("1x");
    expect(repeated.invalid).toEqual(["img=full"]);
  });

  it("flags a second question mark, which swallows the rest into the overlay value", () => {
    expect(parseConfig("?overlay=1?img=1x", defaults).invalid).toEqual(["overlay=1?img=1x"]);
  });

  it("rejects a cap of zero and a non-numeric section", () => {
    expect(parseConfig("?cap=0&section=big", defaults).invalid).toEqual(["cap=0", "section=big"]);
  });

  it("describes every setting", () => {
    expect(describeConfig(parseConfig("?img=off&cap=30", defaults))).toBe(
      "img off · tilt 1 · cap 30\ndecode async · layers 1\nsection 512 · overscan 1",
    );
  });
});

describe("imageVariant", () => {
  it("keeps the feed URL in full mode", () => {
    expect(imageVariant(FEED, 168, 112, false, "full")).toEqual({ url: FEED, width: 674, height: 446 });
  });

  it("picks the smallest CDN size that covers the box", () => {
    expect(imageVariant(FEED, 360, 240, false, "1x")?.url).toContain("spp-360x240/");
    expect(imageVariant(FEED, 168, 112, false, "1x")).toMatchObject({ width: 180, height: 120 });
    expect(imageVariant(FEED, 168, 168, true, "1x")).toMatchObject({ width: 200, height: 200 });
    expect(imageVariant(FEED, 240, 240, true, "1x")).toMatchObject({ width: 400, height: 400 });
  });

  it("falls back to the largest size of the shape when none covers the box", () => {
    expect(imageVariant(FEED, 360, 360, true, "2x")).toMatchObject({ width: 400, height: 400 });
    expect(imageVariant(FEED, 360, 240, false, "2x")).toMatchObject({ width: 720, height: 480 });
  });

  it("loads nothing when images are off", () => {
    expect(imageVariant(FEED, 360, 240, false, "off")).toBeNull();
  });
});
