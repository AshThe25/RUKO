module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  // Two runners live in this package, on purpose. The app-level tests in
  // `__tests__/` need React Native's module registry, so they run under Jest.
  // The risk, agent and tool tests in `src/**/__tests__/` are written against
  // `node:test` and run on plain Node, which is what lets the risk engine be
  // verified without an Android toolchain.
  //
  // Jest was collecting both and reporting 20 suites as failures for the sole
  // reason that it cannot import `node:test` -- which buried the two failures
  // in `__tests__/` that were real. Jest now owns `__tests__/` only; `npm run
  // test:unit` runs the other half. `npm run test:all` runs both.
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    '^@contracts$': '<rootDir>/../docs/contracts/index.ts',
    '^@contracts/(.*)$': '<rootDir>/../docs/contracts/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    // react-native-get-random-values ships untranspiled ESM and is not matched
    // by the bare `react-native` alternative (the next character is `-`, not
    // `/`), so Jest loaded it as CJS and choked on its top-level `let module`.
    // Transforming it is a test-infra fix; the runtime dependency is untouched.
    'node_modules/(?!(?:@react-native|react-native|react-native-safe-area-context|react-native-get-random-values)/)',
  ],
};
