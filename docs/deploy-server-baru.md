# Memasang Avicenna MES di server baru

Panduan ini untuk **server yang benar-benar baru** — kosong, belum pernah
menjalankan Avicenna. Untuk memperbarui server yang sudah jalan, cukup lihat
[`deploy.md`](deploy.md#deploy-berikutnya).

Urutannya penting. Sebagian besar kegagalan pemasangan bukan karena satu
perintah salah, melainkan karena keputusan yang belum diambil (database di mana,
domain apa, data awalnya dari mana) lalu dikerjakan sambil jalan.

---

## 0. Checklist persiapan

Cetak ini dulu, centang sebelum menyentuh server.

**Keputusan (harus dijawab sebelum mulai)**

- [ ] Database: **Postgres lokal di server baru** atau **Postgres bersama**
      (mis. `172.18.3.73`)?
- [ ] Domain dan TLS: pakai domain + nginx, atau IP:3000 dulu?
- [ ] Data awal: **kosong (seed)** atau **impor dari server lama**?
- [ ] Server baru menggantikan yang lama, atau berjalan berdampingan?
      (menentukan apakah keduanya boleh memakai database yang sama)

**Server**

- [ ] OS dan kernel diketahui — kalau kernel 3.10 (CentOS 7), jangan pakai
      image alpine (lihat [Jebakan](#jebakan-yang-sudah-pernah-menggigit))
- [ ] Docker Engine + Compose **plugin v2** terpasang (`docker compose version`,
      bukan `docker-compose` v1)
- [ ] Disk bebas ≥ 40 GB (`df -h /`)
- [ ] RAM diketahui → menentukan `POSTGRES_SHARED_BUFFERS` (patokan: ¼ RAM)
- [ ] User pemilik repo + akses `sudo`
- [ ] Port 3000 (atau 80/443) terbuka dari jaringan pabrik
- [ ] Port 22/2244 untuk SSH admin terbuka dari jaringanmu

**Jaringan keluar dari server**

- [ ] Bisa mencapai GitHub lewat **SSH port 443** (`ssh.github.com:443`) —
      port 22 keluar biasanya diblokir
- [ ] Bisa mencapai registry npm pengganti (`.npmrc` memakai
      `registry.npmmirror.com`; `registry.npmjs.org` diblokir proxy kantor)
- [ ] Kalau memakai database bersama: port 5432 ke host itu terbuka

**Rahasia yang harus disiapkan**

- [ ] `JWT_SECRET` baru — `openssl rand -base64 48`
- [ ] Sandi Postgres baru (hindari karakter `@ : / ? #`, atau URL-encode)
- [ ] Deploy key GitHub **read-only** untuk server ini

---

## 1. Siapkan server

```bash
# user pemilik aplikasi (path HARUS /home/avicenna — lihat langkah 5)
sudo useradd -m -s /bin/bash avicenna
sudo usermod -aG wheel avicenna     # atau grup sudo di distro lain
```

Pasang Docker Engine + Compose plugin dari repo resmi Docker. Yang dibutuhkan
hanya `docker compose` (v2), bukan `docker-compose` v1 — berkas compose di repo
memakai `name:`, `profiles:`, dan `depends_on: condition: service_healthy`
yang tidak dikenal v1.

```bash
docker --version
docker compose version
sudo systemctl enable --now docker
```

Direktori kerja dibuat di langkah 3, **setelah** clone — `git clone` menolak
direktori tujuan yang sudah berisi.

**Jangan** menaruh repo di `/root` atau menjalankannya sebagai root
sehari-hari. Build dan container berjalan sebagai user biasa; root hanya
dipakai cron deploy.

---

## 2. Akses GitHub dari server

Server di jaringan privat tidak bisa dihubungi GitHub, jadi arahnya dibalik:
server yang menjemput. Pakai **deploy key read-only** — jangan akun pribadi.

Di server, sebagai user yang akan menjalankan `git fetch` (di sini `root`,
karena cron deploy berjalan sebagai root):

```bash
sudo mkdir -p /root/.ssh && sudo chmod 700 /root/.ssh
sudo ssh-keygen -t ed25519 -N '' -f /root/.ssh/github_avicenna -C "avicenna@$(hostname)"
sudo cat /root/.ssh/github_avicenna.pub
```

Tempel public key itu di GitHub → repo → **Settings → Deploy keys → Add**,
centang **read-only** (jangan allow write — server tidak perlu push).

Lalu arahkan ke port 443:

```bash
sudo tee /root/.ssh/config >/dev/null <<'EOF'
Host github-avicenna
  HostName ssh.github.com
  Port 443
  User git
  IdentityFile /root/.ssh/github_avicenna
  StrictHostKeyChecking accept-new
EOF
sudo chmod 600 /root/.ssh/config
```

Uji sebelum lanjut — ini yang paling sering gagal dan pesannya menyesatkan:

```bash
sudo ssh -T github-avicenna
# harapan: "Hi <repo>! You've successfully authenticated, but GitHub does not provide shell access."
```

---

## 3. Clone repo

Clone sebagai **root** (deploy key ada di `/root/.ssh`), lalu serahkan repo ke
user aplikasi. Dua langkah ini sering terlewat dan gejalanya membingungkan:
`git` menolak repo yang pemiliknya beda dengan user yang menjalankannya
(`dubious ownership`).

```bash
sudo git clone git@github-avicenna:aisin-remote/avicenna-mes.git /home/avicenna
sudo chown -R avicenna:avicenna /home/avicenna

# daftarkan sebagai repo tepercaya untuk KEDUA user
sudo git config --global --add safe.directory /home/avicenna
sudo -u avicenna git config --global --add safe.directory /home/avicenna

sudo -u avicenna mkdir -p /home/avicenna/backup
sudo -u avicenna git -C /home/avicenna log -1 --oneline
sudo -u avicenna git -C /home/avicenna rev-parse --abbrev-ref HEAD   # harus main
```

Kalau ingin seluruhnya berjalan sebagai `avicenna` tanpa root (lebih rapi),
buat deploy key terpisah untuk user itu dan cron-nya dipasang lewat
`crontab -u avicenna`. Jangan mencampur: key milik satu user, clone dijalankan
user lain — itu sumber kegagalan `Permission denied (publickey)` yang
menyesatkan.

---

## 4. Isi `.env`

```bash
cd /home/avicenna
cp .env.production.example .env
chmod 600 .env
```

Isi minimal:

```bash
TZ=Asia/Jakarta
JWT_SECRET=<hasil openssl rand -base64 48>

DATABASE_URL="postgresql://<user>:<sandi>@<host>:5432/avicenna"

# Hanya dipakai tumpukan data lokal (membuat database di wadah).
POSTGRES_DB=avicenna
POSTGRES_USER=avicenna
POSTGRES_PASSWORD=<sandi-baru>

# Sesuaikan dengan RAM server. 128MB hanya cukup untuk data kecil.
POSTGRES_SHARED_BUFFERS=512MB

# 0.0.0.0 selama belum ada nginx; ubah ke 127.0.0.1 setelah nginx berdiri.
WEB_BIND=0.0.0.0
WEB_PORT=3000
API_PORT=3001

# Alamat API yang dipakai BROWSER untuk monitor realtime (SSE).
# Isi origin publik server ini, BUKAN localhost — kalau tidak, browser
# pengguna mencoba menyambung ke 127.0.0.1:3001 miliknya sendiri dan monitor
# tidak pernah tersambung, tanpa pesan apa pun.
#   dengan domain : https://avicenna-next.aiia.co.id
#   dengan IP     : http://172.18.3.x:3000
NEXT_PUBLIC_API_URL=https://<domain-atau-ip-server-ini>
```

`NEXT_PUBLIC_API_URL` ditanam saat **build** (sifat variabel `NEXT_PUBLIC_*`).
Mengubahnya berarti `up -d --build`, bukan sekadar `up -d`.

`<host>` pada `DATABASE_URL`:

| Pilihan | Nilai `<host>` |
|---|---|
| Postgres lokal di server ini | `postgres` |
| Postgres bersama di server lain | IP/hostname server itu, mis. `172.18.3.73` |

**Tiga jebakan pada `.env`:**

1. `DATABASE_URL` disalin apa adanya. Karakter `@ : / ? #` di sandi harus
   di-encode (`@` → `%40`). Kalau tidak, host-nya salah dibaca dan aplikasi
   menyambung ke tempat lain tanpa satu pun pesan soal sandi.
2. `.env` **tidak ikut git** (memang begitu). Kalau server dibangun ulang dari
   nol, berkas ini harus dibuat lagi — simpan salinannya di tempat aman.
3. `.env` aman disunting kapan pun — ia tidak dilacak git, jadi tidak akan
   tertimpa `git pull`. Yang **tidak** aman adalah menyunting berkas yang
   dilacak (lihat langkah 6).

---

## 5. Nyalakan

```bash
cd /home/avicenna

# 1. Tumpukan data — sekaligus membuat jaringan avicenna-net.
docker compose --env-file .env -f docker/compose.data.yml up -d

# 2. Tunggu Postgres sehat (pertama kali initdb lebih lama).
docker compose --env-file .env -f docker/compose.data.yml ps

# 3. Tumpukan aplikasi. Wadah `migrate` jalan lebih dulu, lalu mati.
docker compose --env-file .env -f docker/compose.app.yml up -d --build
```

> Kalau `DATABASE_URL` menunjuk server lain, tumpukan data tetap dinyalakan
> meski database di dalamnya tidak dipakai. Alasannya bukan malas: jaringan
> `avicenna-net` berasal dari tumpukan itu, dan `compose.app.yml` bergantung
> padanya.

### Seed — hanya untuk database kosong

```bash
docker compose --env-file .env -f docker/compose.app.yml \
  --profile tools run --rm seed
```

**Jangan dijalankan pada database yang sudah berisi.** Seed hanya menambah;
pada data yang sudah ada ia membuat duplikat dan memecah saldo stok tanpa
galat apa pun. Untuk merapikan master yang sudah ada, pakai `selaraskan`
(lihat [`deploy.md`](deploy.md#setelah-deploy-yang-membawa-jenis-proses-atau-sloc-baru)).

Setelah seed: login `ADMIN` / `admin123`, lalu **langsung ganti sandinya**.
Sandi itu tertulis di repo.

### Kalau path repo bukan `/home/avicenna`

`docker/auto-deploy.sh` menuliskan `REPO=/home/avicenna` secara harfiah, dan
cron menjalankannya dari sana. Memakai user/path lain berarti menyunting
berkas itu **di repo** (lalu push), bukan menyuntingnya di server — karena
penyuntingan di server akan membuat `git merge --ff-only` berhenti.

---

## 6. Rilis otomatis

Sebagai root:

```bash
sudo crontab -e
```

```cron
*/5 * * * * flock -n /tmp/avicenna-deploy.lock /home/avicenna/docker/auto-deploy.sh >> /var/log/avicenna-deploy.log 2>&1
```

Log rotasi mingguan:

```bash
sudo tee /etc/logrotate.d/avicenna-deploy >/dev/null <<'EOF'
/var/log/avicenna-deploy.log {
  weekly
  rotate 8
  compress
  missingok
  notifempty
  copytruncate
}
EOF
```

Cara merilis: kerja di branch fitur → merge ke `main` → `git push origin main`.
Dalam ≤ 5 menit (+ waktu build) server menjemput sendiri.

**Aturan yang tidak boleh dilanggar:** jangan pernah menyunting berkas yang
dilacak git di server. `auto-deploy.sh` memakai `git merge --ff-only`; satu
berkas yang diubah membuat setiap deploy berhenti dengan
`GAGAL: bukan fast-forward`. Kalau terlanjur, `git checkout -- <berkas>` di
server — jangan `git reset --hard` tanpa memastikan tidak ada pekerjaan lain.

Yang dijaga script (tidak perlu diingat, tapi perlu diketahui saat debug):

| Kejadian | Perilaku |
|---|---|
| Push ke branch selain `main` | diabaikan |
| Riwayat ditulis ulang (`force push`) | deploy berhenti, tidak memaksa |
| Build gagal | HEAD dikembalikan ke commit sebelumnya, dicatat di `/var/tmp/avicenna-deploy-gagal`, dicoba ulang 1 jam sekali |
| Dua deploy bersamaan | dicegah `flock` |
| `.env`, database, seed | tidak pernah disentuh |

---

## 7. Verifikasi

Jangan bilang "sudah jalan" sebelum semuanya hijau.

```bash
# container
docker ps --format '{{.Names}}\t{{.Status}}'
# harapan: avicenna-api (healthy), avicenna-web, avicenna-postgres (healthy),
#          avicenna-valkey, avicenna-mqtt

# aplikasi
curl -sS -o /dev/null -w 'ready -> %{http_code}\n' http://127.0.0.1:3001/health/ready
curl -sS -o /dev/null -w 'login -> %{http_code}\n' http://127.0.0.1:3000/login
# harapan: 200 dan 200

# log
docker logs --since 10m avicenna-api 2>&1 | grep -iE 'error|fatal|exception' | head
docker logs avicenna-migrate 2>&1 | tail -20
```

`/health` hanya berarti prosesnya hidup. **`/health/ready`** yang berarti API
**dan** database siap — pakai yang ini.

Cek juga dari komputer lain di jaringan pabrik, bukan hanya dari server:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' http://<ip-server>:3000/login
```

---

## 8. Impor data dari server lama (kalau perlu)

Kalau server baru menggantikan yang lama, lakukan **sebelum** ada pengguna yang
mulai menulis. Hentikan aplikasi di server baru, jangan di server lama.

```bash
# ── di server LAMA ────────────────────────────────────────────────
docker exec avicenna-postgres pg_dump -U avicenna -d avicenna \
  --format=custom --no-owner --no-privileges > /tmp/avicenna-lengkap.dump

# ── pindahkan ────────────────────────────────────────────────────
scp /tmp/avicenna-lengkap.dump <user>@<server-baru>:/tmp/

# ── di server BARU ───────────────────────────────────────────────
cd /home/avicenna
docker compose --env-file .env -f docker/compose.app.yml down
docker exec -i avicenna-postgres pg_restore -U avicenna -d avicenna \
  --clean --if-exists --no-owner --no-privileges < /tmp/avicenna-lengkap.dump
docker compose --env-file .env -f docker/compose.app.yml up -d
```

Kalau yang diimpor hanya **data** ke database yang skemanya sudah dibuat
migrasi, tambahkan `--data-only --disable-triggers`.

**Dua hal yang wajib diperiksa setelah restore data:**

```sql
-- 1. Setiap sequence harus sudah melewati MAX(id).
--    Kalau tidak, insert pertama setelah impor gagal dengan "duplicate key".
SELECT t.table_schema||'.'||t.table_name AS tabel,
       (xpath('/row/m/value/text()', query_to_xml(
         format('SELECT coalesce(max(%I),0) AS m FROM %I.%I',
                c.column_name, c.table_schema, c.table_name),
         false, true, '')))[1]::text::bigint AS max_id,
       (xpath('/row/l/text()', query_to_xml(
         format('SELECT last_value AS l FROM %I', pg_get_serial_sequence(
                format('%I.%I', c.table_schema, c.table_name), c.column_name)),
         false, true, '')))[1]::text::bigint AS seq_last
FROM information_schema.columns c
WHERE c.table_schema NOT IN ('pg_catalog','information_schema')
  AND (c.is_identity = 'YES' OR c.column_default LIKE 'nextval%')
ORDER BY 1;
-- seq_last harus >= max_id untuk semua baris.

-- 2. Jumlah migrasi harus sama dengan jumlah di folder kode.
SELECT count(*) FROM drizzle.__drizzle_migrations;
```

Perbedaan jumlah baris antara sumber dan tujuan **harus bisa dijelaskan satu
per satu**, bukan "kira-kira sama". Kalau ada tabel yang sengaja dipertahankan
dari target, catat namanya dan jumlahnya.

---

## 9. Reverse proxy dan TLS

Tanpa TLS, kartu login `NPK|sandi` lewat sebagai teks polos di jaringan.

```bash
sudo cp docker/nginx/avicenna.conf.example /etc/nginx/conf.d/avicenna.conf
# ganti server_name dan jalur sertifikat, lalu:
sudo nginx -t && sudo systemctl reload nginx
```

Yang **tidak boleh dilewatkan** di vhost itu adalah blok `/realtime/`:
`proxy_buffering off` dan `proxy_read_timeout` panjang. Tanpa keduanya, monitor
realtime tersendat lalu putus tanpa pesan apa pun — di layar maupun di log.

Sesuaikan juga `NEXT_PUBLIC_API_URL` di `.env` dengan domain final
(`https://avicenna-next.aiia.co.id`), lalu build ulang:

```bash
docker compose --env-file .env -f docker/compose.app.yml up -d --build
```

Kalau nilainya masih `127.0.0.1:3001`, monitor membuka SSE ke laptop
pengguna, bukan ke server.

Setelah nginx berdiri, tutup jalur polos:

```bash
# .env
WEB_BIND=127.0.0.1

cd /home/avicenna
docker compose --env-file .env -f docker/compose.app.yml up -d
```

Selama `WEB_BIND=0.0.0.0`, TLS bisa dilewati hanya dengan mengetik
`http://<server>:3000`, lengkap dengan sandi yang lewat terbuka.

---

## 10. Cadangan

Belum ada otomatisasi bawaan. Minimal, sebelum dipakai produksi, buat skrip
terpisah supaya cron tidak penuh tanda kutip:

```bash
sudo tee /home/avicenna/backup.sh >/dev/null <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cd /home/avicenna

SANDI=$(sed -n 's/^POSTGRES_PASSWORD="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' .env)
mkdir -p backup

docker exec -e PGPASSWORD="$SANDI" avicenna-postgres \
  pg_dump -U avicenna -d avicenna --format=custom --no-owner --no-privileges \
  > "backup/avicenna-$(date +%Y%m%d-%H%M%S).dump"

# Simpan 14 hari terakhir, sisanya buang.
find backup -name 'avicenna-*.dump' -mtime +14 -delete
SCRIPT

sudo chmod 700 /home/avicenna/backup.sh
sudo chown avicenna:avicenna /home/avicenna/backup.sh

sudo tee /etc/cron.d/avicenna-backup >/dev/null <<'EOF'
30 1 * * * root /home/avicenna/backup.sh >> /var/log/avicenna-backup.log 2>&1
EOF
```

`pg_dump` berjalan dalam satu snapshot dan tidak mengunci tabel — scan tetap
jalan. Format `custom` dipilih karena bisa dipulihkan sebagian (satu tabel),
sesuatu yang tidak bisa dilakukan berkas SQL polos.

Uji restore ke database lain sesekali. Cadangan yang belum pernah dibuka
bukan cadangan, hanya harapan.

---

## 11. Rollback

**Kode:**

```bash
cd /home/avicenna
git log --oneline -5
sudo systemctl stop cron            # atau matikan baris auto-deploy sementara
git reset --hard <commit-baik>
docker compose --env-file .env -f docker/compose.app.yml up -d --build
```

**Database:** hanya bisa dikembalikan ke cadangan terakhir. Migrasi yang
menghapus kolom **tidak** bisa dibatalkan dengan deploy kode lama — karena itu
migrasi destruktif harus dianggap keputusan satu arah:

- `ALTER TABLE ... DROP COLUMN` → data kolom itu hilang permanen
- `DROP TABLE` → sama
- `TRUNCATE` → sama

Sebelum menjalankan migrasi seperti itu di server mana pun: buat `pg_dump`
penuh lebih dulu, dan pastikan aplikasi yang sedang berjalan **sudah** memakai
kode yang tidak lagi membaca kolom tersebut.

---

## Jebakan yang sudah pernah menggigit

Bukan teori — masing-masing pernah membuat server berhenti:

| Gejala | Sebab | Pencegahan |
|---|---|---|
| Berjam-jam mati, log `client password must be a string` | `POSTGRES_PASSWORD` tidak ada di `.env` | Isi sejak awal; jangan andalkan nilai bawaan |
| `.env` berisi `DATABASE_URL` tapi aplikasi menyambung ke DB lain | URL disusun ulang di `compose.app.yml` dari `POSTGRES_*` | Sejak commit `109f7a2`: `DATABASE_URL` diambil utuh dari `.env`, tanpa nilai bawaan |
| `EPERM: operation not permitted, write` saat `pnpm install` | image alpine + kernel 3.10 (seccomp lama) | Semua image Node memakai `-slim`, Postgres `bullseye` |
| Build gagal di baris pertama, `Error when performing the request` | `registry.npmjs.org` diblokir proxy | `.npmrc` + `COREPACK_NPM_REGISTRY` (sudah di Dockerfile) |
| `git fetch` jalan tapi deploy tidak pernah terpicu | `git fetch origin main` tidak memajukan `origin/main` di git lama | Script memakai `git fetch origin` tanpa refspec (sudah) |
| Deploy berhenti `bukan fast-forward` | ada berkas terlacak yang disunting di server | Jangan edit di server; perbaiki lewat repo |
| API menolak menyala: `skema database tidak cocok` | migrasi belum jalan, **atau** database lebih baru dari kode | Samakan arah rilis: kode dan migrasi naik bersamaan |
| Foto gagal diunggah, `EACCES` | volume `avicenna-foto` milik root, API jalan sebagai `node` | `docker run --rm -v avicenna-foto:/data/foto busybox chown -R 1000:1000 /data/foto` |
| Monitor realtime tidak pernah tersambung | `NEXT_PUBLIC_API_URL` masih `127.0.0.1:3001` | Isi origin publik server, lalu build ulang |
| Disk penuh dalam hitungan bulan | image lama menumpuk | `docker image prune -f` sudah ada di auto-deploy |
| Seluruh data produksi hilang | `docker compose -f docker/compose.data.yml down -v` | Jangan pernah; pisahkan tumpukan data dari aplikasi (sudah) |

---

## Urutan singkat (untuk yang sudah paham)

```bash
# server
useradd -m avicenna && usermod -aG wheel avicenna
# pasang docker + compose v2

# akses github (root)
ssh-keygen -t ed25519 -N '' -f /root/.ssh/github_avicenna
# tempel .pub ke GitHub sebagai deploy key read-only
printf 'Host github-avicenna\n  HostName ssh.github.com\n  Port 443\n  User git\n  IdentityFile /root/.ssh/github_avicenna\n' > /root/.ssh/config
ssh -T github-avicenna

# repo
git clone git@github-avicenna:aisin-remote/avicenna-mes.git /home/avicenna
chown -R avicenna:avicenna /home/avicenna
git config --global --add safe.directory /home/avicenna
sudo -u avicenna git config --global --add safe.directory /home/avicenna
sudo -u avicenna mkdir -p /home/avicenna/backup
cd /home/avicenna
cp .env.production.example .env && chmod 600 .env
# isi .env (JWT_SECRET, DATABASE_URL, POSTGRES_*, NEXT_PUBLIC_API_URL)

# nyalakan
docker compose --env-file .env -f docker/compose.data.yml up -d
docker compose --env-file .env -f docker/compose.app.yml up -d --build
docker compose --env-file .env -f docker/compose.app.yml --profile tools run --rm seed

# verifikasi
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3001/health/ready
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login

# rilis otomatis (root)
echo '*/5 * * * * flock -n /tmp/avicenna-deploy.lock /home/avicenna/docker/auto-deploy.sh >> /var/log/avicenna-deploy.log 2>&1' | crontab -
```
