import { describe, expect, it } from "@jest/globals";

import { planEvalSample, seededRandom, type ServedRow } from "./tour-copy-eval-sample";

const SONNET = { promptVersion: 4, model: "claude-sonnet-5" };
const JUDGE = "claude-opus-5-5";

function rows(
  city: string,
  count: number,
  options: { pair?: { promptVersion: number; model: string }; judgedFirst?: number; idPrefix?: string } = {},
): ServedRow[] {
  const pair = options.pair ?? SONNET;
  const prefix = options.idPrefix ?? city;
  return Array.from({ length: count }, (_, index) => ({
    tourId: `${prefix}-${String(index).padStart(4, "0")}`,
    promptVersion: pair.promptVersion,
    model: pair.model,
    cityId: city,
    cityLabel: city,
    judged: index < (options.judgedFirst ?? 0),
    promptChars: 3100,
  }));
}

function plan(pairs: { promptVersion: number; model: string }[], all: ServedRow[], cap = 500, seed = 1) {
  return planEvalSample(pairs, all, { judgeModel: JUDGE, cap, random: seededRandom(seed) });
}

describe("planEvalSample (spec 0003 AC-7)", () => {
  it("stage 1 takes the 50 lowest Tour.id rows and sends only the unjudged ones", () => {
    const all = rows("a", 200, { judgedFirst: 10 });
    const result = plan([SONNET], all);
    const [pairPlan] = result.pairs;

    expect(pairPlan.stage1).toHaveLength(40);
    expect(pairPlan.stage1[0].tourId).toBe("a-0010");
    expect(pairPlan.stage1[39].tourId).toBe("a-0049");
    expect(pairPlan.alreadyJudged).toBe(10);
  });

  it("tops every city up to min(60, served rows in the city) judged rows", () => {
    const all = [...rows("a", 100), ...rows("b", 20), ...rows("c", 5)];
    const result = plan([SONNET], all);
    const [pairPlan] = result.pairs;

    const perCity = Object.fromEntries(pairPlan.cities.map((city) => [city.cityId, city.judged + city.toJudge]));
    expect(perCity).toEqual({ a: 60, b: 20, c: 5 });
    // Stage 1 (50 lowest ids) is all city "a", so the top up is 10 more of a, all of b, all of c.
    expect(pairPlan.stage1).toHaveLength(50);
    expect(pairPlan.topUp).toHaveLength(10 + 20 + 5);
  });

  it("takes top ups round robin in city id order", () => {
    const all = [...rows("a", 100), ...rows("b", 100), ...rows("c", 100)];
    const [pairPlan] = plan([SONNET], all).pairs;

    // 50 stage 1 rows are all city a (lowest ids), so a needs 10, b and c need 60 each.
    expect(pairPlan.topUp.slice(0, 6).map((row) => row.cityId)).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  it("never picks a row twice, and never picks an already judged row", () => {
    const all = [...rows("a", 100, { judgedFirst: 30 }), ...rows("b", 80, { judgedFirst: 5 })];
    const result = plan([SONNET], all);

    const ids = result.queue.map((row) => row.tourId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.queue.every((row) => !row.judged)).toBe(true);
  });

  it("is deterministic for a seed and varies with another seed", () => {
    const all = [...rows("a", 300), ...rows("b", 300)];
    const first = plan([SONNET], all, 500, 42).queue.map((row) => row.tourId);
    const again = plan([SONNET], all, 500, 42).queue.map((row) => row.tourId);
    const other = plan([SONNET], all, 500, 43).queue.map((row) => row.tourId);

    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it("orders pairs by prompt version descending, then model ascending", () => {
    const v3 = { promptVersion: 3, model: "claude-sonnet-5" };
    const v4b = { promptVersion: 4, model: "claude-sonnet-5" };
    const v4a = { promptVersion: 4, model: "claude-haiku-4-5-20251001" };
    const all = [
      ...rows("a", 3, { pair: v3, idPrefix: "p3" }),
      ...rows("a", 3, { pair: v4b, idPrefix: "p4b" }),
      ...rows("a", 3, { pair: v4a, idPrefix: "p4a" }),
    ];
    const result = plan([v3, v4b, v4a], all);

    expect(result.pairs.map((p) => p.pair)).toEqual([v4a, v4b, v3]);
    expect(result.queue.map((row) => row.tourId.slice(0, 3))).toEqual(["p4a", "p4a", "p4a", "p4b", "p4b", "p4b", "p3-", "p3-", "p3-"]);
  });

  it("puts stage 1 of every pair ahead of any top up, and the cap cuts the top ups first", () => {
    const v3 = { promptVersion: 3, model: "claude-sonnet-5" };
    const all = [...rows("a", 100, { idPrefix: "n" }), ...rows("a", 100, { pair: v3, idPrefix: "o" })];
    const result = plan([SONNET, v3], all, 110);

    // 50 + 50 stage 1 rows, then 10 of the top ups.
    expect(result.queue).toHaveLength(110);
    expect(result.queue.slice(0, 50).every((row) => row.promptVersion === 4)).toBe(true);
    expect(result.queue.slice(50, 100).every((row) => row.promptVersion === 3)).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it("cuts stage 1 itself when the cap is smaller than one pair's first rows", () => {
    const result = plan([SONNET], rows("a", 100), 20);

    expect(result.queue).toHaveLength(20);
    expect(result.pairs[0].topUp).toHaveLength(0);
    expect(result.truncated).toBe(true);
  });

  it("reports truncated false when everything fits", () => {
    expect(plan([SONNET], rows("a", 30)).truncated).toBe(false);
  });

  it("skips a pair whose model is the judge model whole, but still counts its served rows", () => {
    const opus = { promptVersion: 4, model: JUDGE };
    const all = [...rows("a", 80, { pair: opus, idPrefix: "x" }), ...rows("a", 10, { idPrefix: "s" })];
    const result = plan([opus, SONNET], all);

    const opusPlan = result.pairs.find((p) => p.pair.model === JUDGE)!;
    expect(opusPlan).toMatchObject({ sameModel: true, served: 80 });
    expect(opusPlan.stage1).toHaveLength(0);
    expect(opusPlan.topUp).toHaveLength(0);
    expect(result.queue.every((row) => row.model !== JUDGE)).toBe(true);
    expect(result.queue).toHaveLength(10);
  });

  it("keeps a pair with no served rows in the plan, with nothing to judge", () => {
    const result = plan([SONNET], []);

    expect(result.pairs).toEqual([
      { pair: SONNET, sameModel: false, served: 0, alreadyJudged: 0, stage1: [], topUp: [], cities: [] },
    ]);
    expect(result.queue).toEqual([]);
  });
});

describe("seededRandom", () => {
  it("returns values in [0, 1) and repeats for the same seed", () => {
    const a = seededRandom(7);
    const b = seededRandom(7);
    for (let index = 0; index < 100; index++) {
      const value = a();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      expect(b()).toBe(value);
    }
  });
});
