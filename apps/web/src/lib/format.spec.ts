import { describe, expect, it } from "@jest/globals";
import { formatDuration, formatPrice } from "./format";

describe("formatDuration", () => {
  it("formats minutes, hours and whole days", () => {
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(120)).toBe("2 h");
    expect(formatDuration(150)).toBe("2 h 30 min");
    expect(formatDuration(1440)).toBe("1 day");
    expect(formatDuration(4320)).toBe("3 days");
  });

  it("is null when unknown", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("formatPrice", () => {
  it("uses the currency's minor unit and drops decimals on whole amounts", () => {
    expect(formatPrice(3500, "USD")).toBe("from $35");
    expect(formatPrice(3550, "USD")).toBe("from $35.50");
    expect(formatPrice(1200, "JPY")).toBe("from ¥1,200");
    expect(formatPrice(120000, "THB").replace(/\s/g, " ")).toBe("from THB 1,200");
  });

  it("falls back for an unknown currency code", () => {
    expect(formatPrice(3500, "??")).toBe("from 35.00 ??");
  });
});
