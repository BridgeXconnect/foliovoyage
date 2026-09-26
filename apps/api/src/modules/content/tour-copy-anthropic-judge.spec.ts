import { describe, expect, it, jest } from "@jest/globals";
import type Anthropic from "@anthropic-ai/sdk";

import { AnthropicTourCopyJudge } from "./tour-copy-anthropic-judge";
import type { JudgeRequest } from "./tour-copy-judge";
import { getJudgeRubric, judgeSourceText } from "./tour-copy-judge-rubric";
import type { TourCopyJudgeStartupConfig } from "./tour-copy-judge-startup-check";

const CONFIG: TourCopyJudgeStartupConfig = {
  gatewayBaseUrl: "https://gateway.ai.cloudflare.com/v1/acct/gw/anthropic",
  gatewayToken: "gateway-token",
  generatorModel: "claude-sonnet-5",
  judgeModel: "claude-opus-5-5",
};

const SOURCE: JudgeRequest["source"] = {
  title: "Longtail boat tour",
  description: "Board a longtail boat and visit four islands with a guide.",
  durationMin: 240,
  inclusions: [{ description: "Lunch" }, { description: "Snorkel gear" }],
  exclusions: [],
};

const REQUEST: JudgeRequest = {
  contentType: "tour_copy",
  runId: "run_1",
  tourId: "tour_1",
  groundingHash: "hash_1",
  source: SOURCE,
  paragraph: "Board a longtail boat and visit four islands.",
};

type CreateMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

function makeFakeClient(create: CreateMock): Anthropic {
  return { messages: { create } } as unknown as Anthropic;
}

function usage(input: number, output: number, cacheCreation: number | null = null, cacheRead: number | null = null) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheCreation,
    cache_read_input_tokens: cacheRead,
  };
}

const VALID_INPUT = {
  claims: [{ text: "visits four islands", verdict: "supported", evidence_quote: "visit four islands" }],
  leads_with_fact: true,
  lead_fact: "longtail boat",
};

function toolUse(input: unknown, stopReason = "tool_use", u = usage(100, 50)) {
  return {
    stop_reason: stopReason,
    content: [{ type: "tool_use", id: "tu_1", name: "record_verdict", input }],
    usage: u,
  };
}

function makeJudge(create: CreateMock): AnthropicTourCopyJudge {
  return new AnthropicTourCopyJudge(CONFIG, makeFakeClient(create));
}

