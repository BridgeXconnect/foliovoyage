import type { Env } from "../../config/env.validation";
import { TOUR_COPY_ALLOWED_MODELS, TOUR_COPY_MODEL_DEFAULT, type TourCopyModel } from "./tour-copy.constants";

/**
 * AC-19: the `tour-copy` CLI (build plan task 8) validates the gateway
 * variables and the model id before it touches the database or sends a
 * model call. A standalone, pure function — no DB, no network — so it is
 * independently testable and task 8 only has to call it, not implement it.
 *
 * `AI_GATEWAY_BASE_URL`'s URL shape/host is already enforced by
 * `env.validation.ts` (AC-9) once the CLI parses raw env through
 * `envSchema.pick(...)`, the same pattern `research.cli.ts` uses — this
 * check only needs presence of both gateway variables and the model
 * allowlist, matching AC-19's "missing or invalid ... or not on the
 * allowlist" (a bad URL already fails the pick-schema parse before this
 * runs).
 */
export type TourCopyStartupEnv = Pick<Env, "AI_GATEWAY_BASE_URL" | "AI_GATEWAY_TOKEN" | "TOUR_COPY_MODEL">;

export interface TourCopyStartupConfig {
  gatewayBaseUrl: string;
  gatewayToken: string;
  model: TourCopyModel;
}

export class TourCopyStartupError extends Error {
  constructor(problems: string[]) {
    super(`Tour-copy startup check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "TourCopyStartupError";
  }
}

/**
 * Resolve and validate the tour-copy config from env, or throw
 * {@link TourCopyStartupError} naming every problem found (not just the
 * first), so a CLI run that would fail for two reasons reports both at once.
 */
export function checkTourCopyStartup(env: TourCopyStartupEnv): TourCopyStartupConfig {
  const problems: string[] = [];

  if (!env.AI_GATEWAY_BASE_URL) {
    problems.push(
      "AI_GATEWAY_BASE_URL is not set. Set it to the Cloudflare AI Gateway URL " +
        "(https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/anthropic).",
    );
  }

  if (!env.AI_GATEWAY_TOKEN) {
    problems.push("AI_GATEWAY_TOKEN is not set. Set it to the Cloudflare AI Gateway auth token.");
  }

  const model = env.TOUR_COPY_MODEL ?? TOUR_COPY_MODEL_DEFAULT;
  if (!(TOUR_COPY_ALLOWED_MODELS as readonly string[]).includes(model)) {
    problems.push(
      `TOUR_COPY_MODEL "${model}" is not on the allowed list (${TOUR_COPY_ALLOWED_MODELS.join(", ")}).`,
    );
  }

  if (problems.length > 0) {
    throw new TourCopyStartupError(problems);
  }

  return {
    gatewayBaseUrl: env.AI_GATEWAY_BASE_URL as string,
    gatewayToken: env.AI_GATEWAY_TOKEN as string,
    model: model as TourCopyModel,
  };
}
