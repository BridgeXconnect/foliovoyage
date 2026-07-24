/**
 * Jest config for the API's unit tests (ST-5 / BRI-100).
 * Specs live next to source as `*.spec.ts` and run through ts-jest, using the
 * app tsconfig so decorators / strict mode match the build.
 *
 * `*.integration.spec.ts` files are excluded here: they need a live Postgres and
 * run via `pnpm test:integration` (jest.integration.config.js) instead, so the
 * default `test` task — the one CI runs, where there is no database — stays
 * pure-unit and hermetic.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.spec\\.ts$"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  testEnvironment: "node",
  coverageDirectory: "../coverage",
  collectCoverageFrom: ["**/*.(t|j)s"],
};
