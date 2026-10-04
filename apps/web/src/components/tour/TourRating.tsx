"use client";

import { useEffect } from "react";

const SCRIPT_SRC = "/protected/tour-rating.js";
const SCRIPT_MARK = "data-tour-rating-script";

/**
 * The rating placeholder and its loader (spec 0005, AC-6). The server renders
 * only the empty element, keyed by the experience id. After mount this injects
 * `/protected/tour-rating.js`, which fetches the rating and fills it, so the
 * rating is never in the page source. It injects on every mount (removing its
 * earlier copy first) because a client side navigation to a second tour page
 * does not reload the document, and an already executed script would not run
 * again.
 */
export function TourRating({ experienceId }: { experienceId: string }) {
  useEffect(() => {
    document.querySelectorAll(`script[${SCRIPT_MARK}]`).forEach((s) => s.remove());
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.setAttribute(SCRIPT_MARK, "");
    document.body.appendChild(script);
  }, [experienceId]);

  return <div data-tour-rating={experienceId} className="mt-2 text-sm text-ink-soft" />;
}
