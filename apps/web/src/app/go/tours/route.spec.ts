import { describe, expect, it, jest } from "@jest/globals";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getAllDestinations } from "@/data/destinations-helpers";

const oldRoute = jest.fn();
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/app/go/[slug]/[id]/route", () => ({ GET: (...args: unknown[]) => oldRoute(...args) }));

describe("routing (AC-12)", () => {
  it("/go/tours/x reaches the new handler, not /go/[slug]/[id]", async () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    const { GET } = await import("@/app/go/tours/[experienceId]/route");
    const res = await GET(new Request("http://localhost/go/tours/x"), { params: Promise.resolve({ experienceId: "x" }) });
    // "x" is not a cuid: the new handler answers 404 without any fetch.
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown tour.");
    expect(oldRoute).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps a static `tours` segment beside the dynamic [slug] segment, so Next prefers it", () => {
    const go = join(__dirname);
    expect(existsSync(join(go, "[experienceId]", "route.ts"))).toBe(true);
    expect(existsSync(join(go, "..", "[slug]", "[id]", "route.ts"))).toBe(true);
  });

  it("no destination slug equals `tours`", () => {
    expect(getAllDestinations().map((d) => d.slug)).not.toContain("tours");
  });
});
