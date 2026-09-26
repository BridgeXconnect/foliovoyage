import { describe, expect, it } from "@jest/globals";

import {
  canonicalJson,
  computeGoldenStampKey,
  goldenDataFilesPresent,
  GOLDEN_SEEDED_COUNT,
  GOLDEN_TOUR_COUNT,
  loadGoldenData,
  validateGoldenData,
  validateSnapshotShape,
} from "./tour-copy-golden-data";
import { makeGoldenData, makeGoldenTour, PASSING_PARAGRAPH } from "./tour-copy-golden.fixtures";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("the synthetic fixture", () => {
  it("has a reference paragraph that passes the inline check", () => {
    const { tours, seeded } = makeGoldenData();
    expect(validateGoldenData(tours, seeded)).toEqual([]);
    expect(PASSING_PARAGRAPH.split(" ")).toHaveLength(43);
  });
});

describe("validateGoldenData", () => {
  it("accepts exactly 60 tours and 30 seeded paragraphs of the right mix", () => {
    const { tours, seeded } = makeGoldenData();
    expect(tours).toHaveLength(GOLDEN_TOUR_COUNT);
    expect(seeded).toHaveLength(GOLDEN_SEEDED_COUNT);
    expect(validateGoldenData(tours, seeded)).toEqual([]);
  });

  it("rejects a wrong tour count", () => {
    const { tours, seeded } = makeGoldenData();
    expect(validateGoldenData(tours.slice(0, 59), seeded).join("\n")).toContain("Expected 60 tours, found 59");
  });

  it("rejects a wrong seeded count", () => {
    const { tours, seeded } = makeGoldenData();
    expect(validateGoldenData(tours, seeded.slice(0, 29)).join("\n")).toContain("Expected 30 seeded paragraphs, found 29");
  });

  it("rejects a repeated tour id", () => {
    const { tours, seeded } = makeGoldenData();
    tours[5].id = tours[4].id;
    expect(validateGoldenData(tours, seeded).join("\n")).toContain("repeats the id");
  });

  it("rejects a tour with an extra field, and names price, rating and cancellation fields", () => {
    const { tours, seeded } = makeGoldenData();
    (tours[0] as unknown as Record<string, unknown>).price = 40;
    (tours[1] as unknown as Record<string, unknown>).ratingAvg = 4.5;
    (tours[2] as unknown as Record<string, unknown>).cancellationPolicy = "free";
    const text = validateGoldenData(tours, seeded).join("\n");
    expect(text).toContain("price must never be in the golden set");
    expect(text).toContain("ratingAvg must never be in the golden set");
    expect(text).toContain("cancellationPolicy must never be in the golden set");
  });

  it("rejects a tour with a missing field", () => {
    const { tours, seeded } = makeGoldenData();
    delete (tours[0] as unknown as Record<string, unknown>).exclusions;
    expect(validateGoldenData(tours, seeded).join("\n")).toContain("Tour 1 must hold exactly");
  });

  it("rejects a reference paragraph that fails the inline check", () => {
    const { tours, seeded } = makeGoldenData();
    tours[7].referenceParagraph = "Too short.";
    const text = validateGoldenData(tours, seeded).join("\n");
    expect(text).toContain("fails the inline check");
    expect(text).toContain("tour-07");
  });

  it("rejects a missing reference paragraph", () => {
    const { tours, seeded } = makeGoldenData();
    tours[3].referenceParagraph = "  ";
    expect(validateGoldenData(tours, seeded).join("\n")).toContain("Tour 4 needs a reference paragraph");
  });

  it("rejects a seeded paragraph with the wrong keys or a tour that does not exist", () => {
    const { tours, seeded } = makeGoldenData();
    delete (seeded[0] as unknown as Record<string, unknown>).defect;
    seeded[1].tourId = "no-such-tour";
    const text = validateGoldenData(tours, seeded).join("\n");
    expect(text).toContain("Seeded paragraph 1 must hold exactly");
    expect(text).toContain("Seeded paragraph 2 names a tour that is not in the tours file");
  });

  it("rejects the wrong defect mix", () => {
    const { tours, seeded } = makeGoldenData();
    seeded[0].claimVerdict = "contradicted";
    const text = validateGoldenData(tours, seeded).join("\n");
    expect(text).toContain("Expected 10 seeded unsupported paragraphs, found 9");
    expect(text).toContain("Expected 6 seeded contradicted paragraphs, found 7");
  });

  it("rejects the wrong number of clean controls that do not lead with a fact", () => {
    const { tours, seeded } = makeGoldenData();
    const lastClean = seeded[seeded.length - 1];
    lastClean.leadsWithFact = true;
    expect(validateGoldenData(tours, seeded).join("\n")).toContain("Expected 4 seeded cleanNotLeading paragraphs, found 3");
  });

  it("rejects a clean control marked subtle", () => {
    const { tours, seeded } = makeGoldenData();
    seeded[20].subtle = true;
    expect(validateGoldenData(tours, seeded).join("\n")).toContain("clean control and cannot be subtle");
  });

  it("rejects files that are not arrays", () => {
    expect(validateGoldenData({}, [])).toEqual(["The tours file is not a JSON array."]);
    expect(validateGoldenData(makeGoldenData().tours, {}).join("\n")).toContain("The seeded file is not a JSON array");
  });
});

