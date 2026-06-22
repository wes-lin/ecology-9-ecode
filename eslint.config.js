const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

module.exports = [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['packages/vscode-ecode/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        acquireVsCodeApi: 'readonly',
      },
    },
  },
  prettier,
  {
    ignores: ['node_modules/**', '**/*.min.js', 'out/**', 'dist/**'],
  },
];
