import type { Metadata } from "next";
import SpikeCanvas from "./spike-canvas";

/**
 * THROWAWAY (canvas performance spike, BRI-223). Not linked from anywhere, not
 * in the sitemap, never merged. Query parameters: `overlay=1` shows the frame
 * stats, `section` and `overscan` override the culler, `img=tier` asks the CDN
 * for tier sized images instead of the feed's 674 px ones.
 */
export const metadata: Metadata = {
  title: "Canvas spike",
  robots: { index: false, follow: false },
};

export default function SpikeCanvasPage() {
  return <SpikeCanvas />;
}
