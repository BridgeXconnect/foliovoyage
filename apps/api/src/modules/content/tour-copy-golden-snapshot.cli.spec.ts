import { describe, expect, it } from "@jest/globals";

import { GOLDEN_TOURS_FILE, validateSnapshotShape } from "./tour-copy-golden-data";
import {
  main,
  selectGoldenTours,
  type SnapshotCandidate,
  type SnapshotCliDeps,
} from "./tour-copy-golden-snapshot.cli";

const CITIES = ["bangkok", "paris", "rome", "lisbon", "tokyo", "athens"];
const FILLER = "The guide walks a small group through quiet lanes and explains the history of each stop along the route in plain words. ";

function candidate(index: number, over: Partial<SnapshotCandidate> = {}): SnapshotCandidate {
  return {
    id: `tour-${String(index).padStart(3, "0")}`,
    title: `Walking tour number ${index}`,
    description: FILLER.repeat(3),
    durationMin: 120,
    inclusions: ["Guide"],
    exclusions: ["Tips"],
    citySlug: CITIES[index % CITIES.length],
    failureReasons: [],
    ...over,
  };
}

/** 300 tours: 40 failures over 4 reason codes, a few of each edge kind, the rest typical across 6 cities. */
function pool(): SnapshotCandidate[] {
  const list: SnapshotCandidate[] = [];
  for (let i = 0; i < 300; i++) list.push(candidate(i));
  const codes = ["word_count", "low_overlap", "unsourced_number", "sentence_count"];
  for (let i = 0; i < 40; i++) list[i] = candidate(i, { failureReasons: [codes[i % codes.length]] });
  for (let i = 100; i < 106; i++) list[i] = candidate(i, { description: "x".repeat(340 - 30), title: "Short" });
  for (let i = 110; i < 116; i++) list[i] = candidate(i, { durationMin: null });
  for (let i = 120; i < 126; i++) list[i] = candidate(i, { description: `${FILLER.repeat(3)} 2 3 4 5 6 7 8 9 10 stops.` });
  for (let i = 130; i < 136; i++) list[i] = candidate(i, { description: `<p>${FILLER.repeat(3)}</p>` });
  for (let i = 140; i < 146; i++) list[i] = candidate(i, { exclusions: [{ description: "Not included: " + "x".repeat(320) }] });
  return list;
}

