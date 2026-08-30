module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // The React Native preset already lets an underscore mark an intentionally
    // unused function argument or array element, but not an unused variable --
    // so the ordinary way of dropping a key,
    // `const {subject_email: _omitted, ...rest} = row`, was an error with no
    // non-awkward way to write it. This makes the one convention mean the same
    // thing everywhere rather than adding a new one.
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
        ignoreRestSiblings: true,
      },
    ],
  },
};
