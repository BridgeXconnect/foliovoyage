import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockCapture = jest.fn();
jest.mock("posthog-js", () => ({ __esModule: true, default: { capture: mockCapture } }));

import { trackCanvasTileClick } from "@/lib/analytics";

describe("trackCanvasTileClick", () => {
  beforeEach(() => {
    mockCapture.mockClear();
  });

  it("keeps the existing properties and adds the Experience and Tour ids", () => {
    trackCanvasTileClick({
      city: "bangkok",
      category: "food-drink",
      rank: 3,
      tier: "lg",
      tileKind: "tour",
      experienceId: "exp1",
      tourId: "tour1",
    });
    expect(mockCapture).toHaveBeenCalledWith("canvas_tile_click", {
      city: "bangkok",
      category: "food-drink",
      rank: 3,
      tier: "lg",
      tile_kind: "tour",
      experience_id: "exp1",
      tour_id: "tour1",
    });
  });

  it("sends null ids for the exit tile", () => {
    trackCanvasTileClick({ city: "bangkok", category: "food-drink", rank: null, tier: "md", tileKind: "exit" });
    expect(mockCapture).toHaveBeenCalledWith("canvas_tile_click", {
      city: "bangkok",
      category: "food-drink",
      rank: null,
      tier: "md",
      tile_kind: "exit",
      experience_id: null,
      tour_id: null,
    });
  });
});
