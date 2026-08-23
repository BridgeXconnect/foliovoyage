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

  it("parses q, comma-joined priceBand/category/duration, minRating, page", () => {
    const s = parseSearchState({
      q: " temples ",
      priceBand: "$,$$",
      category: "Culture & History,Food & Drink",
      duration: "short,full-day",
      minRating: "4",
      page: "3",
    });
    expect(s.q).toBe("temples");
    expect(s.priceBands).toEqual(["$", "$$"]);
    expect(s.categories).toEqual(["Culture & History", "Food & Drink"]);
    expect(s.durations).toEqual(["short", "full-day"]);
    expect(s.minRating).toBe(4);
    expect(s.page).toBe(3);
  });

  it("drops unknown tokens and clamps page/minRating tolerantly", () => {
    const s = parseSearchState({
      priceBand: "$,bogus",
      category: "Nope",
      duration: "short,weird",
      minRating: "99",
      page: "0",
    });
    expect(s.priceBands).toEqual(["$"]);
    expect(s.categories).toEqual([]);
    expect(s.durations).toEqual(["short"]);
    expect(s.minRating).toBe(5); // clamped 0..5
    expect(s.page).toBe(1); // clamped >=1
  });

  it("takes the first value when a param arrives as an array", () => {
    expect(parseSearchState({ q: ["a", "b"] }).q).toBe("a");
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
      minRating: 4,
      page: 2,
    };
    const round = parseSearchState(
      Object.fromEntries(new URLSearchParams(searchStateToQuery(state as never))),
    );
    expect(round.q).toBe("night market");
    expect(round.priceBands).toEqual(["$", "$$"]);
    expect(round.categories).toEqual(["Food & Drink"]);
    expect(round.durations).toEqual(["short"]);
    expect(round.minRating).toBe(4);
    expect(round.page).toBe(2);
  });

  it("omits page=1 from the query", () => {
    expect(searchStateToQuery({ ...EMPTY_SEARCH_STATE, q: "x", page: 1 })).toBe("q=x");
  });
});
