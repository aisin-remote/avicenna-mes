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
# ─────────────────────────────────────────────────────────────────────────────
set -u
REPO=/home/avicenna
BRANCH=main
TAG="[auto-deploy]"

cd "$REPO" || { echo "$TAG GAGAL: tidak bisa masuk $REPO"; exit 1; }

git fetch origin "$BRANCH" >/dev/null 2>&1 || { echo "$TAG GAGAL: fetch origin/$BRANCH"; exit 1; }

LOKAL=$(git rev-parse HEAD)
JAUH=$(git rev-parse "origin/$BRANCH")
[ "$LOKAL" = "$JAUH" ] && exit 0

echo "$TAG commit baru: $LOKAL -> $JAUH, mulai deploy $(date '+%F %T')"
git merge --ff-only "origin/$BRANCH" || { echo "$TAG GAGAL: bukan fast-forward, berhenti (perlu tangan)"; exit 1; }

if ! docker compose -f docker/compose.app.yml up -d --build; then
  echo "$TAG GAGAL: build/up gagal"
  exit 1
fi

SEHAT=$(curl -s -m 10 http://127.0.0.1:3001/health/ready || true)
case "$SEHAT" in
  *'"status":"ok"'*) echo "$TAG SELESAI OK di $JAUH" ;;
  *) echo "$TAG SELESAI TAPI health check gagal: $SEHAT" ;;
esac
