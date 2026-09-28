import { describe, expect, it } from "@jest/globals";

import type { TagVocabulary } from "./tag-resolver";
import {
  main,
  type CategoryBackfillStore,
  type CategoryTourRow,
  type TagVocabularySource,
} from "./backfill-tour-category.cli";

/**
 * Small DAG mirroring category-rule.spec.ts's shape: 21910 (Art & Culture)
 * and 21913 (Tours, Sightseeing & Cruises) are category roots; 100 and 200
 * are ordinary tags that climb to them.
 */
const VOCAB: TagVocabulary = {
  graph: new Map([
    [21910, []],
    [21913, []],
    [100, [21910]],
    [200, [21913]],
  ]),
  names: new Map([
    [21910, "Art & Culture"],
    [21913, "Tours, Sightseeing & Cruises"],
  ]),
};

function fakeVocabulary(vocab: TagVocabulary = VOCAB): TagVocabularySource {
  return { getVocabulary: () => Promise.resolve(vocab) };
}

function tour(overrides: Partial<CategoryTourRow> & { id: string }): CategoryTourRow {
  return {
    tags: [],
    primaryCategoryTagId: null,
    destinationRefs: ["343"], // Bangkok
    ...overrides,
  };
}

/** In-memory store; records every write it was asked to make. */
function fakeStore(rows: CategoryTourRow[]): CategoryBackfillStore & { writes: [string, number | null, number | null][] } {
  const writes: [string, number | null, number | null][] = [];
  return {
    writes,
    tours: () => Promise.resolve(rows.map((r) => ({ ...r }))),
    updateCategory: (id, from, to) => {
      writes.push([id, from, to]);
      const row = rows.find((r) => r.id === id);
      if (!row || row.primaryCategoryTagId !== from) return Promise.resolve(0);
      row.primaryCategoryTagId = to;
      return Promise.resolve(1);
    },
  };
}

function io() {
  const lines: string[] = [];
  const errors: string[] = [];
  return {
    out: (line: string) => lines.push(line),
    err: (line: string) => errors.push(line),
    lines,
    errors,
    text: () => lines.join("\n"),
  };
}

describe("backfill-tour-category parseArgs (via main)", () => {
  it("rejects an unknown argument", async () => {
    const output = io();
    const code = await main(["--bogus"], {}, output, {
      store: fakeStore([]),
      vocabulary: fakeVocabulary(),
    });
    expect(code).toBe(1);
    expect(output.errors[0]).toMatch(/Unknown argument/);
  });

  it("rejects an unknown --city slug", async () => {
    const output = io();
    const code = await main(["--city", "atlantis"], {}, output, {
      store: fakeStore([]),
      vocabulary: fakeVocabulary(),
    });
    expect(code).toBe(1);
    expect(output.errors[0]).toMatch(/--city needs one of/);
  });
});

describe("backfill-tour-category — dry run (default)", () => {
  it("reports the would-change count and never writes", async () => {
    const store = fakeStore([
      tour({ id: "A", tags: [100] }), // → 21910 (changes: stored null)
      tour({ id: "B", tags: [200] }), // → 21913 (changes: stored null)
      tour({ id: "C", tags: [] }), // → null (already correct: stored null too)
    ]);
    const output = io();

    const code = await main([], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(code).toBe(0);
    expect(store.writes).toHaveLength(0);
    expect(output.text()).toMatch(/Dry run: would update 2 row\(s\)/);
    expect(output.text()).toMatch(/21910\s+Art & Culture\s+1/);
    expect(output.text()).toMatch(/21913\s+Tours, Sightseeing & Cruises\s+1/);
    expect(output.text()).toMatch(/\(null\).*1/);
  });

  it("does not count a tour whose stored category already matches", async () => {
    const store = fakeStore([tour({ id: "A", tags: [100], primaryCategoryTagId: 21910 })]);
    const output = io();

    await main([], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(output.text()).toMatch(/Dry run: would update 0 row\(s\)/);
  });
});

describe("backfill-tour-category --execute", () => {
  it("writes only the changed rows, guarded on the old value", async () => {
    const store = fakeStore([
      tour({ id: "A", tags: [100], primaryCategoryTagId: null }), // changes to 21910
      tour({ id: "B", tags: [200], primaryCategoryTagId: 21913 }), // already correct
    ]);
    const output = io();

    const code = await main(["--execute"], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(code).toBe(0);
    expect(store.writes).toEqual([["A", null, 21910]]);
    expect(output.text()).toMatch(/Updated 1 Tour row\(s\)/);
  });

  it("counts a raced (already-changed-underneath-us) row as skipped, not written", async () => {
    const rows = [tour({ id: "A", tags: [100], primaryCategoryTagId: null })];
    const store = fakeStore(rows);
    // Simulate a concurrent writer: by the time our update fires, the row no
    // longer holds the `from` value the plan was built against.
    const originalUpdate = store.updateCategory;
    store.updateCategory = (id, from, to) => {
      rows[0].primaryCategoryTagId = 999; // raced away underneath us
      return originalUpdate(id, from, to);
    };
    const output = io();

    await main(["--execute"], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(output.text()).toMatch(/Updated 0 Tour row\(s\); 1 skipped because the row changed underneath us/);
  });
});

describe("backfill-tour-category --city", () => {
  it("restricts scanning to tours in the given curated city", async () => {
    const store = fakeStore([
      tour({ id: "A", tags: [100], destinationRefs: ["343"] }), // Bangkok
      tour({ id: "B", tags: [200], destinationRefs: ["999999"] }), // not curated / different city
    ]);
    const output = io();

    await main(["--city", "bangkok"], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(output.text()).toMatch(/Restricted to bangkok: 1 of 2 tour\(s\)/);
    expect(output.text()).toMatch(/Tours scanned: 1/);
  });
});

describe("backfill-tour-category — unresolved tag ids", () => {
  it("reports every unresolved tag id across the batch, never silently dropping it", async () => {
    const store = fakeStore([
      tour({ id: "A", tags: [100, 999999] }),
      tour({ id: "B", tags: [888888] }),
    ]);
    const output = io();

    await main([], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(output.text()).toMatch(/Unresolved tag id\(s\).*888888, 999999/);
  });

  it("says every tag id resolved when nothing is missing", async () => {
    const store = fakeStore([tour({ id: "A", tags: [100] })]);
    const output = io();

    await main([], {}, output, { store, vocabulary: fakeVocabulary() });

    expect(output.text()).toMatch(/Every tag id referenced by a scanned tour is present in the vocabulary\./);
  });
});
