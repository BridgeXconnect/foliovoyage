import { describe, expect, it, jest } from "@jest/globals";
import type Anthropic from "@anthropic-ai/sdk";

import { AnthropicTourCopyGenerator } from "./tour-copy-anthropic-generator";
import type { TourCopyGenerationRequest } from "./tour-copy-generator";
import type { TourCopyStartupConfig } from "./tour-copy-startup-check";

const CONFIG: TourCopyStartupConfig = {
  gatewayBaseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic",
  gatewayToken: "gateway-token",
  model: "claude-sonnet-5",
};

const REQUEST: TourCopyGenerationRequest = {
  runId: "run_1",
  tourId: "tour_1",
  groundingHash: "hash_1",
  attempt: 1,
  systemPrompt: "You are a travel copywriter.",
  userMessage: "Write copy for this tour.",
};

function makeFakeClient(create: jest.Mock<(...args: unknown[]) => Promise<unknown>>): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

describe("AnthropicTourCopyGenerator.generate", () => {
  it("sends the expected request shape and maps a text response (AC-10, AC-13)", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "A fake paragraph." }],
      usage: {
        input_tokens: 120,
        output_tokens: 80,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 0,
      },
    });
    const generator = new AnthropicTourCopyGenerator(CONFIG, makeFakeClient(create));

    const result = await generator.generate(REQUEST);

    expect(result).toEqual({
      kind: "text",
      text: "A fake paragraph.",
      usage: {
        inputTokens: 120,
        outputTokens: 80,
        cacheCreationInputTokens: 30,
        cacheReadInputTokens: 0,
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];

    expect(params).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 400,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: REQUEST.userMessage }],
    });
    expect(params.system).toEqual([
      {
        type: "text",
        text: REQUEST.systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ]);

    const headers = options.headers as Record<string, string>;
    expect(headers["cf-aig-skip-cache"]).toBe("true");
    expect(JSON.parse(headers["cf-aig-metadata"])).toEqual({
      run_id: "run_1",
      tour_id: "tour_1",
      grounding_hash: "hash_1",
      content_type: "tour_copy",
      attempt: 1,
    });
  });

  it("joins multiple text blocks into one string", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "text", text: "First. " },
        { type: "text", text: "Second." },
      ],
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    const generator = new AnthropicTourCopyGenerator(CONFIG, makeFakeClient(create));

    const result = await generator.generate(REQUEST);

    expect(result.kind).toBe("text");
    expect((result as { kind: "text"; text: string }).text).toBe("First. Second.");
  });

  it("maps a refusal stop reason distinctly from a text result, without retrying", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "refusal",
      content: [],
      usage: { input_tokens: 5, output_tokens: 0, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    const generator = new AnthropicTourCopyGenerator(CONFIG, makeFakeClient(create));

    const result = await generator.generate(REQUEST);

    expect(result).toEqual({
      kind: "refusal",
      usage: { inputTokens: 5, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("falls back null cache token counts to 0", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "x" }],
      usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: null, cache_read_input_tokens: null },
    });
    const generator = new AnthropicTourCopyGenerator(CONFIG, makeFakeClient(create));

    const result = await generator.generate(REQUEST);

    expect(result.usage).toEqual({
      inputTokens: 10,
      outputTokens: 10,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
  });
});
