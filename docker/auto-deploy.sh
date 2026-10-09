#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Auto-deploy Avicenna MES — dipanggil cron tiap 5 menit sebagai root.
#
#   */5 * * * * flock -n /tmp/avicenna-deploy.lock /home/avicenna/docker/auto-deploy.sh >> /var/log/avicenna-deploy.log 2>&1
#
# Alur: fetch origin/main → bandingkan dengan HEAD → kalau sama, keluar diam.
# Kalau beda: merge --ff-only → rebuild tumpukan aplikasi → cek /health/ready.
#
# Yang TIDAK pernah disentuh: tumpukan data (database), seed, .env.
# Kalau riwayat ditulis ulang (bukan fast-forward), deploy BERHENTI dan
# mencatat — tidak pernah memaksa, supaya tidak menimpa keadaan yang tidak
# dikenal. flock mencegah dua deploy tumpang tindih (build bisa >5 menit).
#
# Catatan: cron SELALU menjalankan script dari branch main, bukan branch
# fitur. Cara merilis: merge branch fitur ke main lalu push — dalam
# beberapa menit server menjemputnya sendiri.
# ─────────────────────────────────────────────────────────────────────────────
set -u
REPO=/home/avicenna
BRANCH=main
TAG="[auto-deploy]"
# Commit yang build-nya gagal dicatat di sini, supaya tidak dibangun ulang
# tiap lima menit sampai ada yang membetulkannya.
GAGAL_FILE=/var/tmp/avicenna-deploy-gagal
JEDA_COBA_ULANG=3600

cd "$REPO" || { echo "$TAG GAGAL: tidak bisa masuk $REPO"; exit 1; }

# Berkas .env ditunjuk EKSPLISIT.
#
# Tanpa --env-file, tempat yang dicari compose bergantung versinya: ada yang
# membaca .env dari direktori kerja, ada yang dari folder berkas compose
# (di sini: docker/). Yang salah tempat tidak menghasilkan galat yang jelas —
# variabel ber-default diam-diam memakai nilai bawaan, dan aplikasinya menyala
# menunjuk database yang salah. Menunjuknya sendiri membuat perilakunya sama
# di versi compose mana pun.
ENVFILE=""
for kandidat in "$REPO/.env" "$REPO/docker/.env"; do
  if [ -f "$kandidat" ]; then ENVFILE="$kandidat"; break; fi
done
[ -n "$ENVFILE" ] || { echo "$TAG GAGAL: .env tidak ada di $REPO maupun $REPO/docker"; exit 1; }

# Tanpa refspec eksplisit dengan sengaja: `git fetch origin main` HANYA
# menulis FETCH_HEAD dan TIDAK memajukan origin/main (git 1.8 di server),
# sehingga perbandingan di bawah selalu "sama" dan deploy tidak pernah jalan.
# Tanpa argumen, fetch memakai refspec repo dan origin/main ikut maju.
git fetch origin >/dev/null 2>&1 || { echo "$TAG GAGAL: fetch origin"; exit 1; }

LOKAL=$(git rev-parse HEAD)
JAUH=$(git rev-parse "origin/$BRANCH")
[ "$LOKAL" = "$JAUH" ] && exit 0

# Commit yang sudah pernah gagal dibangun tidak dicoba terus-menerus.
#
# Build penuh memakan menit dan CPU server produksi; mengulanginya tiap lima
# menit karena satu commit yang memang rusak berarti server sibuk membangun
# kegagalan yang sama sepanjang hari. Dicoba lagi sejam sekali — cukup untuk
# menjemput gangguan sesaat (jaringan kantor putus saat pnpm install), tidak
# cukup untuk mengganggu.
if [ -f "$GAGAL_FILE" ] && [ "$(cat "$GAGAL_FILE" 2>/dev/null)" = "$JAUH" ]; then
  UMUR=$(( $(date +%s) - $(stat -c %Y "$GAGAL_FILE" 2>/dev/null || echo 0) ))
  [ "$UMUR" -lt "$JEDA_COBA_ULANG" ] && exit 0
  echo "$TAG mencoba ulang $JAUH, gagal $((UMUR / 60)) menit lalu"
fi

echo "$TAG commit baru: $LOKAL -> $JAUH, mulai deploy $(date '+%F %T')"
git merge --ff-only "origin/$BRANCH" || { echo "$TAG GAGAL: bukan fast-forward, berhenti (perlu tangan)"; exit 1; }

if ! docker compose --env-file "$ENVFILE" -f docker/compose.app.yml up -d --build; then
  # Repo dikembalikan ke commit sebelumnya.
  #
  # Tanpa ini HEAD terlanjur maju ke commit yang gagal dibangun, dan
  # perbandingan di awal script berikutnya berbunyi "sudah sama" — rilisnya
  # tidak pernah dicoba lagi, server tetap menjalankan kode lama, dan git di
  # server bilang semuanya mutakhir. Keadaan itu yang paling mahal: tidak ada
  # yang salah sampai ada yang mencari kenapa perbaikannya tidak muncul.
  echo "$TAG GAGAL: build/up gagal, kembali ke $LOKAL"
  echo "$JAUH" > "$GAGAL_FILE"
  git reset --hard "$LOKAL" >/dev/null 2>&1 \
    || echo "$TAG PERINGATAN: reset ke $LOKAL gagal — rilis ini tidak akan dicoba ulang"
  exit 1
fi

rm -f "$GAGAL_FILE"

# Image lama dari rilis sebelumnya dibuang.
#
# Tiap deploy membangun image baru dan meninggalkan yang lama tanpa tag.
# Dengan rilis beberapa kali seminggu, disk server habis dalam hitungan bulan —
# dan yang pertama berhenti menulis adalah MySQL. Hanya yang dangling (tanpa
# tag, tidak dipakai wadah mana pun) yang dihapus.
docker image prune -f >/dev/null 2>&1 || true

SEHAT=$(curl -s -m 10 http://127.0.0.1:3001/health/ready || true)
case "$SEHAT" in
  *'"status":"ok"'*) echo "$TAG SELESAI OK di $JAUH" ;;
  *) echo "$TAG SELESAI TAPI health check gagal: $SEHAT" ;;
esac
