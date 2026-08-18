import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { describe, expect, it, jest } from "@jest/globals";

import type { Env } from "../../config/env.validation";
import { ImportTriggerController } from "./import-trigger.controller";
import type { ImportRunService } from "./import-run.service";

const SECRET = "test-trigger-secret";

function fakeConfig(): ConfigService<Env, true> {
  return {
    get: (key: string) =>
      key === "IMPORT_TRIGGER_SECRET" ? SECRET : undefined,
  } as unknown as ConfigService<Env, true>;
}

function setup(hasRunning = false): {
  controller: ImportTriggerController;
  execute: jest.Mock;
  hasRunningRun: jest.Mock;
} {
  const execute = jest.fn(async () => undefined);
  const hasRunningRun = jest.fn(async () => hasRunning);
  const runService = {
    execute,
    hasRunningRun,
  } as unknown as ImportRunService;
  return {
    controller: new ImportTriggerController(runService, fakeConfig()),
    execute,
    hasRunningRun,
  };
}

/**
 * Unit tests for {@link ImportTriggerController} (BRI-173).
 *
 * Mirrors AffiliateController's test shape for the shared-secret pattern, plus
 * the two behaviours specific to this endpoint: it must not block on the
 * (possibly hours-long) run, and it must refuse to start a second run while
 * one is already in flight.
 */
describe("ImportTriggerController POST /v1/import/trigger", () => {
  it("rejects a missing trigger secret without touching the run service", async () => {
    const { controller, execute, hasRunningRun } = setup();
    await expect(controller.trigger(undefined)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(hasRunningRun).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects a wrong trigger secret", async () => {
    const { controller, execute } = setup();
    await expect(controller.trigger("nope")).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects with 409 when a run is already in progress", async () => {
    const { controller, execute } = setup(true);
    await expect(controller.trigger(SECRET)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("starts a run labelled scheduled-external and returns immediately (202-style)", async () => {
    const { controller, execute } = setup(false);

    const result = await controller.trigger(SECRET);

    expect(result).toEqual({ triggered: true });
    expect(execute).toHaveBeenCalledWith("scheduled-external");
  });

  it("does not await execute() — resolves even though the run never settles", async () => {
    const hasRunningRun = jest.fn(async () => false);
    // A promise that deliberately never resolves. If the controller awaited
    // it, `controller.trigger()` would hang and this test would time out.
    const execute = jest.fn(() => new Promise<void>(() => {}));
    const runService = { execute, hasRunningRun } as unknown as ImportRunService;
    const controller = new ImportTriggerController(runService, fakeConfig());

    await expect(controller.trigger(SECRET)).resolves.toEqual({
      triggered: true,
    });
  });
});
