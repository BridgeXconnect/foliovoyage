import * as path from "node:path";

import { describe, expect, it } from "@jest/globals";

import { classifyDomain, judgeFamilies, judgeQuery, normalizeDomain, organicTop, type OrganicResult } from "./classify";
import { loadRule } from "./rule";

const rule = loadRule(path.resolve(__dirname, "../../../../../../docs/research/bri-206/rule.md"));
const cls = (domain: string, url = `https://${domain}/x`) => classifyDomain(domain, url, rule);

describe("normalizeDomain", () => {
  it("lowercases and drops www, port and trailing dot", () => {
    expect(normalizeDomain("WWW.Example.COM.")).toBe("example.com");
    expect(normalizeDomain("example.com:8080")).toBe("example.com");
  });
});

describe("classifyDomain", () => {
  it("marks the listed booking sites as marketplaces, subdomains included", () => {
    expect(cls("viator.com").class).toBe("marketplace");
    expect(cls("www.getyourguide.com").class).toBe("marketplace");
    expect(cls("m.klook.com").class).toBe("marketplace");
  });

  it("treats tripadvisor as a marketplace except on its forum and trip paths", () => {
    expect(cls("tripadvisor.com", "https://www.tripadvisor.com/Attraction_Review-g293916").class).toBe("marketplace");
    expect(cls("tripadvisor.com", "https://www.tripadvisor.com/ShowTopic-g293916-i1").class).toBe("forum_or_social");
    expect(cls("tripadvisor.com", "https://www.tripadvisor.com/Trip-abc").class).toBe("forum_or_social");
  });

  it("marks reddit, youtube and the other social sites as forum or social", () => {
    for (const d of ["reddit.com", "old.reddit.com", "youtube.com", "quora.com", "tiktok.com"]) {
      expect(cls(d).class).toBe("forum_or_social");
    }
  });

  it("marks the lonelyplanet forum path as forum but the rest as a big publisher", () => {
    expect(cls("lonelyplanet.com", "https://www.lonelyplanet.com/thorntree/forums/asia").class).toBe("forum_or_social");
    expect(cls("lonelyplanet.com", "https://www.lonelyplanet.com/thailand/bangkok").class).toBe("big_publisher");
  });

  it("marks listed publishers, .gov domains and visit or tourism first labels as big publishers", () => {
    expect(cls("en.wikipedia.org").class).toBe("big_publisher");
    expect(cls("timeout.com").class).toBe("big_publisher");
    expect(cls("tourismthailand.org").class).toBe("big_publisher");
    expect(cls("visitbangkok.com").class).toBe("big_publisher");
    expect(cls("state.gov").class).toBe("big_publisher");
  });

  it("does not let a list entry match a longer unrelated domain", () => {
    expect(cls("notviator.com").class).toBe("small_site");
    expect(cls("myreddit.com").class).toBe("small_site");
  });

  it("falls back to small site for anything unlisted and flags it as unlisted", () => {
    expect(cls("somebangkokblog.com")).toEqual({ class: "small_site", unlisted: true });
  });

  it("checks the classes in order, first match wins", () => {
    // Listed as a marketplace, so it is never re-read as anything else.
    expect(cls("booking.com").unlisted).toBe(false);
  });
});

describe("organicTop", () => {
  const wrap = (items: unknown[]) => ({ tasks: [{ result: [{ items }] }] });
  const org = (rank: number, domain: string, extra: Record<string, unknown> = {}) => ({
    type: "organic",
    rank_group: rank,
    domain,
    url: `https://${domain}/p${rank}`,
    ...extra,
  });

  it("keeps only organic results", () => {
    const top = organicTop(wrap([{ type: "featured_snippet", rank_group: 1, domain: "a.com", url: "https://a.com" }, org(1, "b.com"), { type: "people_also_ask" }]), 10);
    expect(top.map((r) => r.domain)).toEqual(["b.com"]);
  });

  it("keeps one result per domain at its best rank", () => {
    const top = organicTop(wrap([org(3, "a.com"), org(1, "a.com"), org(2, "b.com")]), 10);
    expect(top).toEqual([
      { domain: "a.com", url: "https://a.com/p1", rank: 1 },
      { domain: "b.com", url: "https://b.com/p2", rank: 2 },
    ]);
  });

  it("drops anything ranked below the top n", () => {
    const top = organicTop(wrap([org(10, "a.com"), org(11, "b.com")]), 10);
    expect(top.map((r) => r.domain)).toEqual(["a.com"]);
  });

  it("sorts by rank, not by the order in the response", () => {
    expect(organicTop(wrap([org(4, "d.com"), org(2, "b.com")]), 10).map((r) => r.rank)).toEqual([2, 4]);
  });

  it("falls back to the url host when the domain is missing", () => {
    const top = organicTop(wrap([{ type: "organic", rank_group: 1, url: "https://www.x.com/a" }]), 10);
    expect(top[0]?.domain).toBe("x.com");
  });

  it("returns an empty list for a response with no items", () => {
    expect(organicTop({}, 10)).toEqual([]);
    expect(organicTop(null, 10)).toEqual([]);
    expect(organicTop({ tasks: [{ result: [{ items: null }] }] }, 10)).toEqual([]);
  });
});

