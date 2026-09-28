# Deploy ke server (Docker)

Ditulis untuk orang yang memegang server, bukan yang menulis kodenya.
Semua perintah dijalankan dari akar repo di server.

## Bentuknya

Dua tumpukan compose terpisah, disambung satu jaringan Docker:

```
compose.data.yml                    compose.app.yml
  mysql      (volume: mysql_data)     migrate  sekali jalan, lalu mati
  valkey     (volume: valkey_data)    api      menunggu migrate sukses
  mosquitto                           web      menunggu api sehat
            └──────── jaringan avicenna-net ────────┘
```

**Kenapa dipisah.** Tumpukan aplikasi di-deploy ulang tiap ada perubahan;
data tidak boleh disentuh sama sekali. Dengan satu berkas, satu kali
`docker compose down -v` saat deploy — perintah yang tangan sudah hafal
mengetiknya untuk membersihkan — menghapus seluruh volume database produksi.
Pemisahan ini yang membuat perintah itu TIDAK BISA menyentuh data.

**Web memegang koneksi database sendiri.** Bukan salah tempel: halaman report
membacanya langsung lewat Server Component (`apps/web/src/lib/queries.ts`),
tanpa melewati API. Jadi `web` ikut di jaringan database, dan ada dua pool
koneksi — satu di api, satu di web.

## Sekali saja: pemasangan pertama

```bash
cp .env.production.example .env
```

Lalu isi `.env`. Dua yang wajib diganti:

```bash
openssl rand -base64 48     # tempel hasilnya ke JWT_SECRET
```

`MYSQL_PASSWORD` dan `MYSQL_ROOT_PASSWORD` juga wajib — compose menolak
menyala kalau kosong, bukan diam-diam memakai string kosong.

```bash
# 1. Tumpukan data. Membuat jaringan avicenna-net yang dipakai aplikasi.
docker compose -f docker/compose.data.yml up -d

# 2. Tunggu MySQL sehat (pertama kali bisa >1 menit — InnoDB dibangun).
docker compose -f docker/compose.data.yml ps

# 3. Tumpukan aplikasi. Migrasi jalan lebih dulu, otomatis.
docker compose -f docker/compose.app.yml up -d --build

# 4. Seed — SEKALI SAJA, dan wajib.
#    Tanpa ini tidak ada satu pun akun yang bisa masuk.
docker compose -f docker/compose.app.yml --profile tools run --rm seed
```

Buka `http://<server>:3000`, masuk dengan NPK `ADMIN` / `admin123`.

**Langsung ganti sandi ADMIN** lewat menu Administrasi → Pengguna. Sandi seed
tertulis di repo dan di dokumen ini.

## Deploy berikutnya

```bash
git pull
docker compose -f docker/compose.app.yml up -d --build
```

Itu saja. Migrasi baru ikut jalan sendiri lewat wadah `migrate`, dan API
menolak menyala kalau migrasinya gagal — lebih baik tidak melayani sama sekali
daripada melayani di atas skema yang belum lengkap.

Tumpukan data tidak disentuh.

## Yang boleh dan tidak boleh

| perintah | akibat |
|---|---|
| `compose.app.yml down` | aplikasi mati, data utuh |
| `compose.app.yml down -v` | **aman** — tumpukan ini tidak punya volume |
| `compose.data.yml down` | database mati, volume tetap ada |
| `compose.data.yml down -v` | **MENGHAPUS SELURUH DATA PRODUKSI** |

## Port

Hanya `web` (3000) yang menghadap jaringan pabrik. MySQL, Valkey, dan API
diikat ke `127.0.0.1` server — tidak terjangkau dari komputer lain.

Tanpa awalan `127.0.0.1`, Docker membuka port ke semua antarmuka dan
**melewati aturan firewall host**: database jadi terjangkau dari mana pun di
jaringan, dan itu tidak terlihat di `ufw status`.

Untuk TLS, taruh reverse proxy (nginx/traefik) di depan web, lalu ubah
`WEB_BIND=127.0.0.1` di `.env`. Tanpa TLS, kartu login `NPK|sandi` lewat
sebagai teks polos di jaringan.

## Cadangan

Belum ada otomatisasi. Minimal yang harus berjalan sebelum dipakai produksi:

```bash
docker exec avicenna-mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines avicenna | gzip > backup-$(date +%F).sql.gz
```

`--single-transaction` penting: tanpa itu mysqldump mengunci tabel dan scan di
lantai produksi berhenti selama pencadangan berjalan.

## Jaringan kantor

`registry.npmjs.org` diblokir proxy (403). Sudah ditangani:

- `.npmrc` mengarah ke `registry.npmmirror.com` — ikut disalin ke dalam image
- Corepack punya registry sendiri yang TIDAK membaca `.npmrc`, diarahkan lewat
  `ARG COREPACK_NPM_REGISTRY` di kedua Dockerfile

Kalau tim infra sudah menyiapkan Nexus/Verdaccio, ganti `registry=` di `.npmrc`
dan bangun dengan:

```bash
docker build --build-arg COREPACK_NPM_REGISTRY=https://nexus.internal/repository/npm/ ...
```

## Yang belum siap produksi

Menurut README, dan tidak berubah oleh deploy ini:

- **Backflush** — pengurangan komponen mengikuti BOM, belum diuji beban nyata
- **Sync SQL Server J922** — masih kerangka, `MSSQL_SYNC_ENABLED=false`
- **Push SAP** — hanya TRANSFER; movement type masih tebakan yang menunggu
  konfirmasi tim SAP. `SAP_MSSQL_ENABLED=false`
- **Partisi `TT_HISTORY_SCAN`** — belum dipasang. Pada ~15 juta baris/tahun ini
  jadi nyata sekitar tahun kedua; jauh lebih murah dipasang selagi tabelnya
  masih kecil.
