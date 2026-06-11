import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  tsconfig: 'tsconfig.build.json',
  outDir: 'dist',
  esbuildOptions(options) {
    options.conditions = ['import', 'require'];
  },
});
