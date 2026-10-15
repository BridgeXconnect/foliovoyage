import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * Spec 0006 AC-G3 on the built output, not the source: the edge middleware
 * bundle that `next build` emits has no `fs` import. Needs a build first
 * (`pnpm --filter @folio/web build`). Without one the suite is skipped and
 * says so in its name, so a skip is visible in the run output.
 */

const NEXT_DIR = path.resolve(__dirname, "../.next");
const MANIFEST = path.join(NEXT_DIR, "server/middleware-manifest.json");
const built = existsSync(MANIFEST);

interface MiddlewareManifest {
  middleware: Record<string, { files: string[]; name: string }>;
}

const bundleFiles = (): string[] => {
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as MiddlewareManifest;
  return Object.values(manifest.middleware).flatMap((m) => m.files);
};
const read = (file: string) => readFileSync(path.join(NEXT_DIR, file), "utf8");

// Any way a bundle could reach the file system module: a require, an import, or a
// quoted module id, with or without the node: scheme or the promises subpath.
const FS_IMPORT = /["'`](?:node:)?fs(?:\/promises)?["'`]/;

(built ? describe : describe.skip)(
  built ? "built edge middleware bundle (spec 0006 AC-G3)" : "built edge middleware bundle (SKIPPED: no .next build)",
  () => {
    it("is registered as the edge middleware for every path", () => {
      const files = bundleFiles();
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => /middleware\.js$/.test(f))).toBe(true);
    });

    it("contains the slice gate, so this is a build of the current middleware", () => {
      const middlewareFile = bundleFiles().find((f) => /middleware\.js$/.test(f))!;
      expect(read(middlewareFile)).toContain("/sitemap-slice.xml");
    });

    it("has no fs import in any of its files", () => {
      for (const file of bundleFiles()) {
        const hit = FS_IMPORT.exec(read(file));
        expect([file, hit?.[0] ?? null]).toEqual([file, null]);
      }
    });
  },
);
