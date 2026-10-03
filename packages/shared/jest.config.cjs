/**
 * Jest config for @folio/shared's unit tests (BRI-225). Mirrors the web and api
 * configs (ts-jest, node env, `*.spec.ts` next to source). The package is
 * ESM-typed with no build step, so ts-jest compiles specs to CommonJS here.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          target: "ES2020",
          module: "commonjs",
          moduleResolution: "node10",
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ["node", "jest"],
        },
      },
    ],
  },
  testEnvironment: "node",
};
