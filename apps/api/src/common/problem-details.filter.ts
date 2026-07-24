import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * RFC 9457 "Problem Details for HTTP APIs" body.
 * https://www.rfc-editor.org/rfc/rfc9457
 */
export interface ProblemDetails {
  /** URI identifying the problem type. "about:blank" means "just the status". */
  type: string;
  /** Short, human-readable summary of the problem type. */
  title: string;
  /** HTTP status code, duplicated in the body per the RFC. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail?: string;
  /** URI reference identifying the specific occurrence (the request path). */
  instance?: string;
}

/**
 * Serialises thrown exceptions as RFC 9457 `application/problem+json` (ST-5 /
 * BRI-100). Applied at the destination controller so a missing destination
 * returns a well-shaped 404; unexpected errors degrade to a 500 problem without
 * leaking internals.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = "Internal Server Error";
    let detail: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      // Nest's built-in HttpExceptions return { statusCode, error, message };
      // `error` is the status reason phrase, `message` the specific detail.
      if (typeof body === "string") {
        title = body;
      } else {
        const b = body as { error?: string; message?: string | string[] };
        title = b.error ?? defaultTitle(status);
        detail = Array.isArray(b.message) ? b.message.join(", ") : b.message;
      }
    } else {
      // Non-HTTP error: log it (with context) but return a generic 500 so no
      // internal detail escapes to the client.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const problem: ProblemDetails = {
      type: "about:blank",
      title,
      status,
      detail,
      instance: request.originalUrl,
    };

    response
      .status(status)
      .setHeader("Content-Type", "application/problem+json")
      .json(problem);
  }
}

/** Fallback title when an HttpException carries no reason phrase. */
function defaultTitle(status: number): string {
  const phrase = HttpStatus[status];
  return typeof phrase === "string"
    ? phrase
        .toLowerCase()
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
    : "Error";
}
