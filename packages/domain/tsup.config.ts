import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Paket ini dikonsumsi NestJS (CommonJS) dan Next.js (ESM) sekaligus,
  // jadi dependency eksternal dibiarkan di luar bundle.
  skipNodeModulesBundle: true,
  target: 'es2022',
});
