import { describe, expect, it } from "@jest/globals";
import { notePanInput, panFrameDeltas, percentile, summarize, type PanWindow } from "./stats";

describe("notePanInput", () => {
  it("opens a window at the first input and extends it while inputs keep coming", () => {
    const windows: PanWindow[] = [];
    notePanInput(windows, 1000);
    notePanInput(windows, 1100);
    notePanInput(windows, 1390); // inside the 300 ms tail of 1100
    expect(windows).toEqual([[1000, 1690]]);
  });

  it("opens a new window after the tail has run out", () => {
    const windows: PanWindow[] = [];
    notePanInput(windows, 1000);
    notePanInput(windows, 1301);
    expect(windows).toEqual([
      [1000, 1300],
      [1301, 1601],
    ]);
  });
});

describe("panFrameDeltas", () => {
  // A frame every 16.7 ms from 0 to 3000 ms, plus one 900 ms stall ending at 4000.
  const frames: [number, number][] = [];
  for (let t = 16.7; t < 3000; t += 16.7) frames.push([t, 16.7]);
  frames.push([4000, 900]);

  it("counts only frames that end inside a pan window", () => {
    const deltas = panFrameDeltas(frames, [[1000, 1300]]);
    expect(deltas).toHaveLength(frames.filter(([t]) => t > 1000 && t <= 1300).length);
    expect(deltas.every((d) => d === 16.7)).toBe(true);
  });

  it("returns nothing when there was no pan, however long the page sat idle", () => {
    expect(panFrameDeltas(frames, [])).toEqual([]);
  });

  it("keeps a slow frame that ends inside a window, and drops one that ends after it", () => {
    expect(panFrameDeltas(frames, [[3500, 4000]])).toEqual([900]);
    expect(panFrameDeltas(frames, [[3500, 3999]])).toEqual([]);
  });

  it("joins several windows and applies `since`", () => {
    const windows: PanWindow[] = [
      [100, 200],
      [2000, 2100],
    ];
    const inWindows = frames.filter(([t]) => (t > 100 && t <= 200) || (t > 2000 && t <= 2100));
    expect(panFrameDeltas(frames, windows)).toHaveLength(inWindows.length);
    expect(panFrameDeltas(frames, windows, 1500)).toHaveLength(inWindows.filter(([t]) => t >= 1500).length);
  });
});

describe("summarize", () => {
  it("reports percentiles, the worst frame and frames over 25 ms", () => {
    const deltas = [...Array.from({ length: 98 }, () => 16), 30, 50];
    expect(summarize(deltas, { distance: 1234, seconds: 30, maxMounted: 52, longTasks: 1 })).toEqual({
      p50: 16,
      p95: 16,
      p99: 30,
      worst: 50,
      frames: 100,
      hitches: 2,
      distance: 1234,
      seconds: 30,
      maxMounted: 52,
      longTasks: 1,
    });
  });

  it("is all zeros with no frames", () => {
    expect(percentile([], 95)).toBe(0);
    expect(summarize([], { distance: 0, seconds: 0, maxMounted: 0, longTasks: 0 }).worst).toBe(0);
  });
});
