/**
 * Jest config for the web app's unit tests (ST-17).
 * Mirrors apps/api/jest.config.js (ts-jest, node env, *.spec.ts next to source)
 * so the toolchain and the bar match the API's. Only the pure, next-free lib
 * modules are tested here; RSC/JSX is verified by `next build`, not jest.
 *
 * The `@/` alias and the `@folio/shared` workspace import are mapped so specs
 * resolve them the same way the app's tsconfig does.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.json" }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@folio/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
  testEnvironment: "node",
};
