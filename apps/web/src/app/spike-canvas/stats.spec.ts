import { describe, expect, it } from "@jest/globals";
import { crossingSummary, notePanInput, panFrameDeltas, type PanWindow } from "./stats";

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
    // Frames ending in (1000, 1300]: 18 frames of 16.7 ms.
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
    const deltas = panFrameDeltas(frames, [
      [100, 200],
      [2000, 2100],
    ]);
    const inWindows = frames.filter(([t]) => (t > 100 && t <= 200) || (t > 2000 && t <= 2100));
    expect(deltas).toHaveLength(inWindows.length);
    expect(panFrameDeltas(frames, [[100, 200], [2000, 2100]], 1500)).toHaveLength(
      inWindows.filter(([t]) => t >= 1500).length,
    );
  });
});

describe("crossingSummary", () => {
  it("counts frames over 25 ms and those ending within 100 ms after a crossing, with the chance rate", () => {
    const frames: [number, number][] = [
      [16, 16],
      [50, 34], // 40 ms after the crossing at 10: a hitch after a crossing
      [66, 16],
      [200, 40], // 190 ms after it: a hitch, not after a crossing
      [216, 16],
    ];
    expect(crossingSummary(frames, [10])).toEqual({
      frames: 5,
      crossings: 1,
      hitches: 2,
      hitchesAfterCrossing: 1,
      baseRate: 3 / 5,
    });
  });

  it("does not count a frame ending exactly at the crossing, and counts one exactly 100 ms after", () => {
    expect(crossingSummary([[10, 30], [110, 30]], [10])).toMatchObject({ hitches: 2, hitchesAfterCrossing: 1 });
  });
});
