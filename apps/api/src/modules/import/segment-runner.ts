import { Logger } from "@nestjs/common";
import { spawn } from "node:child_process";
import { join } from "node:path";

/** Result of running one segment-worker child to completion. */
export interface SegmentRunResult {
  /** The child's exit code, or `null` if it was killed by a signal (e.g. OOM). */
  readonly exitCode: number | null;
}

/**
 * Seam for spawning a segment-worker child (BRI-176), injected the same way
 * {@link import("./clients/viator.client").Sleep} is — so
 * {@link import("./import-run.service").ImportRunService}'s own tests can
 * fake it instead of actually spawning processes.
 */
export interface SegmentRunner {
  /**
   * Run one segment of `runId` to completion in a fresh child process and
   * resolve once it exits. Never rejects on a non-zero/`null` exit — that's
   * reported via `exitCode`, for the caller to decide how to finalize the
   * run — only on a failure to spawn the process at all.
   */
  runSegment(runId: string, modifiedSince?: string): Promise<SegmentRunResult>;
}

/**
 * Real {@link SegmentRunner}: spawns `segment-worker.cli.js` as a genuine OS
 * process (BRI-176's whole point — see `import.pipeline.ts`'s class
 * docstring for why an in-process restart alone left a real residual memory
 * accumulation that a full process exit doesn't). Inherits the parent's
 * environment unchanged, so the child's own `ConfigModule` sees the same
 * validated env (Viator credentials, R2, `DELETE_GUARD_THRESHOLD_PCT`,
 * `IMPORT_CRAWL_RESTART_PAGES`, …) without any of it needing to be threaded
 * through as CLI args — only `--runId` (which run/row this child works on)
 * and, on a delta run, `--modifiedSince` need to be.
 */
export class NodeSegmentRunner implements SegmentRunner {
  private readonly logger = new Logger(NodeSegmentRunner.name);

  async runSegment(
    runId: string,
    modifiedSince?: string,
  ): Promise<SegmentRunResult> {
    const workerPath = join(__dirname, "segment-worker.cli.js");
    const args = ["--runId", runId];
    if (modifiedSince) args.push("--modifiedSince", modifiedSince);

    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath, ...args], {
        env: process.env,
        // Inherit stdio so the child's Nest logger output lands in the same
        // log stream as the parent (Render aggregates one stream per
        // instance) — there's nothing to capture separately.
        stdio: "inherit",
      });
      child.on("error", (error) => {
        this.logger.error(
          `Failed to spawn segment-worker for run ${runId}: ${error.message}`,
        );
        reject(error);
      });
      child.on("close", (code) => resolve({ exitCode: code }));
    });
  }
}
