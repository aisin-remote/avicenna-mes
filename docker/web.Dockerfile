# ─────────────────────────────────────────────────────────────────────────────
# WEB (Next.js) — mode standalone.
#
# next.config sudah menyetel output: 'standalone', yang menghasilkan server
# mandiri berisi HANYA modul yang benar-benar dipakai. Tanpa itu, image harus
# membawa seluruh node_modules apps/web — ratusan megabyte yang sebagian besar
# hanya dipakai saat membangun.
#
# Konteks build = akar repo: web mengimpor @avicenna/db, @avicenna/contracts,
# dan @avicenna/domain yang ada di luar apps/web.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS base

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


FROM deps AS build
COPY . .
RUN pnpm --filter @avicenna/contracts --filter @avicenna/db --filter @avicenna/domain build

# Tidak ada ENV NEXT_PUBLIC_* di sini dengan sengaja.
#
# Nilai NEXT_PUBLIC_ ditanam ke dalam bundel saat build, bukan dibaca saat
# jalan. Menanamnya berarti satu image hanya sah untuk satu server, dan image
# yang sama tidak bisa dipakai di staging maupun produksi. Yang menghubungi API
# dari sisi server memakai API_URL yang disuntik compose saat runtime.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @avicenna/web build


FROM base AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Tiga salinan, dan ketiganya perlu:
#   standalone  server mandiri + node_modules yang sudah ditelusuri
#   static      aset ber-hash; TIDAK ikut standalone dan harus disalin sendiri
#
# Melewatkan `static` adalah kesalahan yang paling sering terjadi: halaman tetap
# terbuka karena dirender di server, tetapi seluruh CSS dan JS-nya 404 — layar
# tampil tanpa gaya dan tanpa satu pun tombol yang berfungsi.
#
# apps/web/public sengaja TIDAK disalin: folder itu memang belum ada. COPY atas
# folder yang tidak ada menggagalkan build; tambahkan barisnya kalau nanti ada
# berkas statis (favicon, logo) yang disajikan apa adanya.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

# outputFileTracingRoot menaruh server.js mengikuti struktur repo, bukan di akar.
CMD ["node", "apps/web/server.js"]
