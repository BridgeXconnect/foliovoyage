import { describe, expect, it } from "@jest/globals";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { checkMigrateUrls } from "../../scripts/migrate-guard";

// BRI-248. Fake hosts and a recognisable fake password: the assertions below
// check the password and query string never reach the output.
const PW = "s3cr3t-FAKE-pw";
const prodPooled = `postgresql://u:${PW}@ep-prod-aaa-111-pooler.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`;
const prodDirect = `postgresql://u:${PW}@ep-prod-aaa-111.c-4.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require`;
const devDirect = `postgresql://u:${PW}@ep-dev-bbb-222.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require`;

describe("checkMigrateUrls", () => {
  it("accepts the pooled and unpooled hosts of one endpoint, query params in any order", () => {
    const r = checkMigrateUrls(prodPooled, prodDirect);
    expect(r.ok).toBe(true);
    expect(r.message).toBe(
      "migrate guard: DATABASE_URL and DIRECT_URL point at the same endpoint (ep-prod-aaa-111)",
    );
  });

  it("rejects the incident: pooled prod DATABASE_URL vs unpooled dev DIRECT_URL", () => {
    const r = checkMigrateUrls(prodPooled, devDirect);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("DIRECT_URL points at a different database than DATABASE_URL");
    expect(r.message).toContain("ep-prod-aaa-111-pooler.c-4.us-east-2.aws.neon.tech");
    expect(r.message).toContain("ep-dev-bbb-222.c-4.us-east-2.aws.neon.tech");
    expect(r.message).not.toContain(PW);
    expect(r.message).not.toContain("sslmode");
    expect(r.message).not.toContain("channel_binding");
    expect(r.message).not.toContain("u:");
  });

  it("rejects a different database name on the same endpoint", () => {
    const r = checkMigrateUrls(prodPooled, prodDirect.replace("/neondb", "/otherdb"));
    expect(r.ok).toBe(false);
    expect(r.message).toContain("different database name");
    expect(r.message).not.toContain("otherdb");
    expect(r.message).not.toContain(PW);
  });

  it("accepts identical localhost URLs (CI)", () => {
    const url = "postgres://folio:folio@localhost:5432/folio";
    expect(checkMigrateUrls(url, url).ok).toBe(true);
  });

  it("compares the full host for non-Neon hosts", () => {
    const r = checkMigrateUrls("postgres://a:b@db-1.internal/x", "postgres://a:b@db-1-pooler.internal/x");
    expect(r.ok).toBe(false);
  });

  it.each([
    ["DATABASE_URL", undefined, prodDirect],
    ["DIRECT_URL", prodPooled, undefined],
    ["DIRECT_URL", prodPooled, ""],
    ["DATABASE_URL", `not a url ${PW}`, prodDirect],
    ["DIRECT_URL", prodPooled, `nonsense:${PW}`],
  ])("fails naming %s when it is missing or unparseable, without its value", (name, db, direct) => {
    const r = checkMigrateUrls(db, direct);
    expect(r.ok).toBe(false);
    expect(r.message).toContain(name);
    expect(r.message).not.toContain(PW);
  });
});

describe("migrate-guard runner", () => {
  const script = join(__dirname, "../../scripts/migrate-guard.js");
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, [script], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("exits 0 and prints one line for matching URLs", () => {
    const r = run({ DATABASE_URL: prodPooled, DIRECT_URL: prodDirect });
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split("\n")).toHaveLength(1);
    expect(r.stdout + r.stderr).not.toContain(PW);
  });

  it("exits non-zero for the incident and prints no credentials", () => {
    const r = run({ DATABASE_URL: prodPooled, DIRECT_URL: devDirect });
    expect(r.status).toBe(1);
    expect(r.stdout + r.stderr).not.toContain(PW);
  });

  it("exits non-zero when a variable is missing", () => {
    expect(run({ DATABASE_URL: prodPooled }).status).toBe(1);
  });
});