describe("selectGoldenTours", () => {
  it("picks exactly 60 distinct tours with the strata sizes 24, 12 and 24", () => {
    const tours = selectGoldenTours(pool());
    expect(tours).toHaveLength(60);
    expect(new Set(tours.map((t) => t.id)).size).toBe(60);
    const count = (prefix: string) => tours.filter((t) => t.stratum.startsWith(prefix)).length;
    expect(count("failure:")).toBe(24);
    expect(count("edge:")).toBe(12);
    expect(count("typical:")).toBe(24);
  });

  it("spreads the failure stratum over the reason codes", () => {
    const tours = selectGoldenTours(pool());
    const failures = tours.filter((t) => t.stratum.startsWith("failure:")).map((t) => t.stratum);
    expect(new Set(failures)).toEqual(new Set(["failure:word_count", "failure:low_overlap", "failure:unsourced_number", "failure:sentence_count"]));
    expect(failures.filter((s) => s === "failure:word_count")).toHaveLength(6);
  });

  it("covers every edge kind and every city", () => {
    const tours = selectGoldenTours(pool());
    const kinds = new Set(tours.filter((t) => t.stratum.startsWith("edge:")).map((t) => t.stratum));
    expect([...kinds].sort()).toEqual(["edge:long_exclusions", "edge:many_numbers", "edge:markup", "edge:null_duration", "edge:short_source"]);
    const cities = new Set(tours.filter((t) => t.stratum.startsWith("typical:")).map((t) => t.stratum));
    expect(cities.size).toBe(6);
  });

  it("is deterministic and does not depend on the input order", () => {
    const list = pool();
    const a = selectGoldenTours(list);
    const b = selectGoldenTours([...list].reverse());
    expect(b).toEqual(a);
  });

  it("fills a failure shortfall from the typical stratum", () => {
    const list = pool().map((c) => ({ ...c, failureReasons: c.id < "tour-005" ? ["word_count"] : [] }));
    const tours = selectGoldenTours(list);
    expect(tours).toHaveLength(60);
    expect(tours.filter((t) => t.stratum.startsWith("failure:"))).toHaveLength(5);
    expect(tours.filter((t) => t.stratum.startsWith("typical:"))).toHaveLength(43);
  });

  it("never picks a tour whose source is under the thin source floor", () => {
    const list = pool();
    list[200] = candidate(200, { title: "T", description: "short", inclusions: [], exclusions: [] });
    const ids = selectGoldenTours(list).map((t) => t.id);
    expect(ids).not.toContain("tour-200");
  });

  it("never treats source_too_thin as a failure stratum", () => {
    const list = pool().map((c, i) => (i < 10 ? { ...c, failureReasons: ["source_too_thin"] } : c));
    expect(selectGoldenTours(list).some((t) => t.stratum === "failure:source_too_thin")).toBe(false);
  });

  it("throws when fewer than 60 tours are usable", () => {
    expect(() => selectGoldenTours(pool().slice(0, 59))).toThrow("Only 59 tours are usable");
  });

  it("writes only the five source fields plus id and stratum", () => {
    const tours = selectGoldenTours(pool());
    expect(Object.keys(tours[0]).sort()).toEqual(["description", "durationMin", "exclusions", "id", "inclusions", "stratum", "title"]);
    expect(validateSnapshotShape(tours)).toEqual([]);
  });
});

describe("tour-copy-golden:snapshot", () => {
  function harness(over: Partial<SnapshotCliDeps> = {}) {
    const out: string[] = [];
    const err: string[] = [];
    const writes: Array<{ file: string; content: string }> = [];
    let disconnected = false;
    const deps: SnapshotCliDeps = {
      store: { loadCandidates: async () => pool() },
      writeFile: (file, content) => void writes.push({ file, content }),
      fileExists: () => false,
      disconnect: async () => void (disconnected = true),
      ...over,
    };
    const run = (argv: string[]) => main(argv, {}, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
    return { run, out, err, writes, isDisconnected: () => disconnected };
  }

  it("is a dry run by default: prints the strata and writes nothing", async () => {
    const h = harness();
    expect(await h.run([])).toBe(0);
    expect(h.writes).toHaveLength(0);
    expect(h.out.join("\n")).toContain("60 selected");
    expect(h.out.join("\n")).toContain("Dry run");
    expect(h.isDisconnected()).toBe(true);
  });

  it("writes the tours file with --execute", async () => {
    const h = harness();
    expect(await h.run(["--execute"])).toBe(0);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].file).toBe(GOLDEN_TOURS_FILE);
    const written = JSON.parse(h.writes[0].content) as Array<Record<string, unknown>>;
    expect(written).toHaveLength(60);
    expect(written.every((t) => !("referenceParagraph" in t))).toBe(true);
  });

  it("refuses to overwrite an existing file, before reading the database", async () => {
    let loaded = false;
    const h = harness({ fileExists: () => true, store: { loadCandidates: async () => ((loaded = true), pool()) } });
    expect(await h.run(["--execute"])).toBe(1);
    expect(h.err.join("\n")).toContain("will not overwrite");
    expect(loaded).toBe(false);
    expect(h.writes).toHaveLength(0);
  });

  it("exits 1 when there are too few tours, and writes nothing", async () => {
    const h = harness({ store: { loadCandidates: async () => pool().slice(0, 10) } });
    expect(await h.run(["--execute"])).toBe(1);
    expect(h.writes).toHaveLength(0);
    expect(h.isDisconnected()).toBe(true);
  });

  it("rejects an unknown argument", async () => {
    const h = harness();
    expect(await h.run(["--freeze"])).toBe(1);
  });
});
