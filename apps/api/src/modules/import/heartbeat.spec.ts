import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { ImportRunHeartbeat } from "./heartbeat";

/**
 * Unit tests for {@link ImportRunHeartbeat} (BRI-173).
 *
 * Covers the behaviour the self-heartbeat is load-bearing for: it pings the
 * given public URL's `/health` on an interval while started, never pings when
 * no URL was supplied (off-Render environments), and stops cleanly so it
 * never outlives the run it's scoped to.
 */
describe("ImportRunHeartbeat", () => {
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest
      .fn<typeof fetch>()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    (globalThis as { fetch: typeof fetch }).fetch = fetchMock;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("does nothing when no URL is supplied (local dev / off-Render)", async () => {
    const heartbeat = new ImportRunHeartbeat({ url: undefined });
    heartbeat.start();
    await jest.advanceTimersByTimeAsync(60 * 60_000);
    heartbeat.stop();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pings its own /health endpoint on the configured interval", async () => {
    const heartbeat = new ImportRunHeartbeat({
      url: "https://atlas-api.onrender.com",
      intervalMs: 1000,
    });
    heartbeat.start();

    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://atlas-api.onrender.com/health",
      expect.objectContaining({ signal: expect.anything() }),
    );

    await jest.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    heartbeat.stop();
  });

  it("stops pinging once stopped", async () => {
    const heartbeat = new ImportRunHeartbeat({
      url: "https://atlas-api.onrender.com",
      intervalMs: 1000,
    });
    heartbeat.start();

    await jest.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    heartbeat.stop();
    await jest.advanceTimersByTimeAsync(5000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("is safe to stop when never started (no URL)", () => {
    const heartbeat = new ImportRunHeartbeat({ url: undefined });
    expect(() => heartbeat.stop()).not.toThrow();
  });

  it("logs but does not throw when a ping fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const heartbeat = new ImportRunHeartbeat({
      url: "https://atlas-api.onrender.com",
      intervalMs: 1000,
    });
    heartbeat.start();

    await expect(
      jest.advanceTimersByTimeAsync(1000),
    ).resolves.toBeUndefined();

    heartbeat.stop();
  });

  it("logs but does not throw on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    const heartbeat = new ImportRunHeartbeat({
      url: "https://atlas-api.onrender.com",
      intervalMs: 1000,
    });
    heartbeat.start();

    await expect(
      jest.advanceTimersByTimeAsync(1000),
    ).resolves.toBeUndefined();

    heartbeat.stop();
  });
});
