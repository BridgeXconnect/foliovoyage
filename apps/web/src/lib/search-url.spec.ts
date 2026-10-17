import { describe, expect, it } from "@jest/globals";
import {
  parseSearchState,
  searchStateToQuery,
  EMPTY_SEARCH_STATE,
} from "@/lib/search-url";

describe("parseSearchState", () => {
  it("returns the empty state for no params", () => {
    expect(parseSearchState({})).toEqual(EMPTY_SEARCH_STATE);
  });

  it("parses q, comma-joined priceBand/category/duration, page", () => {
    const s = parseSearchState({
      q: " temples ",
      priceBand: "$,$$",
      category: "Culture & History,Food & Drink",
      duration: "short,full-day",
      page: "3",
    });
    expect(s.q).toBe("temples");
    expect(s.priceBands).toEqual(["$", "$$"]);
    expect(s.categories).toEqual(["Culture & History", "Food & Drink"]);
    expect(s.durations).toEqual(["short", "full-day"]);
    expect(s.page).toBe(3);
  });

  it("drops unknown tokens and clamps page tolerantly", () => {
    const s = parseSearchState({
      priceBand: "$,bogus",
      category: "Nope",
      duration: "short,weird",
      page: "0",
    });
    expect(s.priceBands).toEqual(["$"]);
    expect(s.categories).toEqual([]);
    expect(s.durations).toEqual(["short"]);
    expect(s.page).toBe(1); // clamped >=1
  });

  it("takes the first value when a param arrives as an array", () => {
    expect(parseSearchState({ q: ["a", "b"] }).q).toBe("a");
  });

  it("ignores legacy minRating URLs so they do not empty the public catalogue", () => {
    expect(parseSearchState({ minRating: "4" })).toEqual(EMPTY_SEARCH_STATE);
  });
});

describe("searchStateToQuery", () => {
  it("omits defaults and round-trips a populated state", () => {
    expect(searchStateToQuery(EMPTY_SEARCH_STATE)).toBe("");
    const state = {
      q: "night market",
      priceBands: ["$", "$$"] as const,
      categories: ["Food & Drink"] as const,
      durations: ["short"] as const,
      page: 2,
    };
    const round = parseSearchState(
      Object.fromEntries(new URLSearchParams(searchStateToQuery(state as never))),
    );
    expect(round.q).toBe("night market");
    expect(round.priceBands).toEqual(["$", "$$"]);
    expect(round.categories).toEqual(["Food & Drink"]);
    expect(round.durations).toEqual(["short"]);
    expect(round.page).toBe(2);
  });

  it("omits page=1 from the query", () => {
    expect(searchStateToQuery({ ...EMPTY_SEARCH_STATE, q: "x", page: 1 })).toBe("q=x");
  });
});
