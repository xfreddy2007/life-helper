import baseConfig from '@life-helper/eslint-config/base.js';

/** @type {import('typescript-eslint').Config} */
export default [
  ...baseConfig,
  {
    ignores: ['node_modules/', 'dist/', '.turbo/', 'coverage/', '**/*.js', '*.config.*'],
  },
];
