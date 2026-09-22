import Anthropic from "@anthropic-ai/sdk";

import type { TourCopyStartupConfig } from "./tour-copy-startup-check";
import type {
  TourCopyGenerationRequest,
  TourCopyGenerationResult,
  TourCopyGenerator,
  TourCopyUsage,
} from "./tour-copy-generator";

/**
 * Real {@link TourCopyGenerator} (build plan step 6, AC-9/AC-10/AC-11/AC-13/AC-14).
 * Calls the model exactly once per {@link generate} invocation and returns the
 * raw result; the retry-on-check-failure loop and the skip rule live in
 * `TourCopyService` (build plan step 7), not here.
 *
 * The Anthropic key never lives in Atlas: the client points at Cloudflare AI
 * Gateway (`AI_GATEWAY_BASE_URL`) with a stored, bring-your-own-key provider
 * key on the gateway side, and this process only holds the gateway's own
 * token (`AI_GATEWAY_TOKEN`), sent as `cf-aig-authorization`.
 */

/** Never sent — BYOK gateway holds the real Anthropic key, but the SDK requires a non-empty `apiKey`. */
const BYOK_PLACEHOLDER_API_KEY = "unused-byok-gateway-placeholder";

const MAX_TOKENS = 400;
const REQUEST_TIMEOUT_MS = 60_000;

function toUsage(usage: Anthropic.Usage): TourCopyUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}

export class AnthropicTourCopyGenerator implements TourCopyGenerator {
  private readonly model: string;

  constructor(
    config: TourCopyStartupConfig,
    /** Injectable for tests; defaults to a real client pointed at the gateway. */
    private readonly client: Anthropic = new Anthropic({
      baseURL: config.gatewayBaseUrl,
      apiKey: BYOK_PLACEHOLDER_API_KEY,
      timeout: REQUEST_TIMEOUT_MS,
      defaultHeaders: {
        "cf-aig-authorization": `Bearer ${config.gatewayToken}`,
      },
    }),
  ) {
    this.model = config.model;
  }

  async generate(request: TourCopyGenerationRequest): Promise<TourCopyGenerationResult> {
    const message = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "disabled" },
        system: [
          {
            type: "text",
            text: request.systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: request.userMessage }],
      },
      {
        headers: {
          "cf-aig-metadata": JSON.stringify({
            run_id: request.runId,
            tour_id: request.tourId,
            grounding_hash: request.groundingHash,
            content_type: "tour_copy",
            attempt: request.attempt,
          }),
          "cf-aig-skip-cache": "true",
        },
      },
    );

    const usage = toUsage(message.usage);

    if (message.stop_reason === "refusal") {
      return { kind: "refusal", usage };
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { kind: "text", text, usage };
  }
}