describe("judgeQuery", () => {
  const results = (domains: string[]): OrganicResult[] =>
    domains.map((d, i) => ({ domain: d, url: `https://${d}/`, rank: i + 1 }));

  it("is closed at 2 small sites and open at exactly 3", () => {
    const two = judgeQuery(results(["viator.com", "a-blog.com", "b-blog.com", "timeout.com"]), rule);
    const three = judgeQuery(results(["viator.com", "a-blog.com", "b-blog.com", "c-blog.com"]), rule);
    expect(two.smallSites).toBe(2);
    expect(two.verdict).toBe("closed");
    expect(three.smallSites).toBe(3);
    expect(three.verdict).toBe("open");
  });

  it("counts each class", () => {
    const v = judgeQuery(results(["viator.com", "reddit.com", "timeout.com", "blog.com"]), rule);
    expect(v.counts).toEqual({ marketplace: 1, forum_or_social: 1, big_publisher: 1, small_site: 1 });
  });
});

describe("judgeFamilies", () => {
  const q = (n: number, family: "tag" | "attraction", verdict: "open" | "closed", marketplaces = 0) => ({
    query: `${family} ${n}`,
    families: [family] as const,
    verdict,
    marketplaces,
  });
  const by = (rows: ReturnType<typeof judgeFamilies>, family: string) => rows.find((r) => r.family === family)!;

  it("is insufficient data under 5 validated queries, whatever the open share", () => {
    const rows = judgeFamilies([q(1, "tag", "open"), q(2, "tag", "open"), q(3, "tag", "open"), q(4, "tag", "open")], rule);
    expect(by(rows, "tag").verdict).toBe("insufficient_data");
  });

  it("pursues at exactly half open with 5 or more validated", () => {
    const rows = judgeFamilies(
      [q(1, "attraction", "open"), q(2, "attraction", "open"), q(3, "attraction", "closed"), q(4, "attraction", "closed"), q(5, "attraction", "open"), q(6, "attraction", "closed")],
      rule,
    );
    expect(by(rows, "attraction")).toMatchObject({ validated: 6, open: 3, closed: 3, openShare: 0.5, verdict: "pursue" });
  });

  it("skips below half", () => {
    const rows = judgeFamilies([1, 2, 3, 4, 5].map((n) => q(n, "tag", n === 1 ? "open" : "closed")), rule);
    expect(by(rows, "tag")).toMatchObject({ open: 1, verdict: "skip" });
  });

  it("reports the median marketplace count without using it to decide", () => {
    const rows = judgeFamilies([q(1, "tag", "open", 1), q(2, "tag", "open", 5), q(3, "tag", "open", 3), q(4, "tag", "open", 9), q(5, "tag", "open", 7)], rule);
    expect(by(rows, "tag").medianMarketplaces).toBe(5);
    expect(by(rows, "tag").verdict).toBe("pursue");
  });

  it("returns a row for every family, with nulls for an empty one", () => {
    const rows = judgeFamilies([], rule);
    expect(rows.map((r) => r.family)).toEqual(["things_to_do", "tag", "attraction", "best_time"]);
    expect(by(rows, "best_time")).toMatchObject({ validated: 0, openShare: null, medianMarketplaces: null, verdict: "insufficient_data" });
  });

  it("counts a query with two family labels in both", () => {
    const rows = judgeFamilies([{ query: "x", families: ["tag", "attraction"], verdict: "open", marketplaces: 0 }], rule);
    expect(by(rows, "tag").validated).toBe(1);
    expect(by(rows, "attraction").validated).toBe(1);
  });
});
