const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'prefer-const': 'warn',
      'consistent-return': 'warn',
      complexity: ['warn', 15],
      'max-lines-per-function': ['warn', 50],
      'max-lines': ['warn', 300],
      'max-params': ['warn', 5],
    },
    ignores: ['dist/**', 'node_modules/**', 'jest.config.js'],
  },
);
