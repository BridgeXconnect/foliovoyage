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

import { TourPageViewed } from "@/components/tour/TourPageViewed";

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

const mount = (id = "cabc") =>
  act(() =>
    root.render(
      <StrictMode>
        <TourPageViewed experienceId={id} tourId="ctour" citySlug="bangkok" />
      </StrictMode>,
    ),
  );

describe("TourPageViewed", () => {
  it("fires once under the strict mode double run, with only the validated keys", () => {
    mockFrom = "bangkok.food-drink";
    mount();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith("tour_page_viewed", {
      experience_id: "cabc",
      tour_id: "ctour",
      city: "bangkok",
      category: "food-drink",
      from: "bangkok.food-drink",
    });
  });

  it.each([["no from", null], ["a tampered from", "bangkok.food-drink.<x>"], ["another city", "kyoto.food-drink"], ["garbage", "zzz"]])(
    "sends null category and null from for %s",
    (_l, from) => {
      mockFrom = from;
      mount();
      expect(capture).toHaveBeenCalledTimes(1);
      const [, props] = capture.mock.calls[0] as [string, Record<string, unknown>];
      expect(props).toEqual({ experience_id: "cabc", tour_id: "ctour", city: "bangkok", category: null, from: null });
      expect(JSON.stringify(props)).not.toContain("<x>");
    },
  );

  it("fires again for a second tour on the same mounted component", () => {
    mount("cabc");
    mount("cdef");
    expect(capture).toHaveBeenCalledTimes(2);
  });
});
