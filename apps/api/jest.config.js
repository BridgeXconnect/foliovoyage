/**
 * Jest config for the API's unit tests (ST-5 / BRI-100).
 * Specs live next to source as `*.spec.ts` and run through ts-jest, using the
 * app tsconfig so decorators / strict mode match the build.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  testEnvironment: "node",
  coverageDirectory: "../coverage",
  collectCoverageFrom: ["**/*.(t|j)s"],
};
