// Lint gate for CI. Acceptance tests are written by the QA writer, not the builder,
// so they are left out here rather than making a builder PR fail on them.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['tests/acceptance/**', 'playwright-report/**', 'test-results/**', 'coverage/**'] },
  js.configs.recommended,
  {
    languageOptions: { globals: globals.node },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  { files: ['public/**/*.js'], languageOptions: { globals: globals.browser } },
];
