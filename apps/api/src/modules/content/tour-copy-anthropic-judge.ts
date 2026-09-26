import Anthropic from "@anthropic-ai/sdk";

import { JUDGE_MAX_TOKENS, JUDGE_REQUEST_TIMEOUT_MS } from "./tour-copy-eval.constants";
import type { JudgeAttempt, JudgeAttemptOutcome, JudgeRequest, JudgeResult, TourCopyJudge } from "./tour-copy-judge";
import type { TourCopyUsage } from "./tour-copy-generator";
import { buildJudgeUserMessage, getJudgeRubric, judgeSourceText } from "./tour-copy-judge-rubric";
import { JUDGE_OUTPUT_FORMAT, validateJudgeOutput } from "./tour-copy-judge-result";
import type { TourCopyJudgeStartupConfig } from "./tour-copy-judge-startup-check";

/**
 * Real {@link TourCopyJudge} (BRI-201 / spec 0003, AC-5, AC-6, AC-12). One
 * paragraph per {@link judge} call, through the same Cloudflare AI Gateway
 * host as the generator and nowhere else, with the same BYOK auth shape as
 * `AnthropicTourCopyGenerator`: `apiKey` is `null` and `x-api-key` is nulled
 * out so the gateway substitutes its stored key.
 *
 * The answer shape is guaranteed by structured outputs
 * (`output_config.format`), not by a forced tool: Opus 5.5 rejects both
 * `thinking: disabled` and a forced `tool_choice`, so thinking is adaptive at
 * low effort and the JSON comes back as a text block. No sampling parameters
 * are sent. An invalid result, including a `max_tokens` stop or text that does
 * not parse, is retried once with the same input (AC-6); a second invalid
 * result is `invalid`. A `refusal` stop is never retried. Errors from the SDK (a 429
 * that survived its own retries, a timeout, a 5xx) are not caught here: they
 * reach the caller as a rejected promise, which is where the circuit breaker
 * and the 429 stop live (AC-12).
 */

const ZERO_USAGE: TourCopyUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

function toUsage(usage: Anthropic.Usage): TourCopyUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

function addUsage(a: TourCopyUsage, b: TourCopyUsage): TourCopyUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheCreationInputTokens: a.cacheCreationInputTokens + b.cacheCreationInputTokens,
    cacheReadInputTokens: a.cacheReadInputTokens + b.cacheReadInputTokens,
  };
}

export class AnthropicTourCopyJudge implements TourCopyJudge {
  readonly model: string;

  constructor(
    config: TourCopyJudgeStartupConfig,
    /** Injectable for tests; defaults to a real client pointed at the gateway. */
    private readonly client: Anthropic = new Anthropic({
      baseURL: config.gatewayBaseUrl,
      apiKey: null,
      timeout: JUDGE_REQUEST_TIMEOUT_MS,
      defaultHeaders: {
        "x-api-key": null,
        "cf-aig-authorization": `Bearer ${config.gatewayToken}`,
      },
    }),
  ) {
    this.model = config.judgeModel;
  }

  async judge(request: JudgeRequest): Promise<JudgeResult> {
    const rubric = getJudgeRubric(request.contentType);
    const userMessage = buildJudgeUserMessage(request.source, request.paragraph);
    const sourceText = judgeSourceText(request.source);

    let usage = ZERO_USAGE;
    const attempts: JudgeAttempt[] = [];

    // Attempt 1, then exactly one retry with the same input (AC-6).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: JUDGE_MAX_TOKENS,
          thinking: { type: "adaptive" },
          output_config: { effort: "low", format: JUDGE_OUTPUT_FORMAT },
          system: [{ type: "text", text: rubric.systemPrompt, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: userMessage }],
        },
        {
          headers: {
            "cf-aig-metadata": JSON.stringify({
              run_id: request.runId,
              tour_id: request.tourId,
              grounding_hash: request.groundingHash,
              content_type: "tour_copy_judge",
              attempt,
            }),
            "cf-aig-skip-cache": "true",
          },
        },
      );

      const callUsage = toUsage(message.usage);
      usage = addUsage(usage, callUsage);
      const record = (outcome: JudgeAttemptOutcome): void => {
        attempts.push({ outcome, outputTokens: callUsage.outputTokens });
      };

      if (message.stop_reason === "refusal") {
        record("refusal");
        return { kind: "refusal", usage, attempts };
      }

      // A `max_tokens` stop means the JSON may be cut off, so it is invalid whatever it parses to.
      if (message.stop_reason === "max_tokens") {
        record("max_tokens");
        continue;
      }

      const textBlock = message.content.find((block): block is Anthropic.TextBlock => block.type === "text");
      if (!textBlock) {
        record("no_text");
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        record("unparseable");
        continue;
      }

      const validation = validateJudgeOutput(parsed, sourceText);
      if (validation.ok) {
        record("ok");
        return { kind: "verdict", verdict: validation.verdict, usage, attempts };
      }
      record("schema_invalid");
    }

    return { kind: "invalid", usage, attempts };
  }
}
