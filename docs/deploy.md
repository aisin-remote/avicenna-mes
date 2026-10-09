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
docker compose --env-file .env -f docker/compose.data.yml up -d

# 2. Tunggu MySQL sehat (pertama kali bisa >1 menit — InnoDB dibangun).
docker compose --env-file .env -f docker/compose.data.yml ps

# 3. Tumpukan aplikasi. Migrasi jalan lebih dulu, otomatis.
docker compose --env-file .env -f docker/compose.app.yml up -d --build

# 4. Seed — SEKALI SAJA, dan wajib.
#    Tanpa ini tidak ada satu pun akun yang bisa masuk.
docker compose --env-file .env -f docker/compose.app.yml --profile tools run --rm seed
```

**`--env-file .env` bukan hiasan.** Tanpa itu, tempat yang dicari compose
bergantung versinya: ada yang membaca `.env` dari direktori kerja, ada yang
dari folder berkas compose (di sini `docker/`). Yang salah tempat tidak
menghasilkan galat yang jelas — variabel yang punya nilai bawaan diam-diam
memakai bawaannya, dan aplikasi menyala menunjuk database yang salah.
Menunjuknya sendiri membuat perilakunya sama di versi compose mana pun.

Buka `http://<server>:3000`, masuk dengan NPK `ADMIN` / `admin123`.

**Langsung ganti sandi ADMIN** lewat menu Administrasi → Pengguna. Sandi seed
tertulis di repo dan di dokumen ini.

## Deploy berikutnya

```bash
git pull
docker compose --env-file .env -f docker/compose.app.yml up -d --build
```

Itu saja. Migrasi baru ikut jalan sendiri lewat wadah `migrate`, dan API
menolak menyala kalau migrasinya gagal — lebih baik tidak melayani sama sekali
daripada melayani di atas skema yang belum lengkap.

Tumpukan data tidak disentuh.

## Rilis otomatis (CI/CD)

Server tidak bisa dihubungi GitHub dari internet (IP privat), jadi arusnya
dibalik: **server yang menjemput**. Cron root tiap 5 menit menjalankan
`docker/auto-deploy.sh` — fetch `origin/main`, dan kalau HEAD tertinggal ia
merge `--ff-only`, rebuild tumpukan aplikasi, lalu cek `/health/ready`.
Jejaknya di `/var/log/avicenna-deploy.log` (rotasi mingguan).

```bash
# /etc/cron.d atau crontab root:
*/5 * * * * flock -n /tmp/avicenna-deploy.lock /home/avicenna/docker/auto-deploy.sh >> /var/log/avicenna-deploy.log 2>&1
```

Cara merilis: kerjakan di branch fitur → merge ke `main` → `git push
origin main`. Dalam beberapa menit server menjemput sendiri (+ waktu build).

Yang dijaga script, supaya tidak perlu diingat:

- Hanya `main` yang memicu. Push ke branch lain diabaikan.
- Hanya fast-forward yang diterima. Riwayat yang ditulis ulang membuat
  deploy BERHENTI dan mencatat — tidak pernah `--force`.
- `flock` mencegah dua deploy tumpang tindih (build bisa lebih lama dari
  interval cron).
- Tumpukan data, seed, dan `.env` tidak pernah disentuh.
- **Build yang gagal mengembalikan HEAD ke commit sebelumnya.** Tanpa itu HEAD
  terlanjur maju ke commit yang gagal dibangun, perbandingan di awal script
  berikutnya berbunyi "sudah sama", dan rilisnya tidak pernah dicoba lagi:
  server menjalankan kode lama sementara git di server bilang semuanya
  mutakhir. Commit yang gagal dicatat di `/var/tmp/avicenna-deploy-gagal` dan
  dicoba ulang sejam sekali — cukup untuk menjemput gangguan sesaat (jaringan
  kantor putus saat `pnpm install`), tidak cukup untuk membuat server sibuk
  membangun kegagalan yang sama sepanjang hari.
- Setelah deploy berhasil, `docker image prune -f` membuang image tanpa tag
  dari rilis sebelumnya. Tanpa itu disk server habis dalam hitungan bulan, dan
  yang pertama berhenti menulis adalah MySQL.

Akses GitHub server memakai deploy key read-only lewat SSH port 443
(`ssh.github.com`) — port 22 keluar diblokir firewall kantor. Kalau fetch
gagal, yang pertama dicek adalah konektivitas itu, bukan key-nya.

## Untuk pemasangan yang sudah berjalan

Tiga hal di bawah tidak ikut terbawa oleh `git pull` + rebuild, karena
menyangkut keadaan di server, bukan isi repo.

**1. Kepemilikan volume foto.** Volume `avicenna-foto` yang dibuat sebelum
image menyediakan `/data/foto` menjadi milik root, sedangkan API berjalan
sebagai `node` — unggah foto gagal dengan EACCES. Sekali saja:

```bash
docker run --rm -v avicenna-foto:/data/foto busybox chown -R 1000:1000 /data/foto
```

**2. `WEB_BIND` di `.env` server.** Masih `0.0.0.0` dari pemasangan pertama.
Ubah ke `127.0.0.1` begitu nginx berdiri, lalu `up -d` ulang tumpukan aplikasi.

**3. Letak `.env`.** Pastikan ada di akar repo (`/home/avicenna/.env`).
`auto-deploy.sh` menerima keduanya — akar repo lebih dulu, lalu `docker/.env` —
tetapi perintah di dokumen ini menganggapnya di akar.

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

Untuk TLS, taruh reverse proxy di depan web, lalu ubah `WEB_BIND=127.0.0.1`
di `.env`. Selama `WEB_BIND=0.0.0.0`, port 3000 yang polos TETAP terbuka ke
seluruh jaringan pabrik di samping yang https — dan TLS-nya bisa dilewati
hanya dengan mengetik `http://<server>:3000`, lengkap dengan kartu login
`NPK|sandi` yang lewat sebagai teks biasa.

Contoh vhost ada di [`docker/nginx/avicenna.conf.example`](../docker/nginx/avicenna.conf.example).
Yang penting di sana bukan TLS-nya, melainkan blok `/realtime/`: tanpa
`proxy_buffering off` dan `proxy_read_timeout` panjang, monitor realtime
tersendat lalu putus tanpa satu pun pesan — di layar maupun di log. Jalankan
`nginx -t` di server sebelum reload; berkas itu belum pernah diuji nginx mana
pun.

## Log dan setelan MySQL

Setiap wadah dibatasi 10 MB x 5 berkas log (`x-log` di kedua compose). Driver
json-file bawaan Docker tumbuh tanpa batas; aplikasi ini mencatat tiap scan,
jadi yang pertama kehabisan disk bukan log-nya sendiri melainkan MySQL.

`MYSQL_BUFFER_POOL` di `.env` masih 128 MB (bawaan MySQL). Tabel scan tumbuh
belasan juta baris per tahun; begitu ia lebih besar dari buffer pool, tiap
pembacaan laporan memukul disk. Patokan: sekitar setengah RAM server yang tidak
dipakai hal lain. Berlaku setelah tumpukan data dijalankan ulang.

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
