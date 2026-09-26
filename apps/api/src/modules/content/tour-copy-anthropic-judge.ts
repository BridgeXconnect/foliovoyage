import Anthropic from "@anthropic-ai/sdk";

import { JUDGE_MAX_TOKENS, JUDGE_REQUEST_TIMEOUT_MS } from "./tour-copy-eval.constants";
import type { JudgeRequest, JudgeResult, TourCopyJudge } from "./tour-copy-judge";
import type { TourCopyUsage } from "./tour-copy-generator";
import { buildJudgeUserMessage, getJudgeRubric, judgeSourceText } from "./tour-copy-judge-rubric";
import { RECORD_VERDICT_TOOL, validateJudgeToolInput } from "./tour-copy-judge-result";
import type { TourCopyJudgeStartupConfig } from "./tour-copy-judge-startup-check";

/**
 * Real {@link TourCopyJudge} (BRI-201 / spec 0003, AC-5, AC-6, AC-12). One
 * paragraph per {@link judge} call, through the same Cloudflare AI Gateway
 * host as the generator and nowhere else, with the same BYOK auth shape as
 * `AnthropicTourCopyGenerator`: `apiKey` is `null` and `x-api-key` is nulled
 * out so the gateway substitutes its stored key.
 *
 * The model is forced to call `record_verdict` once, with thinking disabled
 * and no sampling parameters. An invalid result, including a `max_tokens`
 * stop, is retried once with the same input (AC-6); a second invalid result
 * is `invalid`. A `refusal` stop is never retried. Errors from the SDK (a 429
 * that survived its own retries, a timeout, a 5xx) are not caught here: they
 * reach the caller as a rejected promise, which is where the circuit breaker
 * and the 429 stop live (AC-12).
 */

const TOOL_NAME = RECORD_VERDICT_TOOL.name;

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

    // Attempt 1, then exactly one retry with the same input (AC-6).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const message = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: JUDGE_MAX_TOKENS,
          thinking: { type: "disabled" },
          system: [{ type: "text", text: rubric.systemPrompt, cache_control: { type: "ephemeral" } }],
          tools: [RECORD_VERDICT_TOOL],
          tool_choice: { type: "tool", name: TOOL_NAME },
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

      usage = addUsage(usage, toUsage(message.usage));

      if (message.stop_reason === "refusal") {
        return { kind: "refusal", usage };
      }

      // A `max_tokens` stop means the tool input may be cut off, so it is invalid whatever it parses to.
      if (message.stop_reason === "max_tokens") continue;

      const toolUse = message.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME,
      );
      if (!toolUse) continue;

      const validation = validateJudgeToolInput(toolUse.input, sourceText);
      if (validation.ok) {
        return { kind: "verdict", verdict: validation.verdict, usage };
      }
    }

    return { kind: "invalid", usage };
  }
}
