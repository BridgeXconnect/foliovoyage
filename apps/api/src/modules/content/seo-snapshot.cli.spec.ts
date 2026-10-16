import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SeoSliceSnapshot } from "@folio/shared";
import { canonicalHash } from "./seo-slice-hash";
import { parseSeoSliceManifest } from "./seo-slice-manifest-schema";
import { exclusionOf, type SeoSliceTourInput } from "./seo-slice-membership";
import { exclusionLabelOf, SEO_SLICE_EXCLUSION_LABELS } from "./seo-snapshot";
import {
  bangkokDate,
  checkProdEndpoint,
  main,
  SEO_SLICE_CONTENT_DIR,
  SEO_SNAPSHOT_PROD_ENDPOINT,
  type SnapshotDbClient,
  type SnapshotDeps,
} from "./seo-snapshot.cli";

/** Spec 0006 prod snapshot, AC-S1, AC-S2, AC-S3, AC-S6, AC-S7, AC-S9. */

const MANIFEST_PATH = path.join(SEO_SLICE_CONTENT_DIR, "manifest.json");
const MANIFEST_TEXT = readFileSync(MANIFEST_PATH, "utf8");
const DIR = SEO_SLICE_CONTENT_DIR;
const fileOf = (slug: string) => path.join(DIR, `${slug}.snapshot.json`);
const PROD_HOST = "ep-lingering-wildflower-ax1mdc4m.c-4.us-east-2.aws.neon.tech";
const ENV = { DIRECT_URL: `postgres://reader:secret@${PROD_HOST}/neondb?sslmode=require` };
const NOW = new Date("2026-10-16T03:00:00Z");

let seq = 0;
function tour(over: Partial<SeoSliceTourInput> = {}): SeoSliceTourInput {
  const n = String(++seq).padStart(5, "0");
  return {
    id: `t${n}`,
    experienceId: `e${n}`,
    experienceStatus: "published",
    providerTourId: `P${n}`,
    title: "Damnoen Saduak Floating Market Tour",
    durationMin: 300,
    ratingAvg: 4.6,
    ratingCount: 40,
    affiliateUrl: `https://www.viator.com/tours/Bangkok/x/d343-${n}`,
    imageUrl: `https://img.example/${n}.jpg`,
    imageAlt: null,
    inclusions: [{ description: "Hotel pickup" }],
    tags: [],
    destinationRefs: ["343"],
    deletedAt: null,
    ...over,
  };
}
const many = (count: number, over: Partial<SeoSliceTourInput> = {}) => Array.from({ length: count }, () => tour(over));

/** Enough for floating-markets, temples, cooking-classes and day-trips (a floating market title is also a day trip); cruises stays thin. */
function baseTours(): SeoSliceTourInput[] {
  return [
    ...many(12, { title: "Damnoen Saduak Floating Market Tour" }),
    ...many(12, { title: "Grand Palace and Temples Walk", durationMin: 180 }),
    ...many(15, { title: "Thai Cooking Class in Bangkok", durationMin: 200 }),
    ...many(4, { title: "Ayutthaya Day Trip from Bangkok", durationMin: 600 }),
  ];
}

function fakeClient(tours: SeoSliceTourInput[], readOnly = "on") {
  const queries: string[] = [];
  const client: SnapshotDbClient & { queries: string[]; ended: boolean } = {
    queries,
    ended: false,
    connect: async () => undefined,
    query: async <R,>(sql: string) => {
      queries.push(sql.trim());
      if (sql.startsWith("SHOW")) return { rows: [{ default_transaction_read_only: readOnly }] as R[] };
      if (sql.startsWith("SET")) return { rows: [] as R[] };
      return { rows: tours as R[] };
    },
    end: async () => {
      client.ended = true;
    },
  };
  return client;
}

function memoryFiles(seed: Record<string, string> = {}) {
  const store = new Map<string, string>([[MANIFEST_PATH, MANIFEST_TEXT], ...Object.entries(seed)]);
  const writes: string[] = [];
  const removes: string[] = [];
  return {
    store,
    writes,
    removes,
    read: (f: string) => store.get(f) ?? null,
    write: (f: string, text: string) => {
      writes.push(f);
      store.set(f, text);
    },
    remove: (f: string) => {
      removes.push(f);
      store.delete(f);
    },
  };
}

