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
  // Coverage options live at the ROOT, not inside a project. Jest silently ignores
  // coverageThreshold in a project config - it passed at any number, so the bar was decorative
  // until this was moved out. Verified by setting it to 99 and watching the run fail.
  //
  // Coverage is only meaningful against the code, not the tests or their fixtures. *.contract.ts
  // files are shared test suites, and walletLib/defaultDriver.ts is the boundary where the library
  // is driven against a real fullnode - a unit test there could only assert that the library was
  // called the way that file calls it, so it is verified by the live contract suite instead.
  collectCoverageFrom: [
    'app/**/*.ts',
    '!app/**/*.test.ts',
    '!app/**/*.contract.ts',
    '!app/**/testSupport/**',
    '!app/infra/hathor/walletLib/defaultDriver.ts',
  ],
  // collectCoverageFrom decides which files are *added* to the report; a file a test actually
  // imports is instrumented regardless and needs this to stay out of it.
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/testSupport/',
    '\\.contract\\.ts$',
    'walletLib/defaultDriver\\.ts$',
  ],
  // Set just under what the tree currently achieves, so a drop fails rather than merely showing up
  // in a trend. The bars sit below 100 because a handful of defensive fallbacks - a destructuring
  // default, a `?? '<unknown>'` in an error message, an exhaustiveness `never` branch - are not
  // reachable from a test worth writing.
  coverageThreshold: {
    global: { statements: 98, functions: 96, lines: 98, branches: 93 },
  },
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
    },
  ],
};
