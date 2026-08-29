const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// The shared contracts live outside the RN project root (docs/contracts) so
// all three workstreams read the same file. Metro has to be told to watch it.
const contractsRoot = path.resolve(__dirname, '..', 'docs', 'contracts');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [contractsRoot],
  resolver: {
    extraNodeModules: {
      '@contracts': contractsRoot,
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
