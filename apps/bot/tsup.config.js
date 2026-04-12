import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  bundle: true,
  splitting: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  format: 'cjs',
  noExternal: ['@life-helper/database'],
});
