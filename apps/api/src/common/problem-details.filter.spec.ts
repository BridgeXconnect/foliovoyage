import { describe, expect, it, jest } from "@jest/globals";
import {
  ArgumentsHost,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Request, Response } from "express";

import {
  ProblemDetailsFilter,
  type ProblemDetails,
} from "./problem-details.filter";

/**
 * Build an ArgumentsHost whose Express response records what the filter writes.
 * Mirrors the real chain used by the filter: status().setHeader().json().
 */
function makeHost(path = "/v1/destinations/france/atlantis"): {
  host: ArgumentsHost;
  sent: { status?: number; header?: [string, string]; body?: ProblemDetails };
} {
  const sent: {
    status?: number;
    header?: [string, string];
    body?: ProblemDetails;
  } = {};

  const json = jest.fn((body: ProblemDetails) => {
    sent.body = body;
  });
  const setHeader = jest.fn((name: string, value: string) => {
    sent.header = [name, value];
    return { json };
  });
  const status = jest.fn((code: number) => {
    sent.status = code;
    return { setHeader };
  });

  const response = { status } as unknown as Response;
  const request = { method: "GET", originalUrl: path } as unknown as Request;

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, sent };
}

describe("ProblemDetailsFilter", () => {
  it("renders a NotFoundException as an RFC 9457 problem+json 404", () => {
    const { host, sent } = makeHost();

    new ProblemDetailsFilter().catch(
      new NotFoundException("No destination found for france/atlantis"),
      host,
    );

    expect(sent.status).toBe(404);
    expect(sent.header).toEqual(["Content-Type", "application/problem+json"]);
    expect(sent.body).toEqual({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "No destination found for france/atlantis",
      instance: "/v1/destinations/france/atlantis",
    });
  });

  it("degrades an unknown error to a generic 500 without leaking internals", () => {
    const { host, sent } = makeHost("/v1/destinations/france/paris");
    // The filter logs unexpected errors server-side; keep that noise out of
    // the test output while still asserting nothing leaks to the client.
    jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    new ProblemDetailsFilter().catch(
      new Error("secret db connection string"),
      host,
    );

    expect(sent.status).toBe(500);
    expect(sent.body?.title).toBe("Internal Server Error");
    // The raw error message must not surface to the client.
    expect(sent.body?.detail).toBeUndefined();
  });

  it("preserves the status of other HttpExceptions", () => {
    const { host, sent } = makeHost();

    new ProblemDetailsFilter().catch(new InternalServerErrorException(), host);

    expect(sent.status).toBe(500);
    expect(sent.body?.status).toBe(500);
  });
});
