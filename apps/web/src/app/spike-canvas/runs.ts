/**
 * THROWAWAY (canvas performance spike, BRI-223). The phone run list, in the
 * order to run it. Shared by the `/spike-canvas/runs` page and PHONE-RUNS.md.
 * Every run is the hands-off scripted pan (`auto=1`).
 */
export const PHONE_RUNS: readonly { query: string; meaning: string }[] = [
  {
    query: "auto=1&overlay=1",
    meaning: "Baseline: React mounts each section crossing's tiles in one commit, 512 px sections, overscan 1. Every other run is compared with this one.",
  },
  {
    query: "auto=1&overlay=1&mount=batch",
    meaning:
      "At most 4 tiles shown per frame, without React. Fewer frames over 25 ms than the baseline: the burst of mounts at a crossing is the hitch.",
  },
  {
    query: "auto=1&overlay=1&section=256&overscan=2",
    meaning:
      "Quarter-area sections: more crossings, each mounting fewer tiles, over a similar mounted area. Better than the baseline: the size of each burst matters more than how often it happens.",
  },
  {
    query: "auto=1&overlay=1&mount=batch&section=256&overscan=2",
    meaning: "Both together. Better than either alone: the two add up.",
  },
  {
    query: "auto=1&overlay=lite",
    meaning:
      "Baseline with an opaque overlay updated once a second. Clearly better than run 1: the full overlay itself costs frames, and runs 1 to 4 overstate the hitches.",
  },
  {
    query: "auto=1&overlay=lite&mount=batch&section=256&overscan=2",
    meaning:
      "The best combination with the lite overlay: the closest to what the canvas would do without measuring. This is the number to hold against the 20 ms gate.",
  },
];

export const runUrl = (origin: string, query: string) => `${origin}/spike-canvas?${query}`;
