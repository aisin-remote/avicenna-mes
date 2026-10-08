# ─────────────────────────────────────────────────────────────────────────────
# API (NestJS) — dan sekaligus image untuk wadah migrasi.
#
# Satu image dipakai dua wadah (api dan migrate) dengan sengaja: migrasi HARUS
# dijalankan dari versi kode yang sama persis dengan API yang akan memakainya.
# Image terpisah membuka celah keduanya berbeda versi, dan skema yang
# setengah cocok jauh lebih sulit didiagnosis daripada yang jelas-jelas gagal.
#
# Konteks build = akar repo, bukan apps/api. Paket workspace (@avicenna/db dan
# kawan-kawan) ada di luar folder itu dan harus ikut terbangun.
# ─────────────────────────────────────────────────────────────────────────────
# Debian-slim, BUKAN alpine — dan ini disengaja, jangan "dioptimasi" kembali.
#
# Server produksi berkernel 3.10 (CentOS 7). Node 22 di atas musl (alpine)
# gagal di tengah `pnpm install` dengan "EPERM: operation not permitted,
# write" pada penulisan .modules.yaml dan pnpm-state.json — padahal tidak
# satu pun syscall tulis yang gagal di kernel. IMAGE YANG SAMA di atas
# glibc (node:22-slim) lolos bersih. Selama server masih kernel 3.10,
# seluruh image Node di sini memakai slim.
FROM node:22-slim AS base

# Jaringan kantor memblokir registry.npmjs.org (403 dari proxy) — lihat README
# dan .npmrc. Corepack punya registry sendiri yang TIDAK membaca .npmrc, jadi
# harus diberi tahu terpisah; tanpa ini build gagal di baris pertama dengan
# "Error when performing the request" yang tidak menyebut soal proxy sama
# sekali.
#
# ARG, bukan nilai mati: di jaringan lain (atau setelah tim infra menyiapkan
# Nexus/Verdaccio) tinggal --build-arg tanpa menyunting berkas ini.
ARG COREPACK_NPM_REGISTRY=https://registry.yarnpkg.com
ENV COREPACK_NPM_REGISTRY=${COREPACK_NPM_REGISTRY}

# Versi pnpm dipatok sama dengan packageManager di package.json. Dibiarkan
# bebas, image yang dibangun bulan depan bisa memakai pnpm lain dan
# menghasilkan node_modules yang berbeda dari yang diuji.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /repo


# ── Tahap 1: dependensi ──────────────────────────────────────────────────────
#
# HANYA manifest dan lockfile yang disalin di sini, bukan seluruh kode. Lapisan
# ini yang paling mahal (unduh + tautkan ribuan paket), dan Docker hanya
# membangunnya ulang ketika berkas-berkas ini berubah. Menyalin seluruh kode
# lebih dulu membuat setiap perubahan satu huruf memicu instalasi ulang penuh.
FROM base AS deps
# .npmrc ikut disalin: di situlah registry mirror untuk pnpm install.
# Tanpa ini pnpm memakai registry bawaan dan gagal di tengah instalasi.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
RUN pnpm install --frozen-lockfile


# ── Tahap 2: bangun ──────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
# Urutannya wajib: api mengimpor hasil build ketiga paket ini, bukan sumbernya.
RUN pnpm --filter @avicenna/contracts --filter @avicenna/db --filter @avicenna/domain build
RUN pnpm --filter @avicenna/api build

# pnpm deploy merangkum api + dependensinya menjadi satu folder mandiri dengan
# node_modules yang datar — paket workspace disalin sebagai folder sungguhan,
# bukan symlink ke luar folder. Tanpa ini, menyalin apps/api saja ke image
# runtime menghasilkan symlink menggantung, dan wadahnya mati saat start dengan
# "Cannot find module '@avicenna/db'".
# Tanpa --legacy: bendera itu baru ada di pnpm 10, dan di 9.15.9 ia langsung
# menggagalkan build dengan "Unknown option".
#
# Tujuannya /repo/out, bukan /out: pnpm menafsirkan jalur keluaran relatif
# terhadap tempatnya bekerja, dan jalur yang terlihat absolut pun bisa mendarat
# di tempat lain — hasilnya folder kosong yang baru ketahuan saat wadah gagal
# menyala.
RUN pnpm --filter @avicenna/api --prod deploy /repo/out

# Berkas migrasi (.sql + jurnal) dan pelarinya ikut masuk, supaya wadah
# `migrate` bisa memakai image yang sama persis dengan API.
RUN mkdir -p /repo/out/drizzle && cp -r packages/db/drizzle/. /repo/out/drizzle/
COPY docker/migrate.cjs /repo/out/migrate.cjs

# Gagal saat BUILD kalau paket workspace ternyata tidak ikut tersalin.
#
# Tanpa pemeriksaan ini, kegagalannya baru muncul saat wadah dijalankan di
# server, sebagai "Cannot find module '@avicenna/db'" — jauh dari tempat
# sebabnya, dan sesudah image terlanjur di-push.
RUN test -f /repo/out/node_modules/@avicenna/db/dist/index.js \
 && test -f /repo/out/dist/main.js \
 && test -f /repo/out/drizzle/meta/_journal.json \
 && echo "[build] paket workspace, dist API, dan migrasi lengkap"


# ── Tahap 3: runtime ─────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Berjalan sebagai bukan-root. Wadah yang berjalan sebagai root dan menembus
# batasnya berarti root di host — dan wadah ini menghadap jaringan pabrik.
COPY --from=build --chown=node:node /repo/out ./
USER node

EXPOSE 3001
# dist/main.js dijalankan langsung dengan node, bukan lewat `pnpm start`.
# Lewat pnpm, sinyal SIGTERM dari `docker stop` berhenti di proses pnpm dan
# tidak sampai ke Node — wadahnya baru mati setelah tenggat 10 detik, memutus
# request yang sedang berjalan.
CMD ["node", "dist/main.js"]
