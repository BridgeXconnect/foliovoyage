/**
 * Test only: the tricky path matrix for the slice gate (spec 0006 AC-G1,
 * AC-G2), shared by the fixture live set spec and the empty live set spec.
 *
 * `raw` is what goes on the wire. `resolved` is the pathname the runtime sees
 * once the URL parser has resolved dot segments (`%2e%2e` counts as `..`);
 * `%2F` is never decoded, and case and double slashes are kept. `passes` is
 * the expected gate decision with the live set `things-to-do` and
 * `floating-markets`. With an empty live set every case is gated.
 */

export interface GateCase {
  raw: string;
  resolved: string;
  passes: boolean;
  why: string;
}

export const FIXTURE_LIVE = ["things-to-do", "floating-markets"];

export const GATE_CASES: GateCase[] = [
  // Case: matching is exact, so any change of case is a different path.
  { raw: "/destinations/bangkok/THINGS-TO-DO", resolved: "/destinations/bangkok/THINGS-TO-DO", passes: false, why: "uppercase slug" },
  { raw: "/destinations/bangkok/Things-To-Do", resolved: "/destinations/bangkok/Things-To-Do", passes: false, why: "mixed case slug" },
  { raw: "/DESTINATIONS/BANGKOK/THINGS-TO-DO", resolved: "/DESTINATIONS/BANGKOK/THINGS-TO-DO", passes: false, why: "uppercase whole path" },
  { raw: "/Go/Tours/abc123", resolved: "/Go/Tours/abc123", passes: false, why: "uppercase click out prefix" },

  // Double slashes are kept by the URL parser.
  { raw: "/destinations/bangkok//things-to-do", resolved: "/destinations/bangkok//things-to-do", passes: false, why: "double slash before the slug" },
  { raw: "/destinations//bangkok/things-to-do", resolved: "/destinations//bangkok/things-to-do", passes: false, why: "double slash mid path" },
  { raw: "//destinations/bangkok/things-to-do", resolved: "//destinations/bangkok/things-to-do", passes: false, why: "leading double slash" },
  { raw: "/go//tours/abc123", resolved: "/go//tours/abc123", passes: false, why: "double slash inside the click out prefix" },

  // %2F stays encoded, so it never matches a live path.
  { raw: "/destinations/bangkok%2Fthings-to-do", resolved: "/destinations/bangkok%2Fthings-to-do", passes: false, why: "%2F in place of the last slash" },
  { raw: "/destinations%2Fbangkok%2Fthings-to-do", resolved: "/destinations%2Fbangkok%2Fthings-to-do", passes: false, why: "%2F in place of every slash" },
  { raw: "/destinations/bangkok/things-to-do%2F", resolved: "/destinations/bangkok/things-to-do%2F", passes: false, why: "encoded trailing slash" },
  { raw: "/destinations/bangkok/things-to-do%2Fextra", resolved: "/destinations/bangkok/things-to-do%2Fextra", passes: false, why: "encoded extra segment" },
  { raw: "/destinations/bangkok/things-to-do/..%2Fmuay-thai", resolved: "/destinations/bangkok/things-to-do/..%2Fmuay-thai", passes: false, why: "dot dot with an encoded slash is not a dot segment" },
  { raw: "/destinations/bangkok/%74hings-to-do", resolved: "/destinations/bangkok/%74hings-to-do", passes: false, why: "percent encoded letter in a live slug" },

  // %2e%2e is a real dot segment: it resolves before the gate sees the path.
  { raw: "/destinations/bangkok/things-to-do/%2e%2e/muay-thai", resolved: "/destinations/bangkok/muay-thai", passes: false, why: "%2e%2e from a live page into a held page" },
  { raw: "/destinations/bangkok/things-to-do/%2E%2E", resolved: "/destinations/bangkok/", passes: false, why: "%2E%2E up to the hub with a trailing slash" },
  { raw: "/go/tours/%2e%2e/other", resolved: "/go/other", passes: false, why: "%2e%2e out of the click out prefix" },
  { raw: "/ingest/%2e%2e/admin", resolved: "/admin", passes: false, why: "%2e%2e out of the analytics prefix" },
  { raw: "/destinations/bangkok/things-to-do/.", resolved: "/destinations/bangkok/things-to-do/", passes: false, why: "single dot segment leaves a trailing slash" },
  // Resolves onto a live page, so the runtime serves that live page: passing is correct, nothing else is exposed.
  { raw: "/destinations/bangkok/x/%2e%2e/things-to-do", resolved: "/destinations/bangkok/things-to-do", passes: true, why: "%2e%2e that lands on a live page" },
  // Stays inside the click out prefix (the encoded slash is not decoded), so the
  // tour route handler gets it as an id and answers 404 (tour-go.ts).
  { raw: "/go/tours/%2e%2e%2Fother", resolved: "/go/tours/%2e%2e%2Fother", passes: true, why: "encoded traversal that stays inside /go/tours/" },

  // Extra segments and prefix edges.
  { raw: "/destinations/bangkok/things-to-do/extra", resolved: "/destinations/bangkok/things-to-do/extra", passes: false, why: "extra segment" },
  { raw: "/go/tours", resolved: "/go/tours", passes: false, why: "click out prefix without its slash" },
  { raw: "/go/tours/", resolved: "/go/tours/", passes: true, why: "click out prefix itself" },
  { raw: "/go/tours/abc123?utm_source=x&b=2", resolved: "/go/tours/abc123", passes: true, why: "click out with a query string" },
  { raw: "/ingestx", resolved: "/ingestx", passes: false, why: "analytics prefix lookalike" },
  { raw: "/ingest", resolved: "/ingest", passes: false, why: "analytics prefix without its slash" },
  { raw: "/ingest/", resolved: "/ingest/", passes: true, why: "analytics prefix itself" },
  { raw: "/destinations/bangkok/things-to-do?x=1", resolved: "/destinations/bangkok/things-to-do", passes: true, why: "live page with a query string" },
];
