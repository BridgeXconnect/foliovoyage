/**
 * THROWAWAY (canvas performance spike, BRI-223). The phone run list, in the
 * order to run it. Shared by the `/spike-canvas/runs` page and PHONE-RUNS.md.
 */
export const PHONE_RUNS: readonly { query: string; meaning: string }[] = [
  {
    query: "img=off",
    meaning:
      "The key run. Smooth (p95 ≤ 20 ms): the images are the cost. Still janky: the cost is the engine, layout or compositing, not the photos.",
  },
  {
    query: "img=1x",
    meaning:
      "About a quarter of the decoded pixels of full. Close to img=off: image size is the cost, so serve right-sized variants. Close to full: it is the number of images, not their size.",
  },
  {
    query: "tilt=0",
    meaning: "Better than full: drawing rotated photos is the cost (resampling and antialiasing on every repaint).",
  },
  {
    query: "layers=0",
    meaning: "Better than full: repaint scope is the cost, and `contain: paint` on each tile keeps it small.",
  },
  {
    query: "decode=pre",
    meaning: "Better than full: decoding on first paint causes the jank, so decode before a tile shows its image.",
  },
  {
    query: "img=1x&tilt=0&layers=0&decode=pre",
    meaning:
      "Everything on at once. Still over 20 ms: what is left is the engine, React mounts or the compositor, and the engine budget goes there.",
  },
  {
    query: "",
    meaning: "Optional: the baseline again, last, to check whether the phone got warm and slowed down over the session.",
  },
];

export const runUrl = (origin: string, query: string) => `${origin}/spike-canvas?overlay=1${query ? `&${query}` : ""}`;