async function run(opts: {
  tours: SeoSliceTourInput[];
  files?: ReturnType<typeof memoryFiles>;
  readOnly?: string;
  now?: Date;
  argv?: string[];
  runIndex?: () => string | null;
}) {
  const files = opts.files ?? memoryFiles();
  const client = fakeClient(opts.tours, opts.readOnly);
  const out: string[] = [];
  const err: string[] = [];
  let indexRuns = 0;
  const deps: SnapshotDeps = {
    createClient: () => client,
    files,
    now: () => opts.now ?? NOW,
    runIndex: () => {
      indexRuns++;
      return opts.runIndex ? opts.runIndex() : null;
    },
  };
  const code = await main(opts.argv ?? [], ENV, { out: (l) => out.push(l), err: (l) => err.push(l) }, deps);
  return { code, files, client, out: out.join("\n"), err: err.join("\n"), indexRuns };
}
const snapshotIn = (files: ReturnType<typeof memoryFiles>, slug: string) =>
  JSON.parse(files.store.get(fileOf(slug))!) as SeoSliceSnapshot;
const statusOf = (out: string, slug: string) => out.slice(out.indexOf("\nPages:")).match(new RegExp(`^  ${slug}: (.+)$`, "m"))?.[1];

describe("seo:snapshot read only guard (AC-S1)", () => {
  it("stops before any data query when the connection reports off, and writes nothing", async () => {
    const r = await run({ tours: baseTours(), readOnly: "off" });

    expect(r.code).toBe(1);
    expect(r.client.queries).toEqual(["SET default_transaction_read_only = on", "SHOW default_transaction_read_only"]);
    expect(r.client.ended).toBe(true);
    expect(r.files.writes).toEqual([]);
    expect(r.err).toMatch(/not on/);
    expect(r.out + r.err).not.toContain("secret");
  });

  it("closes the client and runs no data query when the SHOW itself fails", async () => {
    const client = fakeClient(baseTours());
    const query = client.query;
    client.query = async <R,>(sql: string) => {
      if (sql.startsWith("SHOW")) throw new Error("connection reset");
      return query<R>(sql);
    };
    const files = memoryFiles();

    await expect(main([], ENV, { out: () => undefined, err: () => undefined }, { createClient: () => client, files })).rejects.toThrow(
      "connection reset",
    );
    expect(client.ended).toBe(true);
    expect(client.queries).toEqual(["SET default_transaction_read_only = on"]);
    expect(files.writes).toEqual([]);
  });

  it("sets read only, checks it, then runs the one data query on the same client", async () => {
    const r = await run({ tours: baseTours() });

    expect(r.client.queries.slice(0, 2)).toEqual(["SET default_transaction_read_only = on", "SHOW default_transaction_read_only"]);
    expect(r.client.queries).toHaveLength(3);
    expect(r.client.queries[2]).toMatch(/^SELECT/);
    expect(r.out + r.err).not.toContain(ENV.DIRECT_URL);
  });
});

