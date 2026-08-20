import { Controller, Get } from "@nestjs/common";
import { spawn } from "node:child_process";

/**
 * TEMPORARY DIAGNOSTIC (BRI-176) — not for merge to a long-lived branch.
 *
 * Answers one question before building the process-level-restart fix for
 * BRI-176's ingest OOM: does Render's free-tier web service allow spawning a
 * child process at all? Render's paid Shell feature isn't available on this
 * plan, so this is the only way to get a real answer without building the
 * whole feature around an assumption. Deploy, curl once, then delete this
 * file and its registration in app.module.ts.
 */
@Controller({ path: "debug", version: "1" })
export class SpawnTestController {
  @Get("spawn-test")
  async test(): Promise<{
    spawned: boolean;
    stdout: string;
    stderr: string;
    error: string | null;
  }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      try {
        const child = spawn("node", ["--version"]);
        child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
        child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
        child.on("error", (error) => {
          resolve({ spawned: false, stdout, stderr, error: error.message });
        });
        child.on("close", (code) => {
          resolve({
            spawned: code === 0,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: code === 0 ? null : `child exited with code ${code}`,
          });
        });
      } catch (error) {
        resolve({
          spawned: false,
          stdout,
          stderr,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  }
}
