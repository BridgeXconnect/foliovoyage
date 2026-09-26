import type { Env } from "../../config/env.validation";
import { TOUR_COPY_JUDGE_ALLOWED_MODELS, TOUR_COPY_JUDGE_MODEL_DEFAULT } from "./tour-copy-eval.constants";
import { TOUR_COPY_ALLOWED_MODELS, TOUR_COPY_MODEL_DEFAULT } from "./tour-copy.constants";

/**
 * Spec 0003 AC-5 and AC-19: `tour-copy-eval:run` and `tour-copy-golden:run`
 * validate the gateway variables and both model ids before they touch the
 * database or send a call. Pure, like `checkTourCopyStartup`, so it is unit
 * tested with no secrets. The withdraw, spotcheck and snapshot CLIs make no
 * model call and never run this, so a gateway outage cannot block a manual
 * withdraw.
 *
 * The judge must be on its own allowlist and must not be the generator
 * model, so a model never grades its own paragraphs (AC-5).
 */
export type TourCopyJudgeStartupEnv = Pick<
  Env,
  "AI_GATEWAY_BASE_URL" | "AI_GATEWAY_TOKEN" | "TOUR_COPY_MODEL" | "TOUR_COPY_JUDGE_MODEL"
>;

export interface TourCopyJudgeStartupConfig {
  gatewayBaseUrl: string;
  gatewayToken: string;
  generatorModel: string;
  judgeModel: string;
}

export class TourCopyJudgeStartupError extends Error {
  constructor(problems: string[]) {
    super(`Tour-copy eval startup check failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "TourCopyJudgeStartupError";
  }
}

/** Resolve and validate the eval config, or throw naming every problem found. */
export function checkTourCopyJudgeStartup(env: TourCopyJudgeStartupEnv): TourCopyJudgeStartupConfig {
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

  const generatorModel = env.TOUR_COPY_MODEL ?? TOUR_COPY_MODEL_DEFAULT;
  if (!(TOUR_COPY_ALLOWED_MODELS as readonly string[]).includes(generatorModel)) {
    problems.push(
      `TOUR_COPY_MODEL "${generatorModel}" is not on the allowed list (${TOUR_COPY_ALLOWED_MODELS.join(", ")}).`,
    );
  }

  const judgeModel = env.TOUR_COPY_JUDGE_MODEL ?? TOUR_COPY_JUDGE_MODEL_DEFAULT;
  if (!(TOUR_COPY_JUDGE_ALLOWED_MODELS as readonly string[]).includes(judgeModel)) {
    problems.push(
      `TOUR_COPY_JUDGE_MODEL "${judgeModel}" is not on the allowed list (${TOUR_COPY_JUDGE_ALLOWED_MODELS.join(", ")}).`,
    );
  }

  if (judgeModel === generatorModel) {
    problems.push(
      `The judge model "${judgeModel}" is the same as the generator model "${generatorModel}". ` +
        "A model must not grade its own paragraphs. Set TOUR_COPY_JUDGE_MODEL and TOUR_COPY_MODEL to different models.",
    );
  }

  if (problems.length > 0) {
    throw new TourCopyJudgeStartupError(problems);
  }

  return {
    gatewayBaseUrl: env.AI_GATEWAY_BASE_URL as string,
    gatewayToken: env.AI_GATEWAY_TOKEN as string,
    generatorModel,
    judgeModel,
  };
}
