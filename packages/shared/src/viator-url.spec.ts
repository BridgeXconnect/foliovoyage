import { describe, expect, it } from "@jest/globals";
import { isViatorHost } from "./viator-url";

describe("isViatorHost", () => {
  it.each([
    "https://viator.com/tours/x",
    "https://www.viator.com/tours/x?pid=P1",
    "https://partner.api.viator.com/x",
  ])("accepts %s", (url) => expect(isViatorHost(url)).toBe(true));

  it.each([
    ["evilviator.com", "https://evilviator.com/x"],
    ["viator.com.evil.com", "https://viator.com.evil.com/x"],
    ["userinfo trick", "https://viator.com@evil.com/x"],
    ["http", "http://www.viator.com/x"],
    ["malformed", "not a url"],
    ["relative", "/tours/x"],
    ["javascript", "javascript:alert(1)"],
  ])("refuses %s", (_name, url) => expect(isViatorHost(url)).toBe(false));

  it("refuses null, undefined and the empty string", () => {
    expect(isViatorHost(null)).toBe(false);
    expect(isViatorHost(undefined)).toBe(false);
    expect(isViatorHost("")).toBe(false);
  });
});
