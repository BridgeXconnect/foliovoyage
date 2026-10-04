import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }) }));
jest.mock("posthog-js", () => ({ __esModule: true, default: { capture: jest.fn() } }));

import TourNotFound, { metadata } from "@/app/tours/[experienceId]/not-found";

describe("tour not found page", () => {
  it("is noindex, nofollow", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it("says the tour is no longer available and links back to /discover", () => {
    const html = renderToStaticMarkup(<TourNotFound />);
    expect(html).toContain("This tour is no longer available");
    expect(html).toContain('href="/discover"');
  });

  it("reads no request data on the server (stays static)", () => {
    const dir = path.join(__dirname);
    for (const file of ["not-found.tsx", "page.tsx"]) {
      const src = readFileSync(path.join(dir, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(src).not.toMatch(/searchParams|cookies\(|headers\(|connection\(|force-dynamic/);
    }
  });
});
