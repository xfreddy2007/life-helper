import baseConfig from './base.js';

/** @type {import('typescript-eslint').Config} */
export default [
  ...baseConfig,
  {
    rules: {
      'no-process-exit': 'error',
    },
  },
];
