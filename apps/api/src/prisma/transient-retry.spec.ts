import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { Prisma } from "@prisma/client";

import {
  backoffDelayMs,
  getDbRetryProfile,
  isTransientDbError,
  RETRY_PROFILES,
  setDbRetryProfile,
  withTransientRetry,
} from "./transient-retry";

/**
 * Unit tests for the transient-DB retry primitives (BRI-210). Sleep, jitter
 * and logger are injected, so nothing here waits on a real timer or touches a
 * database.
 */

const knownError = (code: string): Prisma.PrismaClientKnownRequestError =>
  new Prisma.PrismaClientKnownRequestError(`fake ${code}`, {
    code,
    clientVersion: "test",
  });

const initError = (errorCode: string): Prisma.PrismaClientInitializationError =>
  new Prisma.PrismaClientInitializationError(`fake ${errorCode}`, "test", errorCode);

const silentLogger = () => ({ warn: jest.fn<(message: string) => void>() });

describe("isTransientDbError", () => {
  it.each(["P1001", "P1002", "P1008", "P1017", "P2024"])(
    "treats %s on a PrismaClientKnownRequestError (`code`) as transient",
    (code) => {
      expect(isTransientDbError(knownError(code))).toBe(true);
    },
  );

  it("reads `errorCode` on a PrismaClientInitializationError (P1001 at connect time)", () => {
    expect(isTransientDbError(initError("P1001"))).toBe(true);
  });

  it("is false for an initialization error with a non-transient errorCode", () => {
    expect(isTransientDbError(initError("P1000"))).toBe(false); // auth failed
  });

  it.each(["P2002", "P2025", "P2028"])("is false for %s", (code) => {
    // P2028 deliberately excluded (BRI-210 Step 0 decision 1): its real
    // occurrence was a 2 s maxWait, fixed by config, not by retrying.
    expect(isTransientDbError(knownError(code))).toBe(false);
  });

  it("is false for non-Prisma values", () => {
    expect(isTransientDbError(new Error("Server has closed the connection."))).toBe(false);
    expect(isTransientDbError(undefined)).toBe(false);
    expect(isTransientDbError("P1001")).toBe(false);
  });
});

describe("withTransientRetry", () => {
  const noSleep = () => jest.fn<(ms: number) => Promise<void>>(async () => {});

  it("retries a transient failure and returns the eventual success", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(knownError("P1017"))
      .mockRejectedValueOnce(initError("P1001"))
      .mockResolvedValue("ok");
    const sleep = noSleep();
    const logger = silentLogger();

    await expect(
      withTransientRetry(fn, { label: "test", attempts: 5, sleep, logger }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    const firstLog = logger.warn.mock.calls[0][0];
    expect(firstLog).toContain("test");
    expect(firstLog).toContain("P1017");
    expect(firstLog).toContain("attempt 1/5");
  });

  it("rethrows the original error once attempts are exhausted", async () => {
    const errors = [knownError("P1017"), knownError("P1017"), knownError("P1001")];
    let call = 0;
    const fn = jest.fn(async () => {
      throw errors[call++];
    });

    await expect(
      withTransientRetry(fn, { label: "test", attempts: 3, sleep: noSleep(), logger: silentLogger() }),
    ).rejects.toBe(errors[2]);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-transient error immediately, calling fn once", async () => {
    const boom = knownError("P2002");
    const fn = jest.fn(async () => {
      throw boom;
    });
    const sleep = noSleep();

    await expect(
      withTransientRetry(fn, { label: "test", attempts: 5, sleep, logger: silentLogger() }),
    ).rejects.toBe(boom);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("keeps every backoff delay within [0, cap]", async () => {
    const fn = jest.fn(async () => {
      throw knownError("P1017");
    });
    const sleep = noSleep();

    await expect(
      withTransientRetry(fn, {
        label: "test",
        attempts: 8,
        baseDelayMs: 500,
        maxDelayMs: 2_000,
        random: () => 0.999999,
        sleep,
        logger: silentLogger(),
      }),
    ).rejects.toBeDefined();
    const delays = sleep.mock.calls.map(([ms]) => ms);
    expect(delays).toHaveLength(7);
    for (const ms of delays) {
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThanOrEqual(2_000);
    }
    // Exponential until the cap: 500, 1000, then capped at 2000.
    expect(delays.slice(0, 3)).toEqual([499, 999, 1_999]);
  });
});

describe("backoffDelayMs (full jitter)", () => {
  it("is 0 when the jitter draw is 0", () => {
    expect(backoffDelayMs(3, 500, 15_000, () => 0)).toBe(0);
  });

  it("never exceeds the cap however many retries in", () => {
    expect(backoffDelayMs(30, 500, 15_000, () => 0.999999)).toBeLessThanOrEqual(15_000);
  });
});

describe("process retry profile", () => {
  afterEach(() => setDbRetryProfile("web"));

  it("defaults to the fail-fast web profile", () => {
    expect(getDbRetryProfile()).toEqual({ name: "web", ...RETRY_PROFILES.web });
    expect(RETRY_PROFILES.web).toEqual({ attempts: 2, baseDelayMs: 100, maxDelayMs: 1_000 });
  });

  it("switches to the import profile when an entrypoint selects it", () => {
    setDbRetryProfile("import");
    expect(getDbRetryProfile()).toEqual({
      name: "import",
      attempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 15_000,
    });
  });

  it("is what withTransientRetry uses when no attempts are passed", async () => {
    setDbRetryProfile("import");
    const fn = jest.fn(async () => {
      throw knownError("P1017");
    });
    await expect(
      withTransientRetry(fn, { label: "test", sleep: async () => {}, logger: silentLogger() }),
    ).rejects.toBeDefined();
    expect(fn).toHaveBeenCalledTimes(5);
  });
});
