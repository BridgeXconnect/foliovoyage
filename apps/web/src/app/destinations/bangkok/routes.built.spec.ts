import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import { LIVE_SLUGS } from "@/content/seo/bangkok/live.generated";
import { SEO_SLICE_PREVIEW_TERMS } from "@/lib/seo-slice/preview";

/**
 * Spec 0006 page template AC-T1 and AC-T2 on the built app: with the
 * `destinations/bangkok/[page]` folder in place, the three existing Bangkok
 * routes still answer as before, each live slug is a 200 and any other slug a
 * 404 (AC-T15: no served file holds preview text). Starts `next start` on the build in `.next`, so it runs only after a
 * build and with `SEO_SLICE_ROUTE_TEST=1` (the CI step sets both). Otherwise it
 * is skipped and says so in its name.
 */

const APP_DIR = path.resolve(__dirname, "../../../..");
const NEXT_DIR = path.join(APP_DIR, ".next");
const enabled = process.env.SEO_SLICE_ROUTE_TEST === "1" && existsSync(path.join(NEXT_DIR, "BUILD_ID"));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const address = srv.address();
      srv.close(() => (typeof address === "object" && address ? resolve(address.port) : reject(new Error("no port"))));
    });
  });
}

let server: ChildProcess | undefined;
let base = "";

const get = (p: string) => fetch(`${base}${p}`, { redirect: "manual" });

(enabled ? describe : describe.skip)(
  enabled ? "built Bangkok routes (spec 0006 AC-T1, AC-T2, AC-T15)" : "built Bangkok routes (SKIPPED: needs a build and SEO_SLICE_ROUTE_TEST=1)",
  () => {
    beforeAll(async () => {
      const port = await freePort();
      base = `http://127.0.0.1:${port}`;
      // The gate stays off: it needs SITE_GATE_PASSWORD, which the server never gets here.
      const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
      delete env.SITE_GATE_PASSWORD;
      server = spawn(path.join(APP_DIR, "node_modules/.bin/next"), ["start", "-p", String(port), "-H", "127.0.0.1"], {
        cwd: APP_DIR,
        env,
        stdio: "ignore",
      });
      for (let i = 0; i < 100; i++) {
        try {
          await fetch(base);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      throw new Error("next start did not come up");
    }, 30_000);

    afterAll(async () => {
      if (!server || server.exitCode !== null) return;
      const exited = new Promise((r) => server!.once("exit", r));
      server.kill();
      await exited;
    });

    it("still serves /destinations/bangkok from [slug]", async () => {
      const res = await get("/destinations/bangkok");
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Bangkok");
    });

    it("still serves a Bangkok experience page from [slug]/experiences/[experienceId]", async () => {
      const dir = path.join(NEXT_DIR, "server/app/destinations/bangkok/experiences");
      const id = readdirSync(dir).find((f) => f.endsWith(".html"))!.slice(0, -".html".length);
      expect((await get(`/destinations/bangkok/experiences/${id}`)).status).toBe(200);
    });

    it("still 308 redirects /destinations/thailand/bangkok", async () => {
      const res = await get("/destinations/thailand/bangkok");
      expect(res.status).toBe(308);
      expect(new URL(res.headers.get("location")!, base).pathname).toBe("/destinations/bangkok");
    });

    it("serves every live slug and 404s anything else", async () => {
      for (const slug of LIVE_SLUGS) expect((await get(`/destinations/bangkok/${slug}`)).status).toBe(200);
      expect((await get("/destinations/bangkok/not-a-slice-page")).status).toBe(404);
    });

    // AC-T15: the build CI makes has SEO_SLICE_PREVIEW=1 set, and must still hold no
    // preview text in anything it serves. The server bundle [page]/page.js holds
    // these texts as string constants by design, so only served output is read.
    it("holds no preview text in any built page or browser file", () => {
      const terms = [...SEO_SLICE_PREVIEW_TERMS, "Not checked yet"];
      const files = (dir: string, keep: (f: string) => boolean) =>
        (readdirSync(dir, { recursive: true }) as string[])
          .filter(keep)
          .map((f) => path.join(dir, f))
          .filter((f) => statSync(f).isFile());
      const served = [
        ...files(path.join(NEXT_DIR, "server/app"), (f) => /\.(html|rsc)$/.test(f)),
        ...files(path.join(NEXT_DIR, "static"), (f) => /\.\w+$/.test(f)),
      ];
      expect(served.length).toBeGreaterThan(0);
      const hits = served.flatMap((file) => {
        const text = readFileSync(file, "utf8");
        return terms.filter((t) => text.includes(t)).map((t) => `${path.relative(NEXT_DIR, file)}: ${t}`);
      });
      expect(hits).toEqual([]);
    });
  },
);
