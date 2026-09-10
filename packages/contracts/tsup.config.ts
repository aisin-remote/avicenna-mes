import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  // Jangan bersihkan dist saat mode watch. `pnpm dev` menjalankan tsup dan
  // `nest start --watch` bersamaan; kalau dist dikosongkan lebih dulu, tsc
  // milik api mengompilasi sebelum .d.ts sempat ditulis dan gagal dengan
  // TS7016 — lalu tidak pernah mencoba ulang karena nest hanya memantau src.
  clean: !options.watch,
  // Paket ini dikonsumsi NestJS (CommonJS) dan Next.js (ESM) sekaligus,
  // jadi dependency eksternal dibiarkan di luar bundle.
  skipNodeModulesBundle: true,
  target: 'es2022',
}));
