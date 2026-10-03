import { describe, expect, it } from "@jest/globals";

import { pickImage } from "./canvas-image";

const v = (width: number, height = Math.round(width * 0.66)) => ({
  url: `https://img.test/${width}.jpg`,
  width,
  height,
});

describe("pickImage (AC-F7)", () => {
  it("takes the cover entry, not the first one", () => {
    const images = [
      { isCover: false, variants: [v(800)] },
      { isCover: true, variants: [v(700)] },
    ];
    expect(pickImage(images, null, 1)?.url).toBe("https://img.test/700.jpg");
  });

  it("takes the first entry when none is flagged cover", () => {
    const images = [{ variants: [v(720)] }, { variants: [v(900)] }];
    expect(pickImage(images, null, 1)?.url).toBe("https://img.test/720.jpg");
  });

  it("picks the smallest variant at least 640 wide for lg and md ranks", () => {
    const images = [{ isCover: true, variants: [v(200), v(480), v(720), v(1080)] }];
    expect(pickImage(images, null, 1)?.width).toBe(720);
    expect(pickImage(images, null, 20)?.width).toBe(720);
  });

  it("picks the smallest variant at least 480 wide for sm ranks (21 to 60)", () => {
    const images = [{ isCover: true, variants: [v(200), v(480), v(720), v(1080)] }];
    expect(pickImage(images, null, 21)?.width).toBe(480);
    expect(pickImage(images, null, 60)?.width).toBe(480);
  });

  it("falls back to the widest variant when none is wide enough", () => {
    const images = [{ isCover: true, variants: [v(100), v(300), v(200)] }];
    expect(pickImage(images, null, 1)).toEqual({
      url: "https://img.test/300.jpg",
      width: 300,
      height: 198,
    });
  });

  it("skips width 0 variants, even when they are the only ones", () => {
    const zero = { url: "https://img.test/zero.jpg", width: 0, height: 0 };
    const images = [{ isCover: true, variants: [zero, v(300)] }];
    expect(pickImage(images, "https://img.test/plain.jpg", 1)?.url).toBe("https://img.test/300.jpg");
    expect(pickImage([{ isCover: true, variants: [zero] }], "https://img.test/plain.jpg", 1)).toEqual({
      url: "https://img.test/plain.jpg",
      width: null,
      height: null,
    });
  });

  it("falls back to imageUrl with unknown size when there are no variants", () => {
    expect(pickImage([], "https://img.test/plain.jpg", 1)).toEqual({
      url: "https://img.test/plain.jpg",
      width: null,
      height: null,
    });
  });

  it("reports an unknown height as null, not 0", () => {
    const images = [{ isCover: true, variants: [{ url: "https://img.test/a.jpg", width: 700, height: 0 }] }];
    expect(pickImage(images, null, 1)).toEqual({ url: "https://img.test/a.jpg", width: 700, height: null });
  });

  it("still returns a picture when only an unsized variant exists and imageUrl is null", () => {
    const images = [{ isCover: true, variants: [{ url: "https://img.test/z.jpg", width: 0, height: 0 }] }];
    expect(pickImage(images, null, 1)).toEqual({ url: "https://img.test/z.jpg", width: null, height: null });
  });

  it("returns null when there is nothing usable, and ignores malformed json", () => {
    expect(pickImage([], null, 1)).toBeNull();
    expect(pickImage(null, null, 1)).toBeNull();
    expect(pickImage("nope", null, 1)).toBeNull();
    expect(pickImage([{ isCover: true, variants: [{ width: 500 }, { url: "", width: 500 }] }], null, 1)).toBeNull();
  });
});
