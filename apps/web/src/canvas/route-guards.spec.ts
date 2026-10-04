/**
 * Route guards for /discover (spec 0004, AC-L12, AC-T4): it stays out of the
 * sitemap, is not blocked in robots.txt (so crawlers can read its noindex), its
 * canvas code is imported by no other route, and the caption tokens in
 * globals.css match the heights the layout reserves.
 */

import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { TIER_CAPTION_HEIGHT, TIER_PHOTO_WIDTH } from "@folio/shared";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.spec\.ts$/.test(name) ? [path] : [];
  });
}

describe("/discover route guards", () => {
  it("is not in the sitemap", () => {
    for (const entry of sitemap()) expect(new URL(entry.url).pathname.startsWith("/discover")).toBe(false);
  });

  it("is not disallowed in robots.txt when the site is open", () => {
    const saved = process.env.SITE_GATE_PASSWORD;
    delete process.env.SITE_GATE_PASSWORD;
    try {
      const rules = [robots().rules].flat();
      for (const rule of rules) {
        for (const path of [rule?.disallow ?? []].flat()) expect("/discover".startsWith(path)).toBe(false);
      }
    } finally {
      if (saved !== undefined) process.env.SITE_GATE_PASSWORD = saved;
    }
  });

  it("is noindex", () => {
    const page = readFileSync(join(SRC, "app/discover/page.tsx"), "utf8");
    expect(page).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("keeps the canvas code out of every other route", () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => {
        const rel = relative(SRC, file);
        return !rel.startsWith("canvas/") && !rel.startsWith("app/discover/");
      })
      .filter((file) => /from\s+["'](@\/canvas|\.\.?\/(\.\.\/)*canvas)(\/|["'])/.test(readFileSync(file, "utf8")))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});

describe("canvas tokens", () => {
  const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
  const token = (name: string) => {
    const match = css.match(new RegExp(`--${name}:\\s*(\\d+)px`));
    return match ? Number(match[1]) : null;
  };

  it("pins the caption heights to the layout's constants", () => {
    expect(token("container-caption-lg")).toBe(TIER_CAPTION_HEIGHT.lg);
    expect(token("container-caption-md")).toBe(TIER_CAPTION_HEIGHT.md);
    expect(token("container-caption-sm")).toBe(TIER_CAPTION_HEIGHT.sm);
  });

  it("pins the tile widths to the layout's constants", () => {
    expect(token("container-tile-lg")).toBe(TIER_PHOTO_WIDTH.lg);
    expect(token("container-tile-md")).toBe(TIER_PHOTO_WIDTH.md);
    expect(token("container-tile-sm")).toBe(TIER_PHOTO_WIDTH.sm);
  });
});
