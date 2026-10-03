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
        Every run is hands-off. Tap the link and wait about 3 s for the photos. Tap <b>start 30 s pan</b>, put the phone
        down flat, and don&apos;t touch the screen. After a 3 s countdown the canvas pans by itself for 30 s, then the
        overlay freezes on a <b>RESULT</b> block. Take a screenshot with the whole overlay in it.
      </p>
      <p>
        Check that the overlay&apos;s <code>mount / section / overlay</code> lines show what the run says, and that there
        is no red INVALID line. Keep the conditions the same for every run: Low Power Mode off, same browser.
      </p>
      <ol>
        {PHONE_RUNS.map((run) => (
          <li key={run.query} style={{ marginBottom: 14 }}>
            <a href={runUrl("", run.query)} style={{ fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
              ?{run.query}
            </a>
            <div>{run.meaning}</div>
          </li>
        ))}
      </ol>
    </main>
  );
}
