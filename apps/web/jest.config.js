/**
 * Jest config for the web app's unit tests (ST-17).
 * Mirrors apps/api/jest.config.js (ts-jest, node env, *.spec.ts next to source)
 * so the toolchain and the bar match the API's. Mostly pure lib modules; the tour page and
 * its view are rendered to static HTML in .spec.tsx files.
 *
 * The `@/` alias and the `@folio/shared` workspace import are mapped so specs
 * resolve them the same way the app's tsconfig does.
 */
/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ["js", "json", "ts", "tsx"],
  rootDir: "src",
  testRegex: ".*\\.spec\\.tsx?$",
  testPathIgnorePatterns: ["/node_modules/"],
  transform: {
    // tsconfig.jest.json only switches JSX to the automatic runtime, so the
    // page and view specs (.spec.tsx) can render server components to HTML.
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "<rootDir>/../tsconfig.jest.json" }],
  },
  moduleNameMapper: {
    "^server-only$": "<rootDir>/../test/server-only.js",
    "^@/(.*)$": "<rootDir>/$1",
    "^@folio/shared$": "<rootDir>/../../../packages/shared/src/index.ts",
  },
  testEnvironment: "node",
};
