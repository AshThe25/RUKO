/* eslint-env jest */
// safe-area-context is a native module; the test suite runs headless against
// the stub service layer, so insets are stubbed to zero.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const inset = {top: 0, right: 0, bottom: 0, left: 0};
  return {
    SafeAreaProvider: ({children}) => React.createElement(React.Fragment, null, children),
    SafeAreaView: ({children}) => React.createElement(React.Fragment, null, children),
    useSafeAreaInsets: () => inset,
  };
});
