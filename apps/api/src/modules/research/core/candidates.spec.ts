import { describe, expect, it } from "@jest/globals";

import {
  buildCandidates,
  candidatesToCsv,
  cityFigures,
  normalizeQuery,
  rankAttractions,
  INTERNAL_TAGS,
  rankTags,
} from "./candidates";

describe("normalizeQuery", () => {
  it("lowercases, drops brackets and other symbols, and collapses spaces", () => {
    expect(normalizeQuery("  Wat Arun (Temple of Dawn) / Tickets!  ")).toBe("wat arun temple of dawn tickets");
  });

  it("keeps apostrophes, ampersands, hyphens and letters with accents", () => {
    expect(normalizeQuery("Rock & Roll's Café-Bar")).toBe("rock & roll's café-bar");
  });
});

describe("rankTags", () => {
  const names = new Map([
    [1, "Food Tours"],
    [2, "Day Trips"],
    [3, "Tiny Tag"],
  ]);

  it("keeps tags with enough products, orders by count then rating, and reports unnamed ids", () => {
    const { ranked, unnamed } = rankTags(
      [
        { tagId: 2, productCount: 40, ratingAvg: 4.6 },
        { tagId: 1, productCount: 40, ratingAvg: 4.8 },
        { tagId: 3, productCount: 9, ratingAvg: 5 },
        { tagId: 99, productCount: 50, ratingAvg: 4 },
      ],
      names,
    );
    expect(ranked.map((r) => r.name)).toEqual(["Food Tours", "Day Trips"]);
    expect(unnamed).toEqual([99]);
  });

  it("rounds the rating to 2 places and keeps a missing rating as null", () => {
    const { ranked } = rankTags(
      [
        { tagId: 1, productCount: 12, ratingAvg: 4.66666 },
        { tagId: 2, productCount: 11, ratingAvg: null },
      ],
      names,
    );
    expect(ranked.map((r) => r.ratingAvg)).toEqual([4.67, null]);
  });

  it("keeps only the top 25", () => {
    const many = new Map<number, string>();
    const rows = Array.from({ length: 30 }, (_, i) => {
      many.set(i, `tag ${i}`);
      return { tagId: i, productCount: 100 - i, ratingAvg: 4 };
    });
    expect(rankTags(rows, many).ranked).toHaveLength(25);
  });
});

describe("rankTags internal tag filter", () => {
  const names = new Map<number, string>([
    [1, "Food Tours"],
    [367656, "Zombie"],
    [367668, "Agent Low Quality Product"],
    [21972, "Excellent Quality"],
  ]);
  const rows = [
    { tagId: 367656, productCount: 900, ratingAvg: 4.5 },
    { tagId: 1, productCount: 50, ratingAvg: 4.5 },
    { tagId: 367668, productCount: 700, ratingAvg: 4.5 },
    { tagId: 21972, productCount: 20, ratingAvg: 4.5 },
  ];

  it("never returns a listed internal tag, keeps an unlisted one, and reports what it removed", () => {
    const { ranked, internal, unnamed } = rankTags(rows, names);
    expect(ranked.map((r) => r.name)).toEqual(["Food Tours", "Excellent Quality"]);
    expect(internal).toEqual([367656, 367668]);
    expect(unnamed).toEqual([]);
  });

  it("removes them before the cut, so they never take one of the 25 slots", () => {
    const many = new Map<number, string>();
    const big = [{ tagId: 367656, productCount: 5000, ratingAvg: 5 }];
    many.set(367656, "Zombie");
    for (let i = 1; i <= 25; i++) {
      many.set(i, `Tag ${i}`);
      big.push({ tagId: i, productCount: 100 + i, ratingAvg: 4 });
    }
    const { ranked } = rankTags(big, many);
    expect(ranked).toHaveLength(25);
    expect(ranked.some((r) => r.name === "Zombie")).toBe(false);
  });

  it("is deterministic whatever the input order", () => {
    expect(rankTags([...rows].reverse(), names)).toEqual(rankTags(rows, names));
  });

  it("leaves Top Product, Worry-Free Shore Excursion and Excellent Quality to the data", () => {
    for (const id of [367652, 367649, 21972]) expect(INTERNAL_TAGS.has(id)).toBe(false);
    expect(INTERNAL_TAGS.size).toBe(17);
  });

  it("lists only ids in the 3676xx operational block or evidenced ones", () => {
    for (const id of INTERNAL_TAGS.keys()) expect(id).toBeGreaterThanOrEqual(367650);
  });
});

