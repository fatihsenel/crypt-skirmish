// npm run lint: catches undefined names and unused code, the bugs tests and the build miss.
import globals from 'globals';

export default [
  { ignores: ['dist/', 'public/', 'node_modules/'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
    },
  },
  { files: ['scripts/**', 'tests/**', '*.config.js'], languageOptions: { globals: { ...globals.node } } },
];
