import { describe, expect, it } from "@jest/globals";
import { isViatorHost as sharedIsViatorHost } from "@folio/shared";
import { isViatorHost, withCampaign } from "@/lib/viator-url";

describe("isViatorHost", () => {
  // The function and its cases live in @folio/shared (spec 0006 AC-M3); this
  // module must hand both /go routes that same function, not a second copy.
  it("is the @folio/shared function", () => {
    expect(isViatorHost).toBe(sharedIsViatorHost);
  });
});

describe("withCampaign", () => {
  const base = "https://www.viator.com/tours/Bangkok/Canal/d343-1234P5";

  it("appends with ? when there is no query string", () => {
    expect(withCampaign(base, "canvas-tour")).toBe(`${base}?campaign=canvas-tour`);
  });

  it("appends with & when the query has no campaign", () => {
    expect(withCampaign(`${base}?pid=P1&mcid=42383&medium=api`, "canvas-tour")).toBe(
      `${base}?pid=P1&mcid=42383&medium=api&campaign=canvas-tour`,
    );
  });

  it("replaces only the value of an existing campaign", () => {
    expect(withCampaign(`${base}?pid=P1&campaign=old&medium=api`, "canvas-tour")).toBe(
      `${base}?pid=P1&campaign=canvas-tour&medium=api`,
    );
    expect(withCampaign(`${base}?campaign=old`, "canvas-tour")).toBe(`${base}?campaign=canvas-tour`);
  });

  it("does not mistake a longer parameter name for campaign", () => {
    expect(withCampaign(`${base}?subcampaign=x&xcampaign=y`, "canvas-tour")).toBe(
      `${base}?subcampaign=x&xcampaign=y&campaign=canvas-tour`,
    );
  });

  it("places the campaign before a fragment", () => {
    expect(withCampaign(`${base}#reviews`, "canvas-tour")).toBe(`${base}?campaign=canvas-tour#reviews`);
    expect(withCampaign(`${base}?pid=P1#reviews`, "canvas-tour")).toBe(
      `${base}?pid=P1&campaign=canvas-tour#reviews`,
    );
    expect(withCampaign(`${base}?campaign=old#reviews`, "canvas-tour")).toBe(
      `${base}?campaign=canvas-tour#reviews`,
    );
  });

  it("handles a bare trailing ?", () => {
    expect(withCampaign(`${base}?`, "canvas-tour")).toBe(`${base}?campaign=canvas-tour`);
  });

  it("leaves percent encoding and + untouched", () => {
    const input = `${base}?text=Bangkok%20canal+tour&q=%E2%9C%93%2B&campaign=old&x=a%2Fb`;
    const output = withCampaign(input, "canvas-tour");
    expect(output).toBe(`${base}?text=Bangkok%20canal+tour&q=%E2%9C%93%2B&campaign=canvas-tour&x=a%2Fb`);
    expect(output.replace("campaign=canvas-tour", "campaign=old")).toBe(input);
  });
});
