import type { Metadata } from "next";
import { PHONE_RUNS, runUrl } from "../runs";

/** THROWAWAY (canvas performance spike, BRI-223). Tappable phone run list. */
export const metadata: Metadata = {
  title: "Canvas spike runs",
  robots: { index: false, follow: false },
};

export default function SpikeRunsPage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16, font: "16px/1.45 system-ui, sans-serif", color: "#222" }}>
      <h1 style={{ fontSize: 22 }}>Canvas spike: phone runs</h1>
      <p>
        For each run: tap the link, wait about 3 s for the photos to load, tap <b>reset</b>, then pan continuously
        for 20 s, left and right across the four slots. Stop, wait 1 s, and take a screenshot with the overlay in it.
        Check that the overlay&apos;s <code>img / tilt / decode / layers</code> line shows what the run says, and that there is no red INVALID line.
      </p>
      <ol>
        {PHONE_RUNS.map((run) => (
          <li key={run.query} style={{ marginBottom: 14 }}>
            <a href={runUrl("", run.query)} style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
              ?overlay=1{run.query ? `&${run.query}` : ""}
            </a>
            <div>{run.meaning}</div>
          </li>
        ))}
      </ol>
    </main>
  );
}