describe("rankAttractions", () => {
  const tours = [
    ...Array.from({ length: 6 }, () => ({ title: "Grand Palace and Wat Pho tour", ratingAvg: 4.5, ratingCount: 20 })),
    { title: "Floating market day trip", ratingAvg: 4, ratingCount: 2 },
  ];

  it("uses Viator's own product count when any attraction has one", () => {
    const { ranked, mode } = rankAttractions(
      [
        { name: "Grand Palace", productCount: 30, ratingAvg: 4.7 },
        { name: "Small Shrine", productCount: 2 },
      ],
      tours,
    );
    expect(mode).toBe("viator_count");
    expect(ranked.map((r) => r.name)).toEqual(["Grand Palace"]);
  });

  it("falls back to counting title matches when Viator gives no counts", () => {
    const { ranked, mode } = rankAttractions([{ name: "grand palace" }, { name: "Floating market" }], tours);
    expect(mode).toBe("title_match");
    expect(ranked).toEqual([{ name: "grand palace", productCount: 6, ratingAvg: 4.5 }]);
  });

  it("ignores duplicate names after cleaning", () => {
    const { ranked } = rankAttractions(
      [
        { name: "Grand Palace", productCount: 30 },
        { name: "grand palace!", productCount: 29 },
      ],
      [],
    );
    expect(ranked).toHaveLength(1);
  });
});

describe("cityFigures", () => {
  it("counts every tour and averages only tours with enough reviews", () => {
    expect(
      cityFigures([
        { title: "a", ratingAvg: 4, ratingCount: 10 },
        { title: "b", ratingAvg: 5, ratingCount: 5 },
        { title: "c", ratingAvg: 1, ratingCount: 1 },
        { title: "d", ratingAvg: null, ratingCount: null },
      ]),
    ).toEqual({ productCount: 4, ratingAvg: 4.5 });
  });
});

describe("buildCandidates", () => {
  const city = { productCount: 2000, ratingAvg: 4.4 };
  const tags = [{ name: "Food Tours", productCount: 300, ratingAvg: 4.7 }];
  const attractions = [{ name: "Wat Arun (Temple of Dawn)", productCount: 50, ratingAvg: 4.6 }];

  it("makes the city, tag and attraction queries and ranks them by product count", () => {
    const { candidates } = buildCandidates("Bangkok", city, tags, attractions);
    expect(candidates.map((c) => c.query)).toEqual([
      "best time to visit bangkok",
      "things to do in bangkok",
      "best food tours in bangkok",
      "food tours in bangkok",
      "wat arun temple of dawn tickets",
      "wat arun temple of dawn tours",
    ]);
    expect(candidates.map((c) => c.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(candidates[0]).toMatchObject({ families: ["best_time"], source: "city", productCount: 2000 });
  });

  it("gives the same list for the same input", () => {
    expect(buildCandidates("Bangkok", city, tags, attractions)).toEqual(
      buildCandidates("Bangkok", city, tags, attractions),
    );
  });

  it("merges a query that two families make and keeps both labels", () => {
    const { candidates } = buildCandidates("Bangkok", city, [{ name: "Things to do", productCount: 10, ratingAvg: 4 }], []);
    const merged = candidates.find((c) => c.query === "things to do in bangkok");
    expect(merged?.families).toEqual(["tag", "things_to_do"]);
    expect(merged?.productCount).toBe(2000);
    expect(candidates.filter((c) => c.query === "things to do in bangkok")).toHaveLength(1);
  });

  it("drops and lists a query that is too long or has too many words", () => {
    const long = "one two three four five six seven eight nine";
    const { candidates, dropped } = buildCandidates("Bangkok", city, [{ name: long, productCount: 20, ratingAvg: 4 }], []);
    expect(candidates.some((c) => c.query.includes("nine"))).toBe(false);
    expect(dropped.map((d) => d.reason)).toEqual(["over 10 words", "over 10 words"]);
  });
});

describe("candidatesToCsv", () => {
  it("writes a header, one row per query, and quotes cells that need it", () => {
    const csv = candidatesToCsv([
      { query: 'rock, "roll"', families: ["tag", "attraction"], source: "tag", productCount: 3, ratingAvg: null, rank: 1 },
    ]);
    expect(csv).toBe(
      'query,families,source,productCount,ratingAvg,rank\n"rock, ""roll""",tag|attraction,tag,3,,1\n',
    );
  });
});
