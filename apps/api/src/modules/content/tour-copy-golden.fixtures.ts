import type { GoldenData, GoldenSeeded, GoldenTour } from "./tour-copy-golden-data";

/**
 * Synthetic golden data for unit tests (BRI-201 / spec 0003, AC-14). Nothing
 * here is real tour content: the real golden files are Roy's to produce from
 * the snapshot, so the validators and the run logic are tested on this shape.
 */

const SOURCE_WORDS = [
  "canalside", "longtail", "boat", "excursion", "passengers", "cruise",
  "past", "floating", "vendors", "selling", "mangoes", "coconuts",
  "noodles", "bracelets", "lanterns", "umbrellas", "postcards", "magnets",
];
const FILLER_WORDS = [
  "castle", "bridge", "forest", "desert", "mountain", "river", "valley",
  "canyon", "meadow", "harbor", "island", "garden", "statue", "fountain",
  "chapel", "tunnel", "stadium", "arena",
];

/** A 3 sentence, 43 word paragraph that shares 10 words with the fixture source, so the inline check passes it. */
export const PASSING_PARAGRAPH = ((): string => {
  const words = [...SOURCE_WORDS.slice(0, 10), ...Array.from({ length: 33 }, (_, i) => FILLER_WORDS[i % FILLER_WORDS.length])];
  const sizes = [15, 14, 14];
  let at = 0;
  return sizes
    .map((size) => {
      const chunk = words.slice(at, at + size);
      at += size;
      return `${chunk[0].charAt(0).toUpperCase()}${chunk[0].slice(1)} ${chunk.slice(1).join(" ")}.`;
    })
    .join(" ");
})();

export function makeGoldenTour(index: number, overrides: Partial<GoldenTour> = {}): GoldenTour {
  return {
    id: `tour-${String(index).padStart(2, "0")}`,
    stratum: index < 24 ? "failure:word_count" : index < 36 ? "edge:short_source" : "typical:bangkok",
    title: "Canalside Longtail Boat Excursion",
    description: `Passengers cruise past floating vendors selling ${SOURCE_WORDS.join(" ")}.`,
    durationMin: 90,
    inclusions: [],
    exclusions: [],
    referenceParagraph: PASSING_PARAGRAPH,
    ...overrides,
  };
}

export function makeGoldenSeeded(tours: GoldenTour[]): GoldenSeeded[] {
  const entries: GoldenSeeded[] = [];
  const add = (count: number, template: Omit<GoldenSeeded, "tourId" | "paragraph">): void => {
    for (let i = 0; i < count; i++) {
      const tour = tours[entries.length % tours.length];
      entries.push({ ...template, tourId: tour.id, paragraph: `Seeded paragraph ${entries.length + 1} for ${tour.id}.` });
    }
  };
  add(10, { claimVerdict: "unsupported", leadsWithFact: true, subtle: false, defect: "invents a stop" });
  add(6, { claimVerdict: "contradicted", leadsWithFact: true, subtle: false, defect: "says the opposite of the source" });
  add(4, { claimVerdict: "unsupported", leadsWithFact: true, subtle: true, defect: "an invented number word" });
  add(6, { claimVerdict: "clean", leadsWithFact: true, subtle: false, defect: "grounded and leads with a fact" });
  add(4, { claimVerdict: "clean", leadsWithFact: false, subtle: false, defect: "grounded but opens on mood" });
  return entries;
}

export function makeGoldenData(): GoldenData {
  const tours = Array.from({ length: 60 }, (_, index) => makeGoldenTour(index));
  return { tours, seeded: makeGoldenSeeded(tours) };
}
