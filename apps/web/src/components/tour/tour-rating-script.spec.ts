/** @jest-environment jsdom */
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

const SOURCE = readFileSync(join(__dirname, "../../../public/protected/tour-rating.js"), "utf8");
const ID = "cmtodmrst0hdlqu18h454evr4";

type FetchLike = (url: string, init?: unknown) => Promise<unknown>;
// jsdom has no Response, so answer with the two members the script uses.
const reply = (body: string, status = 200) => async () => ({ status, json: async () => JSON.parse(body) });

/** Run the script the way a browser does: once per injected copy. */
function run(fetchImpl: FetchLike) {
  new Function("fetch", "document", SOURCE)(fetchImpl, document);
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const placeholder = () => document.querySelector("[data-tour-rating]") as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `<div data-tour-rating="${ID}"></div>`;
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("tour-rating.js", () => {
  it("is small and has no dependencies", () => {
    expect(SOURCE.length).toBeLessThan(1500);
    expect(SOURCE).not.toMatch(/\b(import|require)\b/);
  });

  it("fills the placeholder on a valid response", async () => {
    const fetchImpl = jest.fn<FetchLike>(reply(JSON.stringify({ ratingAvg: 4.7, ratingCount: 6756 })));
    run(fetchImpl);
    await settle();
    expect(placeholder().textContent).toBe("★ 4.7 (6,756)");
    expect(fetchImpl).toHaveBeenCalledWith(`/protected/tours/${ID}/rating.json`, expect.anything());
  });

  it("rounds the average to one decimal", async () => {
    run(reply(JSON.stringify({ ratingAvg: 4.25, ratingCount: 12 })));
    await settle();
    expect(placeholder().textContent).toBe("★ 4.3 (12)");
  });

  it.each([
    ["a 404", reply("{}", 404)],
    ["a 502", reply("{}", 502)],
    ["a 204", reply("", 204)],
    ["a non JSON body (the coming soon page)", reply("<html>coming soon</html>")],
    ["a network error", async () => Promise.reject(new Error("offline"))],
    ["null values", reply(JSON.stringify({ ratingAvg: null, ratingCount: null }))],
    ["a zero count", reply(JSON.stringify({ ratingAvg: 4.7, ratingCount: 0 }))],
    ["a null average with a count", reply(JSON.stringify({ ratingAvg: null, ratingCount: 5 }))],
    ["a string average", reply(JSON.stringify({ ratingAvg: "4.7", ratingCount: 5 }))],
  ])("leaves the placeholder empty on %s, and never throws", async (_name, fetchImpl) => {
    expect(() => run(fetchImpl as FetchLike)).not.toThrow();
    await settle();
    expect(placeholder().textContent).toBe("");
  });

  it("never throws when fetch itself throws synchronously or the page has no placeholder", () => {
    expect(() =>
      run(() => {
        throw new Error("boom");
      }),
    ).not.toThrow();
    document.body.innerHTML = "";
    expect(() => run(reply("{}"))).not.toThrow();
  });

  it("does not fetch or fill twice when the script runs again (two mounts)", async () => {
    const fetchImpl = jest.fn<FetchLike>(reply(JSON.stringify({ ratingAvg: 4.7, ratingCount: 6756 })));
    run(fetchImpl);
    run(fetchImpl);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(placeholder().textContent).toBe("★ 4.7 (6,756)");
  });

  it("fills a new placeholder on a second run after a client side navigation", async () => {
    const fetchImpl = jest.fn<FetchLike>(reply(JSON.stringify({ ratingAvg: 4.7, ratingCount: 6756 })));
    run(fetchImpl);
    await settle();
    document.body.innerHTML = `<div data-tour-rating="cother0000000000000000000"></div>`;
    run(fetchImpl);
    await settle();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(placeholder().textContent).toBe("★ 4.7 (6,756)");
  });
});
