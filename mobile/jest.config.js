module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
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
