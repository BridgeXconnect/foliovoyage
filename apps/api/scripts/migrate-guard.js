#!/usr/bin/env node
/**
 * BRI-248: refuse to run `prisma migrate deploy` when DIRECT_URL (what the
 * migration CLI connects to) points at a different database than DATABASE_URL
 * (what the app queries). For 8 days DIRECT_URL pointed at the dev endpoint, so
 * pre-deploy "succeeded" against the wrong database and nothing noticed.
 *
 * Plain Node on purpose: it runs from the migrate:deploy script before prisma,
 * in Railway's pre-deploy, in CI, and in the manual prod step, none of which
 * can rely on `nest build` output or devDependencies (ts-node). The logic is a
 * pure function (checkMigrateUrls) so the jest spec can import it; the runner
 * at the bottom only executes when the file is run directly.
 *
 * Output carries host names only. Never print a URL, user, password or query.
 */

/**
 * Neon endpoints look like ep-<name>-<id>[-pooler].<region>.aws.neon.tech; the
 * pooled and unpooled hosts of one endpoint differ only by the -pooler suffix.
 * Anything else (localhost in CI, a docker host) is compared by full host.
 */
function endpoint(hostname) {
  const [first, ...rest] = hostname.split(".");
  const isNeon = hostname.endsWith(".neon.tech") && first.startsWith("ep-");
  if (!isNeon) return { identity: hostname, label: hostname };
  const name = first.replace(/-pooler$/, "");
  return { identity: [name, ...rest].join("."), label: name };
}

function parse(name, value) {
  if (typeof value !== "string" || value.trim() === "") {
    return { error: `${name} is missing or empty` };
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return { error: `${name} is not a parseable URL` };
  }
  if (!url.hostname) return { error: `${name} is not a parseable URL (no host)` };
  // Opaque (non-special scheme) hosts are not lowercased by the URL parser.
  const host = url.hostname.toLowerCase();
  return { host, ...endpoint(host), database: url.pathname };
}

/**
 * @param {string | undefined} databaseUrl
 * @param {string | undefined} directUrl
 * @returns {{ ok: true, message: string } | { ok: false, message: string }}
 */
function checkMigrateUrls(databaseUrl, directUrl) {
  const db = parse("DATABASE_URL", databaseUrl);
  const direct = parse("DIRECT_URL", directUrl);
  const errors = [db.error, direct.error].filter(Boolean);
  if (errors.length > 0) {
    return { ok: false, message: `migrate guard: ${errors.join("; ")}` };
  }
  if (db.identity !== direct.identity) {
    return {
      ok: false,
      message:
        "migrate guard: DIRECT_URL points at a different database than DATABASE_URL " +
        `(DATABASE_URL host: ${db.host}; DIRECT_URL host: ${direct.host}). ` +
        "Refusing to run migrations.",
    };
  }
  if (db.database !== direct.database) {
    return {
      ok: false,
      message:
        "migrate guard: DIRECT_URL points at a different database name than DATABASE_URL " +
        `on the same endpoint (DATABASE_URL host: ${db.host}; DIRECT_URL host: ${direct.host}). ` +
        "Refusing to run migrations.",
    };
  }
  return {
    ok: true,
    message: `migrate guard: DATABASE_URL and DIRECT_URL point at the same endpoint (${db.label})`,
  };
}

function main() {
  const result = checkMigrateUrls(process.env.DATABASE_URL, process.env.DIRECT_URL);
  (result.ok ? console.log : console.error)(result.message);
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { checkMigrateUrls };
