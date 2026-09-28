import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  // load-env berdiri sendiri supaya script CLI (mis. staging:introspect) bisa
  // memuat .env dari root repo TANPA ikut menarik mysql2 dan seluruh skema.
  //
  // seed ikut dibangun supaya bisa dijalankan DI DALAM image produksi.
  // Tanpa ini ia hanya bisa lewat tsx, yang sengaja tidak ikut ke image —
  // dan database yang baru dipasang tidak punya satu pun akun untuk masuk,
  // sehingga aplikasinya menyala tetapi tidak bisa dipakai siapa pun.
  entry: ['src/index.ts', 'src/load-env.ts', 'src/seed.ts'],
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
