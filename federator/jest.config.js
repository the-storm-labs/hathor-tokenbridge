/**
 * Coverage options live at the ROOT, not inside a project. Jest silently ignores coverageThreshold
 * in a project config - it passed at any number until that was found.
 *
 * Excluded from coverage, each for a stated reason: *.contract.ts files are shared test suites;
 * walletLib/defaultDriver.ts and EvmTransactionSender.ts are the boundaries where the libraries are
 * driven against a real fullnode or chain, verified by the live contract suite rather than by a
 * unit test that could only restate them; main.ts is the process bootstrap, verified by running it.
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/testSupport/jest.setup.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.contract.ts',
    '!src/**/testSupport/**',
    '!src/infra/hathor/walletLib/defaultDriver.ts',
    '!src/main.ts',
    // Operational CLIs, in the same category as main.ts: argument parsing and a call into the
    // application, verified by running them against a chain rather than by a unit test.
    '!src/scripts/**',
    '!src/infra/evm/EvmTransactionSender.ts',
  ],
  // collectCoverageFrom decides which files are *added* to the report; a file a test actually
  // imports is instrumented regardless and needs this to stay out of it.
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/testSupport/',
    '\\.contract\\.ts$',
    'walletLib/defaultDriver\\.ts$',
    'src/main\\.ts$',
    'src/scripts/',
    'EvmTransactionSender\\.ts$',
  ],
  coverageThreshold: {
    global: { statements: 98, functions: 96, lines: 98, branches: 95 },
  },
};
