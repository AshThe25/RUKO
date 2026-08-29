module.exports = {
  preset: 'react-native',
  setupFiles: ['<rootDir>/jest.setup.js'],
  moduleNameMapper: {
    '^@contracts$': '<rootDir>/../docs/contracts/index.ts',
    '^@contracts/(.*)$': '<rootDir>/../docs/contracts/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:@react-native|react-native|@react-navigation|react-native-screens|react-native-safe-area-context)/)',
  ],
};
