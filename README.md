# Avicenna MES

Basis rebuild sistem MES AIIA — penyatuan **avicenna** (die casting & machining)
dan **bella** (injection) ke dalam satu aplikasi TypeScript.

> **Status: fondasi.** Yang ada di sini adalah kerangka arsitektur yang sudah
> berjalan end-to-end, bukan sistem siap pakai. Logika bisnis sebenarnya masih
> harus dipindahkan dari kedua sistem lama. Baca `docs/domain-glossary.md`
> lebih dulu — itu pekerjaan yang harus selesai sebelum menulis banyak kode.

## Kenapa arsitekturnya begini

Tiga proses terpisah, bukan satu aplikasi Next.js:

```
apps/web    Next.js 16   UI, report, dashboard
apps/api    NestJS 11    scanner, MQTT, SSE, worker, cron  <- proses long-running
packages/   db · domain · contracts                        <- dipakai keduanya
```

Alasannya langsung berasal dari masalah sistem lama:

| Masalah lama | Penyebab | Penanganan di sini |
|---|---|---|
| SSE menahan request lain | Session file PHP mengunci; `session()->save()` manual di `DirectPullingSSEController` | SSE di Node, ribuan koneksi menganggur dalam satu event loop |
| Export Excel & sync membekukan web | `QUEUE_CONNECTION=sync` di kedua sistem | BullMQ + Redis, worker terpisah |
| Layar andon menghabiskan worker | PHP-FPM: satu proses per koneksi | Satu proses menangani semua stream |
| Report berat di PC pabrik | DataTables mengirim JSON, jQuery merakit tabel di browser | React Server Component: query & render di server |
| Scan dobel saat WiFi putus | Tidak ada kunci idempoten | UNIQUE index pada `scan_events.dedupe_key` |

**Next.js sendiri tidak menyelesaikan masalah blocking.** Kalau pekerjaan berat
ditaruh di Server Action atau route handler, hasilnya sama saja dengan
controller PHP dulu. Aturan yang dipegang di repo ini:

> Apa pun yang butuh lebih dari ~200ms dan bukan bagian dari merender balasan
> harus masuk antrean, bukan dikerjakan di dalam request.

### Pembagian baca dan tulis

- **BACA** → Server Component query database langsung (`apps/web/src/lib/queries.ts`).
  Tidak ada hop jaringan; ini yang membuat halaman report cepat.
- **TULIS** → selalu lewat API (`apps/web/src/lib/api.ts`). Aturan bisnis,
  antrean, dan siaran realtime hanya ada di satu tempat.
- **Device & mesin** → langsung ke API, tidak lewat web sama sekali.

## Menjalankan

### Prasyarat

Node 20+, pnpm 9, **MySQL 8.4**, **Valkey 8+**. Docker opsional
(`docker-compose.yml` menyediakan ketiganya untuk development).

Versi MySQL sengaja dipatok 8.4 agar sama dengan server 172.18.3.75 (8.4.9).
Di macOS: `brew install mysql@8.4` lalu `brew services start mysql@8.4`.
Jangan memasang beberapa versi MySQL sekaligus sebagai layanan — semuanya
memakai datadir default yang sama dan akan saling merusak.

**Valkey, bukan Redis.** Valkey adalah fork Redis berlisensi BSD di bawah
Linux Foundation, dibuat setelah Redis mengubah lisensinya pada 2024 — jalur
yang juga diambil Debian, Ubuntu, dan AWS. Protokolnya identik, jadi BullMQ
dan ioredis jalan tanpa satu baris pun perubahan kode; variabelnya tetap
bernama `REDIS_URL` dengan skema `redis://`. Redis asli tetap bisa dipakai
kalau nanti diperlukan.

    brew install valkey && brew services start valkey

Kompatibilitas sudah diverifikasi langsung di Valkey 9.1.2: job sederhana,
retry dengan exponential backoff, delayed job, prioritas, job scheduler
(pengganti cron artisan), concurrency, dan pencatatan job gagal — semuanya
lulus.

### Catatan jaringan kantor

`registry.npmjs.org` diblokir proxy kantor (403). `.npmrc` di repo ini sudah
diarahkan ke mirror publik yang berfungsi. Corepack juga perlu diberi tahu:

```bash
export COREPACK_NPM_REGISTRY=https://registry.yarnpkg.com
```

Untuk jangka panjang, mintalah tim infra menyiapkan registry internal
(Nexus/Verdaccio) dan ganti `registry=` di `.npmrc`. Bergantung pada mirror
publik pihak ketiga bukan pilihan yang sehat untuk jangka panjang.

### Langkah

```bash
cp .env.example .env          # lalu isi DATABASE_URL & JWT_SECRET
pnpm install
docker compose up -d          # atau pakai MySQL & Redis yang sudah ada

pnpm build                    # packages harus di-build sebelum apps
pnpm db:migrate
pnpm db:seed                  # login: NPK "ADMIN" / password "admin123"

pnpm dev                      # web :3000, api :3001
```

### Perintah lain

