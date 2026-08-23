import { describe, expect, it } from "@jest/globals";
import {
  sampleLinkKeys,
  checkLinkHealth,
  isFlaggedUnhealthy,
  type LinkHealthReport,
} from "@/lib/link-health";

const links = {
  "bangkok/a": { affiliateUrl: "https://www.viator.com/tours/a" },
  "bangkok/b": { affiliateUrl: "https://www.viator.com/tours/b" },
  "kyoto/c": { affiliateUrl: "https://www.viator.com/tours/c" },
  "kyoto/d": {}, // no affiliateUrl — must never be sampled
};

describe("sampleLinkKeys", () => {
  it("only samples keys that actually have an affiliateUrl", () => {
    const keys = sampleLinkKeys(links, 10);
    expect(keys.sort()).toEqual(["bangkok/a", "bangkok/b", "kyoto/c"]);
  });

  it("caps the sample at sampleSize", () => {
    const keys = sampleLinkKeys(links, 2, () => 0);
    expect(keys.length).toBe(2);
  });

  it("is deterministic given an injected random function", () => {
    const a = sampleLinkKeys(links, 2, () => 0.1);
    const b = sampleLinkKeys(links, 2, () => 0.1);
    expect(a).toEqual(b);
  });
});

describe("checkLinkHealth", () => {
  it("classifies each key as passing or failing per the ping result", async () => {
    const ping = async (url: string) =>
      url.endsWith("/b") ? { ok: false, status: 404 } : { ok: true, status: 200 };

    const report = await checkLinkHealth(links, ["bangkok/a", "bangkok/b"], ping);
    expect(report.failingKeys).toEqual(["bangkok/b"]);
    expect(report.results).toEqual([
      { key: "bangkok/a", url: "https://www.viator.com/tours/a", ok: true, status: 200 },
      { key: "bangkok/b", url: "https://www.viator.com/tours/b", ok: false, status: 404 },
    ]);
    expect(typeof report.checkedAt).toBe("string");
    expect(() => new Date(report.checkedAt)).not.toThrow();
  });

  it("records a ping rejection as a failure with the error message, not a crash", async () => {
    const ping = async () => {
      throw new Error("timeout");
    };
    const report = await checkLinkHealth(links, ["bangkok/a"], ping);
    expect(report.failingKeys).toEqual(["bangkok/a"]);
    expect(report.results[0]).toEqual({
      key: "bangkok/a",
      url: "https://www.viator.com/tours/a",
      ok: false,
      error: "timeout",
    });
  });

  it("skips a sampled key that has no affiliateUrl rather than pinging undefined", async () => {
    const ping = async () => ({ ok: true, status: 200 });
    const report = await checkLinkHealth(links, ["kyoto/d"], ping);
    expect(report.results).toEqual([]);
    expect(report.failingKeys).toEqual([]);
  });
});

describe("isFlaggedUnhealthy", () => {
  const report: LinkHealthReport = { checkedAt: "2026-08-24T00:00:00.000Z", failingKeys: ["bangkok/b"] };

  it("is true for a key present in failingKeys", () => {
    expect(isFlaggedUnhealthy("bangkok/b", report)).toBe(true);
  });

  it("is false for a key not present in failingKeys", () => {
    expect(isFlaggedUnhealthy("bangkok/a", report)).toBe(false);
  });

  it("is false against an empty/placeholder report", () => {
    expect(isFlaggedUnhealthy("bangkok/a", { checkedAt: null, failingKeys: [] })).toBe(false);
  });
});
