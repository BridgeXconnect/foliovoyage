/** @jest-environment jsdom */
import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockFrom: string | null = null;
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: (k: string) => (k === "from" ? mockFrom : null) }),
}));
const capture = jest.fn();
jest.mock("posthog-js", () => ({ __esModule: true, default: { capture: (...a: unknown[]) => capture(...a) } }));

import { TourNotFoundBody } from "@/components/tour/TourNotFoundBody";

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  capture.mockReset();
  mockFrom = null;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});
const hrefs = () => Array.from(host.querySelectorAll("a")).map((a) => a.getAttribute("href"));
const mount = () =>
  act(() =>
    root.render(
      <StrictMode>
        <TourNotFoundBody />
      </StrictMode>,
    ),
  );

describe("TourNotFoundBody", () => {
  it("links to /discover only when there is no valid from", () => {
    mount();
    expect(hrefs()).toEqual(["/discover"]);
  });

  it("adds the city page link for a valid from", () => {
    mockFrom = "kyoto.art-culture";
    mount();
    expect(hrefs()).toEqual(["/discover", "/destinations/kyoto"]);
    expect(host.textContent).toContain("Explore Kyoto");
  });

  it.each([["garbage"], ["kyoto.nonsense"], ["atlantis.art-culture"]])("ignores an invalid from (%s)", (from) => {
    mockFrom = from;
    mount();
    expect(hrefs()).toEqual(["/discover"]);
    expect(host.innerHTML).not.toContain(from);
  });

  it("fires tour_page_not_found once, with only validated keys and no reason", () => {
    mockFrom = "kyoto.art-culture";
    mount();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("tour_page_not_found", {
      city: "kyoto",
      category: "art-culture",
      from: "kyoto.art-culture",
    });
  });

  it("sends nulls for a tampered from", () => {
    mockFrom = "kyoto.art-culture.<x>";
    mount();
    expect(capture).toHaveBeenCalledWith("tour_page_not_found", { city: null, category: null, from: null });
  });
});
