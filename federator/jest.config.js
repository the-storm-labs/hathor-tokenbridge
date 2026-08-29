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
    },
  ],
};
