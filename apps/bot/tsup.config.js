import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  bundle: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  format: 'esm',
  // Target Node 22 so esbuild emits native class fields without transformation.
  // This prevents a class-field lowering bug when @prisma/client is encountered.
  target: 'node22',
  // Bundle the local workspace package (TypeScript source, no build step).
  noExternal: ['@life-helper/database'],
  // Keep Prisma packages as runtime requires — they rely on native query engine
  // binaries that cannot be inlined into a JS bundle.
  external: ['@prisma/client', '.prisma/client'],
  // Provide a require() shim so bundled CJS packages (e.g. dotenv) can call
  // require('fs') and other Node built-ins inside an ESM output file.
  banner: {
    js: `import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);`,
  },
});
