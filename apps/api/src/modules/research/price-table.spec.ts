import { describe, expect, it } from "@jest/globals";

import {
  InvalidRequestError,
  KEYWORD_OVERVIEW_ENDPOINT,
  SERP_ORGANIC_ENDPOINT,
  UnknownEndpointError,
  estimateRequest,
} from "./price-table";

describe("estimateRequest", () => {
  it("prices Keyword Overview per task plus per keyword", () => {
    const keywords = Array.from({ length: 100 }, (_, i) => `kw ${i}`);
    const r = estimateRequest(KEYWORD_OVERVIEW_ENDPOINT, [{ keywords }]);
    expect(r.keywords).toBe(100);
    expect(r.estimateUsd).toBeCloseTo(0.012 + 0.00012 * 100, 9);
  });

  it("prices SERP per 10 result page, one keyword per task", () => {
    const one = estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "things to do in rome" }]);
    expect(one).toEqual({ keywords: 1, estimateUsd: 0.002 });

    const deeper = estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "rome", depth: 20 }]);
    expect(deeper.estimateUsd).toBeCloseTo(0.004, 9);
  });

  it("multiplies the SERP charge by 5 when the keyword uses a search operator", () => {
    const plain = estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "rome food tour" }]);
    const operator = estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "site:reddit.com rome food tour" }]);
    expect(operator.estimateUsd).toBeCloseTo(plain.estimateUsd * 5, 9);
  });

  it("refuses an endpoint that is not in the table", () => {
    expect(() => estimateRequest("appendix/user_data", [{}])).toThrow(UnknownEndpointError);
  });

  it("refuses a request it cannot price instead of guessing", () => {
    expect(() => estimateRequest(SERP_ORGANIC_ENDPOINT, [])).toThrow(InvalidRequestError);
    expect(() => estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "" }])).toThrow(InvalidRequestError);
    expect(() => estimateRequest(SERP_ORGANIC_ENDPOINT, [{ keyword: "a", depth: 0 }])).toThrow(InvalidRequestError);
    expect(() => estimateRequest(KEYWORD_OVERVIEW_ENDPOINT, [{ keywords: [] }])).toThrow(InvalidRequestError);
    expect(() => estimateRequest(KEYWORD_OVERVIEW_ENDPOINT, [{ keywords: [1] }])).toThrow(InvalidRequestError);
    expect(() => estimateRequest(KEYWORD_OVERVIEW_ENDPOINT, ["nope"])).toThrow(InvalidRequestError);
  });
});