describe("seo:snapshot prod endpoint guard (AC-S1)", () => {
  const PASSWORD = "hunter2-not-real";
  const url = (host: string) => `postgresql://reader:${PASSWORD}@${host}/neondb?sslmode=require`;

  it("passes the unpooled prod host", () => {
    expect(checkProdEndpoint(url(PROD_HOST))).toEqual({ ok: true });
  });

  it("refuses the dev endpoint, naming what it found and what it expects", () => {
    expect(checkProdEndpoint(url("ep-lucky-truth-axsldwf8.c-4.us-east-2.aws.neon.tech"))).toEqual({
      ok: false,
      found: "ep-lucky-truth-axsldwf8",
      expected: SEO_SNAPSHOT_PROD_ENDPOINT,
    });
  });

  it("refuses the pooled prod host", () => {
    expect(checkProdEndpoint(url("ep-lingering-wildflower-ax1mdc4m-pooler.c-4.us-east-2.aws.neon.tech"))).toEqual({
      ok: false,
      found: "ep-lingering-wildflower-ax1mdc4m-pooler",
      expected: SEO_SNAPSHOT_PROD_ENDPOINT,
    });
  });

  it("refuses an unparseable URL", () => {
    expect(checkProdEndpoint("not a url")).toEqual({ ok: false, found: null, expected: SEO_SNAPSHOT_PROD_ENDPOINT });
  });

  it("stops before any connection on another endpoint, writes nothing, and never prints the password", async () => {
    const files = memoryFiles();
    let created = false;
    const out: string[] = [];
    const err: string[] = [];
    const code = await main(
      [],
      { DIRECT_URL: url("ep-lucky-truth-axsldwf8.c-4.us-east-2.aws.neon.tech") },
      { out: (l) => out.push(l), err: (l) => err.push(l) },
      {
        files,
        createClient: () => {
          created = true;
          return fakeClient([]);
        },
      },
    );

    expect(code).toBe(1);
    expect(created).toBe(false);
    expect(files.writes).toEqual([]);
    expect(files.removes).toEqual([]);
    const printed = [...out, ...err].join("\n");
    expect(printed).toContain("ep-lucky-truth-axsldwf8");
    expect(printed).toContain(SEO_SNAPSHOT_PROD_ENDPOINT);
    expect(printed).not.toContain(PASSWORD);
    expect(printed).not.toContain("postgresql://");
  });
});

describe("seo:snapshot manifest validation (AC-S2)", () => {
  it("refuses an invalid manifest before it connects, writing nothing", async () => {
    const manifest = JSON.parse(MANIFEST_TEXT);
    manifest.forbiddenNames = [];
    const files = memoryFiles({ [MANIFEST_PATH]: JSON.stringify(manifest) });
    let created = false;
    const code = await main([], ENV, { out: () => undefined, err: () => undefined }, {
      files,
      createClient: () => {
        created = true;
        return fakeClient([]);
      },
    });

    expect(code).toBe(1);
    expect(created).toBe(false);
    expect(files.writes).toEqual([]);
  });
});