describe("AnthropicTourCopyJudge.judge (spec 0003 AC-5, AC-6)", () => {
  it("uses the configured judge model id", () => {
    expect(makeJudge(jest.fn<(...args: unknown[]) => Promise<unknown>>()).model).toBe("claude-opus-5-5");
  });

  it("sends the forced tool call request and maps a valid verdict (AC-5)", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(
      toolUse(VALID_INPUT, "tool_use", usage(120, 80, 30, 5)),
    );

    const result = await makeJudge(create).judge(REQUEST);

    expect(result.kind).toBe("verdict");
    if (result.kind !== "verdict") throw new Error("unreachable");
    expect(result.verdict.claimVerdict).toBe("clean");
    expect(result.verdict.leadsWithFact).toBe(true);
    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 80,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 5,
    });

    expect(create).toHaveBeenCalledTimes(1);
    const [params, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];

    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1500,
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "record_verdict" },
    });
    expect((params.tools as { name: string }[]).map((tool) => tool.name)).toEqual(["record_verdict"]);
    expect(params.system).toEqual([
      { type: "text", text: getJudgeRubric("tour_copy").systemPrompt, cache_control: { type: "ephemeral" } },
    ]);
    // No sampling parameters.
    for (const key of ["temperature", "top_p", "top_k"]) expect(params).not.toHaveProperty(key);
    // Source fields and the paragraph are delimited data blocks in the user turn.
    const userTurn = (params.messages as { role: string; content: string }[])[0];
    expect(userTurn.role).toBe("user");
    expect(userTurn.content).toContain(REQUEST.paragraph);
    expect(userTurn.content).toContain(judgeSourceText(SOURCE));

    const headers = options.headers as Record<string, string>;
    expect(headers["cf-aig-skip-cache"]).toBe("true");
    expect(JSON.parse(headers["cf-aig-metadata"])).toEqual({
      run_id: "run_1",
      tour_id: "tour_1",
      grounding_hash: "hash_1",
      content_type: "tour_copy_judge",
      attempt: 1,
    });
  });

  it("retries once on an invalid tool input, with the same input, and sums the usage (AC-6)", async () => {
    const create = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce(toolUse({ claims: [] }, "tool_use", usage(100, 40, 10, 0)))
      .mockResolvedValueOnce(toolUse(VALID_INPUT, "tool_use", usage(100, 60, 0, 10)));

    const result = await makeJudge(create).judge(REQUEST);

    expect(result.kind).toBe("verdict");
    expect(result.usage).toEqual({
      inputTokens: 200,
      outputTokens: 100,
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 10,
    });
    expect(create).toHaveBeenCalledTimes(2);
    const [firstParams, firstOptions] = create.mock.calls[0] as [Record<string, unknown>, { headers: Record<string, string> }];
    const [secondParams, secondOptions] = create.mock.calls[1] as [Record<string, unknown>, { headers: Record<string, string> }];
    expect(secondParams).toEqual(firstParams);
    expect(JSON.parse(firstOptions.headers["cf-aig-metadata"]).attempt).toBe(1);
    expect(JSON.parse(secondOptions.headers["cf-aig-metadata"]).attempt).toBe(2);
  });

  it("returns invalid after a second invalid result, with no third call", async () => {
    const create = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(toolUse({ claims: "nope" }, "tool_use", usage(10, 5)));

    const result = await makeJudge(create).judge(REQUEST);

    expect(result).toEqual({
      kind: "invalid",
      usage: { inputTokens: 20, outputTokens: 10, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a max_tokens stop as invalid even when the cut off input parses, and retries once", async () => {
    const create = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce(toolUse(VALID_INPUT, "max_tokens"))
      .mockResolvedValueOnce(toolUse(VALID_INPUT, "tool_use"));

    const result = await makeJudge(create).judge(REQUEST);

    expect(result.kind).toBe("verdict");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a response with no tool call as invalid and retries once", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "I think it is fine." }],
      usage: usage(10, 5),
    });

    const result = await makeJudge(create).judge(REQUEST);

    expect(result.kind).toBe("invalid");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("maps a refusal stop reason to refusal without retrying", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({
      stop_reason: "refusal",
      content: [],
      usage: usage(7, 0),
    });

    const result = await makeJudge(create).judge(REQUEST);

    expect(result).toEqual({
      kind: "refusal",
      usage: { inputTokens: 7, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("downgrades a claim whose quote is not in the source (AC-6)", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(
      toolUse({
        claims: [{ text: "hotel pickup", verdict: "supported", evidence_quote: "free hotel pickup included" }],
        leads_with_fact: false,
        lead_fact: null,
      }),
    );

    const result = await makeJudge(create).judge(REQUEST);

    expect(result.kind).toBe("verdict");
    if (result.kind !== "verdict") throw new Error("unreachable");
    expect(result.verdict.claimVerdict).toBe("unsupported");
    expect(result.verdict.claims[0].downgraded).toBe(true);
  });

  it("lets an SDK error reach the caller and does not retry it (AC-12)", async () => {
    const error = new Error("boom");
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockRejectedValue(error);

    await expect(makeJudge(create).judge(REQUEST)).rejects.toBe(error);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("throws for a content type with no registered rubric (AC-17)", async () => {
    const create = jest.fn<(...args: unknown[]) => Promise<unknown>>();

    await expect(
      makeJudge(create).judge({ ...REQUEST, contentType: "hotel_copy" as unknown as JudgeRequest["contentType"] }),
    ).rejects.toThrow(/No judge rubric is registered/);
    expect(create).not.toHaveBeenCalled();
  });
});
