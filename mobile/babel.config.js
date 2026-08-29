module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Reads mobile/.env at build time and exposes it as the '@env' module.
    // Keep this before module-resolver so the alias below does not shadow it.
    [
      'module:react-native-dotenv',
      {moduleName: '@env', path: '.env', safe: false, allowUndefined: true},
    ],
    [
      'module-resolver',
      {
        root: ['./src'],
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
          '@': './src',
          '@contracts': '../docs/contracts',
        },
      },
    ],
  ],
};
