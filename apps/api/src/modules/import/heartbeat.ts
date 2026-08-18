import { Logger } from "@nestjs/common";

/**
 * Self-heartbeat for a long-running import run (BRI-173).
 *
 * Render's free-tier web service only resets its 15-minute idle-spindown timer
 * on **inbound** HTTP/WebSocket traffic — confirmed directly against Render's
 * docs, not assumed. Outbound calls to Viator, DB writes to Neon, and raw CPU
 * usage do not count. A multi-hour import run is therefore at risk of the
 * platform suspending the instance mid-crawl even though the process is
 * actively working the whole time.
 *
 * This pings the service's own **public** `/health` endpoint — not
 * `localhost`, since a loopback request never crosses Render's edge and so
 * can't reset anything the platform is watching — every `intervalMs`,
 * generating exactly the inbound traffic the idle timer looks for. `url` is
 * `RENDER_EXTERNAL_URL`, which Render auto-injects for web services; it's
 * absent in local dev / CI, in which case this no-ops entirely — there's no
 * spin-down risk to guard against off-platform.
 */
export interface ImportRunHeartbeatOptions {
  /**
   * Base public URL to ping (e.g. `https://atlas-api.onrender.com`), or
   * undefined when not running on Render (local dev, tests, CI).
   */
  readonly url: string | undefined;
  /** Ping interval in ms. Defaults to 10 minutes — comfortably inside Render's 15-minute idle window. */
  readonly intervalMs?: number;
}

const DEFAULT_INTERVAL_MS = 10 * 60_000;
const PING_TIMEOUT_MS = 10_000;

export class ImportRunHeartbeat {
  private readonly logger = new Logger(ImportRunHeartbeat.name);
  private readonly url: string | undefined;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(options: ImportRunHeartbeatOptions) {
    this.url = options.url;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /** Start pinging on an interval. No-ops when no `url` was supplied. */
  start(): void {
    if (!this.url) return;
    this.timer = setInterval(() => void this.ping(), this.intervalMs);
    // Never keep the process alive on the heartbeat's account alone — the
    // HTTP server (or, in the CLI, `execute()`'s own await) already owns
    // process lifetime.
    this.timer.unref?.();
  }

  /**
   * Stop pinging. Safe to call even if {@link start} was never called or
   * no-opped. Callers MUST run this in a `finally` around the run (see
   * {@link import("./import-run.service").ImportRunService.execute}) so a
   * heartbeat never outlives the run it belongs to — the same cleanup shape
   * `reapStuckRuns` relies on for its own best-effort guarantees.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async ping(): Promise<void> {
    try {
      const response = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`Heartbeat ping returned HTTP ${response.status}.`);
      }
    } catch (error) {
      // Best-effort: a failed ping must never interrupt the import run
      // itself, only be logged for visibility.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Heartbeat ping failed: ${message}`);
    }
  }
}
