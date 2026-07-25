/**
 * Jest config for the API's **integration** tests (ST-9 / BRI-106).
 *
 * These specs (`*.integration.spec.ts`) require a live Postgres reachable at
 * `DATABASE_URL` with migrations applied — they exercise real transactions,
 * idempotent re-runs, and rollback-on-abort, none of which can be faithfully
 * faked. They are kept out of the default `test` task (jest.config.js) so CI,
 * which has no database in the unit-test job, stays green.
 *
 * Run locally against the dev Postgres (infra/docker-compose.yml):
 *   pnpm --filter @folio/api test:integration
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.integration\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  testEnvironment: "node",
  // A real DB round-trip per case; give it more than the 5s default.
  testTimeout: 30000,
  // Every integration spec shares one Postgres and scopes its fixtures by
  // `provider: "viator"`. Running spec files in parallel workers would let one
  // file's `deleteMany` clobber another's rows mid-test, so serialize them.
  maxWorkers: 1,
};