describe("seo:snapshot files, statuses and reruns (AC-S6, AC-S7, AC-S9)", () => {
  it("writes the passing pages and the hub, then leaves every file untouched on a rerun", async () => {
    const tours = baseTours();
    const first = await run({ tours });

    expect(first.files.writes.map((f) => path.basename(f)).sort()).toEqual([
      "cooking-classes.snapshot.json",
      "day-trips.snapshot.json",
      "floating-markets.snapshot.json",
      "temples.snapshot.json",
      "things-to-do.snapshot.json",
    ]);
    const fm = snapshotIn(first.files, "floating-markets");
    expect(fm.computedOn).toBe("2026-10-16");
    expect(fm.factsHash).toBe(canonicalHash(fm.facts));
    expect(fm.picksHash).toBe(canonicalHash(fm.picks));
    expect(fm.eligible).toEqual({ count: 12, sections: [] });
    const hub = snapshotIn(first.files, "things-to-do");
    expect(hub.eligible).toBeNull();
    expect(hub.picks.map((p) => p.fromSlug)).toEqual([
      "floating-markets", "floating-markets", "temples", "temples", "day-trips", "day-trips", "cooking-classes",
      "cooking-classes",
    ]);
    // Keys sorted, two space indent, trailing newline.
    const text = first.files.store.get(fileOf("floating-markets"))!;
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.startsWith('{\n  "computedOn": "2026-10-16",\n  "eligible"')).toBe(true);
    expect(statusOf(first.out, "floating-markets")).toBe("facts changed, picks changed");
    expect(statusOf(first.out, "spa-and-massage")).toMatch(/^held/);
    expect(statusOf(first.out, "stats")).toMatch(/^skipped/);

    const before = new Map(first.files.store);
    const second = await run({ tours, files: first.files, now: new Date("2026-11-02T03:00:00Z") });

    expect(first.files.writes).toHaveLength(5);
    expect(new Map(second.files.store)).toEqual(before);
    for (const slug of ["floating-markets", "temples", "day-trips", "cooking-classes", "things-to-do"]) {
      expect(statusOf(second.out, slug)).toBe("unchanged");
    }
  });

  it("rewrites an eligible only change with the old computedOn and no next step", async () => {
    const tours = baseTours();
    const first = await run({ tours });
    const old = snapshotIn(first.files, "cooking-classes");

    // The cooking class with the highest providerTourId is not among the 12 picks; ungate it.
    const cooking = tours.filter((t) => t.title.startsWith("Thai Cooking"));
    cooking[cooking.length - 1].ratingCount = 2;
    const second = await run({ tours, files: first.files, now: new Date("2026-11-02T03:00:00Z") });
    const next = snapshotIn(second.files, "cooking-classes");

    expect(statusOf(second.out, "cooking-classes")).toBe("eligible changed");
    expect(next.eligible).toEqual({ count: 14, sections: [] });
    expect(next.computedOn).toBe(old.computedOn);
    expect(next.factsHash).toBe(old.factsHash);
    expect(next.picksHash).toBe(old.picksHash);
    expect(second.out).not.toMatch(/cooking-classes: (facts|picks) changed/);
    expect(second.code).toBe(1); // cruises is still thin
  });

  it("dates a hash change today in Asia/Bangkok and says what to run", async () => {
    const tours = baseTours();
    const first = await run({ tours });
    tours.push(tour({ title: "Damnoen Saduak Floating Market Tour", durationMin: 100 }));
    const second = await run({ tours, files: first.files, now: new Date("2026-11-02T18:30:00Z") });

    expect(snapshotIn(second.files, "floating-markets").computedOn).toBe("2026-11-03");
    expect(statusOf(second.out, "floating-markets")).toMatch(/facts changed/);
    expect(second.out).toContain("hub-copy:run --page floating-markets");
    expect(second.out).toMatch(/refresh, the regenerated copy and every approve in one PR/);
  });

  it("deletes a thin page's file, keeps a held page's file, exits non zero and names the hold step", async () => {
    const heldText = '{"kept": true}\n';
    const files = memoryFiles({
      [fileOf("cruises")]: '{"old": true}\n',
      [fileOf("spa-and-massage")]: heldText,
    });
    const tours = [...baseTours(), ...many(5, { title: "Chao Phraya Dinner Cruise", ratingCount: 2 })];
    const r = await run({ tours, files });

    expect(r.code).toBe(1);
    expect(files.removes).toContain(fileOf("cruises"));
    expect(files.store.has(fileOf("cruises"))).toBe(false);
    expect(files.store.get(fileOf("spa-and-massage"))).toBe(heldText);
    expect(statusOf(r.out, "cruises")).toMatch(/^thin/);
    expect(r.out).toMatch(/cruises is thin.*Set "held": true on it in manifest\.json.*hub-copy:run --page things-to-do/);
    // The hub is still written, from the pages that passed.
    expect(snapshotIn(files, "things-to-do").picks.map((p) => p.fromSlug)).not.toContain("cruises");
  });
});

describe("seo:snapshot thin hub (AC-S6)", () => {
  it("writes no hub file, deletes the old one and exits non zero when only 1 category page gives it cards", async () => {
    const files = memoryFiles({ [fileOf("things-to-do")]: '{"old": true}\n' });
    const r = await run({ tours: many(12, { title: "Grand Palace and Temples Walk", durationMin: 180 }), files });

    expect(r.code).toBe(1);
    expect(files.store.has(fileOf("temples"))).toBe(true);
    expect(files.removes).toContain(fileOf("things-to-do"));
    expect(files.store.has(fileOf("things-to-do"))).toBe(false);
    expect(statusOf(r.out, "things-to-do")).toBe("thin (1 category pages give it cards, the floor is 2)");
    expect(r.out).toMatch(/things-to-do is thin: fewer than 2 category pages give it cards/);
  });

  it("treats a hub with no contributing page as thin too", async () => {
    const r = await run({ tours: [] });

    expect(r.code).toBe(1);
    expect(r.files.writes).toEqual([]);
    expect(statusOf(r.out, "things-to-do")).toBe("thin (0 category pages give it cards, the floor is 2)");
  });

  it("writes the hub from exactly 2 contributing pages", async () => {
    const tours = [
      ...many(12, { title: "Grand Palace and Temples Walk", durationMin: 180 }),
      ...many(12, { title: "Thai Cooking Class in Bangkok", durationMin: 200 }),
    ];
    const r = await run({ tours });

    expect(statusOf(r.out, "things-to-do")).toBe("facts changed, picks changed");
    expect(new Set(snapshotIn(r.files, "things-to-do").picks.map((p) => p.fromSlug))).toEqual(
      new Set(["temples", "cooking-classes"]),
    );
  });
});

