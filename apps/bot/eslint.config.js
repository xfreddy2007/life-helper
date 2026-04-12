import nodeConfig from '@life-helper/eslint-config/node.js';

/** @type {import('typescript-eslint').Config} */
export default [
  ...nodeConfig,
  {
    ignores: ['dist/', 'node_modules/', 'tsup.config.js'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