```bash
pnpm test                     # test unit domain
pnpm typecheck
pnpm db:generate              # buat migration dari perubahan skema
pnpm db:check-names           # cegah identifier > 64 karakter (batas MySQL)
pnpm db:studio                # penjelajah database
```

## Uji cepat

```bash
TOKEN=$(curl -s -XPOST localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"npk":"ADMIN","password":"admin123"}' | jq -r .accessToken)

# Kirim scan
curl -XPOST localhost:3001/scan -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"kind":"PRODUCTION","rawCode":"AV-12345-001|BN-001|SN00042|20","lineCode":"DC-01","clientRef":"uuid-1"}'
# -> {"accepted":1,"duplicated":0,"rejected":[]}

# Kirim ulang dengan clientRef sama
# -> {"accepted":0,"duplicated":1,"rejected":[]}   idempoten

# Pantau langsung
curl -N "localhost:3001/realtime/line:DC-01?token=$TOKEN"
```

## Struktur

```
packages/contracts   Schema Zod dipakai web & api — aturan validasi ditulis sekali
packages/domain      Aturan bisnis murni, tanpa DB. Ada test-nya.
packages/db          Skema Drizzle + client. Satu sumber kebenaran untuk dua pabrik.

apps/api/src/
  auth/       JWT untuk user (NPK) dan device (scanner) — sengaja dipisah
  scan/       Penerimaan scan idempoten, single & batch
  realtime/   SSE lewat Redis pub/sub, benar walau API >1 instance
  queue/      BullMQ: producer + worker
  mqtt/       Penerima event mesin
  sync/       Sync SQL Server J922 — KERANGKA, belum diimplementasikan

apps/web/src/
  app/(app)/  Halaman terlindungi; sesi dicek di layout
  lib/queries.ts  Query baca untuk Server Component
  lib/api.ts      Pemanggil API untuk operasi tulis
```

## Keputusan yang perlu diketahui

**Drizzle, bukan Prisma.** Sistem ini report-heavy (118 raw SQL di avicenna
saja). Drizzle menghasilkan SQL transparan dan bisa turun ke raw SQL tanpa
kehilangan type safety, tepat di tempat kontrol paling dibutuhkan.

**Tabel event bersifat append-only.** `scan_events`, `kanban_events`,
`mutations`, `machine_events` tidak pernah di-UPDATE atau DELETE. Koreksi
dicatat sebagai baris baru. Ini menjaga jejak audit untuk customer tetap utuh —
dan membuat angka yang salah bisa ditelusuri, tidak seperti trigger MySQL yang
memperbarui `production_stocks` di bella.

**Saldo adalah turunan.** `stock_balances` hanya cache; sumber kebenarannya
`mutations`. Bisa dibangun ulang kapan saja lewat job `RECALC_STOCK_BALANCE`.

**Redis mati tidak menggagalkan scan.** Scan yang hilang tidak bisa dipulihkan;
job dan siaran yang hilang bisa. Karena itu enqueue dan publish dibatasi waktu
dan kegagalannya hanya dicatat. Lihat `apps/api/src/common/with-timeout.ts`.

**Batas identifier MySQL 64 karakter.** Drizzle menyusun nama constraint FK dari
nama tabel + kolom, jadi tabel bernama panjang menembus batas itu — dan baru
ketahuan saat migration dijalankan. `pnpm db:check-names` menangkapnya lebih awal.

## Yang BELUM ada

Jangan menganggap ini siap produksi. Yang belum dikerjakan:

- **Logika bisnis sebenarnya.** `parseBarcode()` di `packages/domain/src/scan.ts`
  masih placeholder. Format asli ada di `TraceScanController` (4.484 baris) dan
  `PisController`, belum terdokumentasi.
- **Jam shift belum dikonfirmasi** — lihat `packages/domain/src/shift.ts`.
- **Sync SQL Server J922** — kerangka saja.
- **Modul andon** — 9 tabel di avicenna, belum dipetakan sama sekali.
- **Otorisasi berbasis peran.** Sekarang baru autentikasi; belum ada pembatasan
  per peran.
- **Migrasi data historis** dari kedua database lama.
- **Test di api dan web.** Baru `packages/domain` yang punya test.
- **Partisi `scan_events`.** Tabel ini akan tumbuh paling cepat; rencanakan
  partisi bulanan pada `scanned_at` sebelum masuk produksi.

## Urutan pengerjaan yang disarankan

1. **Fase 0 — kamus istilah** (`docs/domain-glossary.md`). Jangan dilewat.
2. **Fase 1 — fondasi** (repo ini).
3. **Fase 2 — port bella dulu**, bukan avicenna. Kodenya lebih bersih dan
   logikanya masih diingat; belajar stack baru di kode yang dipahami.
4. **Fase 3 — avicenna masuk sebagai proses kedua** + migrasi data historis.
5. **Fase 4 — andon & IoT.**

Kedua sistem lama tetap jalan di produksi selama proses ini. Jangan matikan
apa pun sampai penggantinya terbukti minimal sebulan.
