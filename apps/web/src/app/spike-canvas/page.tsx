import type { Metadata } from "next";
import SpikeCanvas from "./spike-canvas";

/**
 * THROWAWAY (canvas performance spike, BRI-223). Not linked from anywhere, not
 * in the sitemap, never merged. Query parameters: `overlay=1` shows the frame
 * stats, `section` and `overscan` override the culler, and the diagnostic
 * switches `img=full|1x|2x|off`, `tilt=0`, `cap=<n>`, `decode=pre` and
 * `layers=0` are described in `config.ts`. An unknown value shows as INVALID.
 */
export const metadata: Metadata = {
  title: "Canvas spike",
  robots: { index: false, follow: false },
};

export default function SpikeCanvasPage() {
  return <SpikeCanvas />;
}
