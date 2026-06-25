const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');
const tseslint = require('typescript-eslint');

module.exports = [
  {
    ignores: ['node_modules/**', '**/*.min.js', 'out/**', '**/dist/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,ts}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['packages/vscode-ecode/**/*.{js,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        acquireVsCodeApi: 'readonly',
      },
    },
  },
  prettier,
];
