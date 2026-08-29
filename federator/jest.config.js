/**
 * Two projects side by side while the rearchitecture is in flight:
 *
 *  - `legacy` runs the existing suite under test/ against src/, transpiled by babel-jest exactly
 *    as before. Untouched, including its 5 known-failing cases in hathorEvent.test.js.
 *  - `app` runs the new tree's colocated tests through ts-jest, so tests are type-checked against
 *    tsconfig.app.json (strict, ES2022) instead of merely stripped of their types.
 *
 * Both collapse back into one project in the final phase, when src/ is replaced by app/.
 */
module.exports = {
  projects: [
    {
      displayName: 'legacy',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/**/*.test.{js,ts}'],
    },
    {
      displayName: 'app',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/app/**/*.test.ts'],
      setupFilesAfterEnv: ['<rootDir>/app/testSupport/jest.setup.ts'],
      transform: {
        '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.app.json' }],
      },
      // Coverage is only meaningful against the code, not the tests or their fixtures.
      collectCoverageFrom: ['app/**/*.ts', '!app/**/*.test.ts', '!app/**/testSupport/**'],
      // collectCoverageFrom decides which files are *added* to the report; a file a test actually
      // imports is instrumented regardless and needs this to stay out of it.
      coveragePathIgnorePatterns: ['/node_modules/', '/testSupport/'],
      // Set at what the tree currently achieves, so a drop is a failure rather than a trend. The
      // branch bar sits below 100 because a handful of defensive fallbacks - a destructuring
      // default, a `?? '<unknown>'` in an error message - are not reachable from a test worth
      // writing. Raise these as the remaining phases land.
      coverageThreshold: {
        global: { statements: 100, functions: 100, lines: 100, branches: 95 },
      },
    },
  ],
};