describe("seo:snapshot exclusion labels match the pool's exclusions (AC-S7, AC-M3)", () => {
  it("excludes the same tours under exclusionLabelOf as under exclusionOf", () => {
    const parsed = parseSeoSliceManifest(JSON.parse(MANIFEST_TEXT));
    if (!parsed.ok) throw new Error(parsed.problems.join("; "));
    const manifest = parsed.manifest;
    const title = "Damnoen Saduak Floating Market Tour";
    const cases: [SeoSliceTourInput, string | null][] = [
      [tour({ title: "Pattaya Floating Market Tour" }), "off city"],
      [tour({ title, tags: [11922] }), "multi day"],
      [tour({ title, durationMin: 3000 }), "multi day"],
      [tour({ title, tags: [12044] }), "transfers"],
      ...[367651, 367656, 367657].map((t): [SeoSliceTourInput, string] => [tour({ title, tags: [t] }), "flagged"]),
      [tour({ title: "Floating Market Tour, Free Cancellation" }), "leak term"],
      [tour({ title, affiliateUrl: "https://evilviator.com/x" }), "non Viator link"],
      // Hit by two: off city and multi day; counted under the first.
      [tour({ title: "Pattaya Floating Market Tour", tags: [11922] }), "off city"],
      [tour({ title }), null],
    ];

    expect(new Set(cases.map(([, label]) => label).filter(Boolean))).toEqual(new Set(SEO_SLICE_EXCLUSION_LABELS));
    for (const [t, label] of cases) {
      expect(exclusionLabelOf(t, manifest)).toBe(label);
      expect(exclusionOf(t, manifest) === null).toBe(label === null);
    }
  });
});

describe("seo:snapshot exclusion counts (AC-S7)", () => {
  it("counts each exclusion once, under the first that hits, and never writes them", async () => {
    const title = "Damnoen Saduak Floating Market Tour";
    const tours = [
      ...baseTours(),
      tour({ title, tags: [11922] }),
      tour({ title, tags: [12044] }),
      tour({ title, tags: [367651] }),
      tour({ title: "Floating Market Tour, Free Cancellation" }),
      tour({ title, affiliateUrl: "https://evilviator.com/x" }),
      tour({ title: "Pattaya Floating Market Tour", durationMin: 3000 }),
      // Not counted: no image, so not in the base the counts start from.
      tour({ title: "Pattaya Floating Market", imageUrl: null }),
    ];
    const r = await run({ tours });

    const line = r.out.split("\n").find((l) => l.startsWith("  floating-markets: off city"));
    expect(line).toBe(
      "  floating-markets: off city 1, multi day 1, transfers 1, flagged 1, leak term 1, non Viator link 1",
    );
    expect(r.out).toMatch(/whole pool \(hub and stats\): off city 1, multi day 1/);
    for (const f of r.files.writes) expect(r.files.store.get(f)).not.toMatch(/off city|multi day|non Viator/);
  });
});

describe("seo:snapshot index step (AC-S7)", () => {
  it("prints the command to run by hand and exits non zero when seo:index fails", async () => {
    const r = await run({ tours: baseTours(), runIndex: () => "exited with code 1" });

    expect(r.code).toBe(1);
    expect(r.err).toContain("pnpm --filter @folio/web seo:index");
  });

  it("does not run seo:index for another --out folder", async () => {
    const r = await run({ tours: baseTours(), argv: ["--out", "/tmp/elsewhere"] });

    expect(r.indexRuns).toBe(0);
    expect(r.files.writes.every((f) => f.startsWith("/tmp/elsewhere/"))).toBe(true);
  });
});

describe("bangkokDate", () => {
  it("gives the date in Asia/Bangkok, seven hours ahead of UTC", () => {
    expect(bangkokDate(new Date("2026-10-16T16:59:59Z"))).toBe("2026-10-16");
    expect(bangkokDate(new Date("2026-10-16T17:00:00Z"))).toBe("2026-10-17");
  });
});
