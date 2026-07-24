import { describe, expect, it, jest } from "@jest/globals";

import {
  AllowlistFetch,
  HostNotAllowedError,
  type FetchLike,
} from "./allowlist-fetch";

describe("AllowlistFetch", () => {
  const okResponse = () => new Response("{}", { status: 200 });

  it("allows a request to an allowlisted host", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    const res = await client.fetch("https://api.viator.com/partner/products");

    expect(res.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a request to a non-allowlisted host without calling fetch", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    await expect(
      client.fetch("https://evil.example.com/steal"),
    ).rejects.toBeInstanceOf(HostNotAllowedError);
    // The socket must never be opened for a blocked host.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks internal metadata-style hosts (SSRF)", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    await expect(
      client.fetch("https://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(HostNotAllowedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-https URL even on an allowlisted host", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    await expect(
      client.fetch("http://api.viator.com/partner/products"),
    ).rejects.toBeInstanceOf(HostNotAllowedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("matches hosts case-insensitively", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    await expect(
      client.fetch("https://API.Viator.COM/partner/products"),
    ).resolves.toBeDefined();
  });

  it("forces manual redirect handling so a 3xx can't escape the allowlist", async () => {
    const fetchImpl = jest.fn<FetchLike>().mockResolvedValue(okResponse());
    const client = new AllowlistFetch(["api.viator.com"], fetchImpl);

    await client.fetch("https://api.viator.com/partner/products", {
      redirect: "follow",
    });

    const init = fetchImpl.mock.calls[0]?.[1];
    expect(init?.redirect).toBe("manual");
  });

  it("requires at least one allowed host", () => {
    expect(() => new AllowlistFetch([])).toThrow(
      /at least one allowed host/,
    );
  });
});
