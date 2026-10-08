import { describe, expect, it } from "@jest/globals";

import { parseArgs, USAGE } from "./trigger-import.cli";

function errorOf(argv: string[]): string {
  const parsed = parseArgs(argv);
  if (!("error" in parsed)) throw new Error(`expected an error, got ${JSON.stringify(parsed)}`);
  return parsed.error;
}

describe("trigger-import parseArgs (BRI-232)", () => {
  it("defaults to manual with no arguments", () => {
    expect(parseArgs([])).toEqual({ trigger: "manual" });
  });

  it("accepts --trigger scheduled", () => {
    expect(parseArgs(["--trigger", "scheduled"])).toEqual({ trigger: "scheduled" });
  });

  it("accepts --trigger manual", () => {
    expect(parseArgs(["--trigger", "manual"])).toEqual({ trigger: "manual" });
  });

  it("rejects an unknown trigger value", () => {
    const error = errorOf(["--trigger", "nightly"]);
    expect(error).toContain("Got nightly.");
    expect(error).toContain(USAGE);
  });

  it("rejects --trigger with no value", () => {
    expect(errorOf(["--trigger"])).toContain("Got (nothing).");
  });

  it("accepts --full alongside the default or an explicit trigger", () => {
    expect(parseArgs(["--full"])).toEqual({ trigger: "manual", full: true });
    expect(parseArgs(["--trigger", "scheduled", "--full"])).toEqual({
      trigger: "scheduled",
      full: true,
    });
  });

  it("rejects an unknown flag", () => {
    expect(errorOf(["--bogus"])).toContain('Unknown argument "--bogus"');
  });
});
