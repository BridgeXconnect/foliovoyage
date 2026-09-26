import { describe, expect, it } from "@jest/globals";

import { decideKillSwitch } from "./tour-copy-eval-stats";

describe("decideKillSwitch (spec 0003 AC-9)", () => {
  it.each([
    [0, 0, "insufficient"],
    [29, 29, "insufficient"],
    [20, 5, "insufficient"],
    [30, 0, "ok"],
    [40, 2, "ok"], // exactly 5%
    [40, 3, "withdraw"],
    [30, 1, "ok"],
    [30, 2, "withdraw"],
    [200, 10, "ok"],
    [200, 11, "withdraw"],
  ] as const)("judged %i, bad %i gives %s", (judged, bad, expected) => {
    expect(decideKillSwitch({ judged, bad })).toBe(expected);
  });
});