describe("validateSnapshotShape", () => {
  it("accepts 60 tours without reference paragraphs", () => {
    const tours = makeGoldenData().tours.map((tour) => {
      const snapshot: Record<string, unknown> = { ...tour };
      delete snapshot.referenceParagraph;
      return snapshot;
    });
    expect(validateSnapshotShape(tours)).toEqual([]);
  });

  it("still accepts tours that already hold a reference paragraph", () => {
    expect(validateSnapshotShape(makeGoldenData().tours)).toEqual([]);
  });

  it("rejects a wrong count and a bad field", () => {
    const tours = [makeGoldenTour(1)];
    (tours[0] as unknown as Record<string, unknown>).durationMin = "90";
    const text = validateSnapshotShape(tours).join("\n");
    expect(text).toContain("Expected 60 tours");
    expect(text).toContain("durationMin");
  });
});

describe("canonicalJson", () => {
  it("does not depend on key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [{ y: 1, x: 2 }] } })).toBe(canonicalJson({ a: { c: [{ x: 2, y: 1 }], d: 2 }, b: 1 }));
  });

  it("keeps array order and values", () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe("computeGoldenStampKey", () => {
  it("is stable for the same data, whatever the key order", () => {
    const data = makeGoldenData();
    const reordered = { tours: data.tours.map((tour) => Object.fromEntries(Object.entries(tour).reverse())), seeded: data.seeded };
    expect(computeGoldenStampKey(data)).toBe(computeGoldenStampKey(clone(data)));
    expect(computeGoldenStampKey(data)).toBe(computeGoldenStampKey(reordered));
    expect(computeGoldenStampKey(data)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when a reference paragraph, a seeded paragraph or a tour changes", () => {
    const data = makeGoldenData();
    const base = computeGoldenStampKey(data);

    const editedReference = clone(data);
    editedReference.tours[0].referenceParagraph += " Extra.";
    expect(computeGoldenStampKey(editedReference)).not.toBe(base);

    const editedSeeded = clone(data);
    editedSeeded.seeded[0].defect = "something else";
    expect(computeGoldenStampKey(editedSeeded)).not.toBe(base);

    const editedTour = clone(data);
    editedTour.tours[0].title = "Another title";
    expect(computeGoldenStampKey(editedTour)).not.toBe(base);
  });

  it("does not let the tours and seeded data trade content", () => {
    const a = computeGoldenStampKey({ tours: [1], seeded: [2] });
    const b = computeGoldenStampKey({ tours: [2], seeded: [1] });
    expect(a).not.toBe(b);
  });
});

// The committed golden files are Roy's to produce (spec 0003, Build plan task 13's
// prerequisite). Until they exist this test is skipped, not passing by accident.
(goldenDataFilesPresent() ? describe : describe.skip)("the committed golden data files (AC-14)", () => {
  it("hold exactly 60 tours and 30 seeded paragraphs with the required fields", () => {
    const data = loadGoldenData();
    expect(data.tours).toHaveLength(GOLDEN_TOUR_COUNT);
    expect(data.seeded).toHaveLength(GOLDEN_SEEDED_COUNT);
  });
});
