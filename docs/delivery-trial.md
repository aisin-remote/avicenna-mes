# Delivery SD: fondasi lokal dan trial

## Yang sudah tersedia

- Pull staging read-only: header PO, sales area, delivery type, invoice, tanggal aktual dan flag SAP mentah. Item memakai `CHR_DEL_ITEM`, sehingga satu part di dua item tetap dua baris.
- Normalisasi CHAR/NULL/tanggal/jam dan validasi qty/item. Impor berulang memperbarui salinan, tanpa mereset progres scan. Identitas atau ukuran box yang berubah setelah scan ditahan dengan catatan.
- Hasil sinkronisasi per tanggal: dokumen baru, diperbarui, dilewati, serta maksimal 20 catatan. Masalah impor dan delivery disatukan di filter **Perlu tindakan**.
- Scan mobile: dokumen → customer → internal, detail item, progres server, antrean lokal, stable clientRef untuk retry, deteksi seri duplikat, mismatch, over/under, dan undo beralasan. Undo hanya pada tahap yang masih terbuka.
- Detail/Mutation Delivery menampilkan riwayat scan diterima/ditolak, koreksi, perpindahan stok, dan surat jalan kembali. Riwayat tidak dihapus saat undo.
- Manifest, picklist, dan kanban dibuka terpisah untuk pemilihan printer. Hasilnya preview internal; profil pemotongan PDF customer di menu Kanban tetap digunakan untuk file customer.
- Scan Surat Jalan menandai penerimaan **lokal MES** setelah dokumen berangkat, dengan pengguna/waktu dan audit idempoten.
- GI lokal masuk ke outbox dari mutasi pengiriman. Simulasi administrator dapat menolak, mengulang, atau mengonfirmasi dengan nomor `SIM-*`. Semua baris simulasi diberi `FLG_SIMULATION` dan tidak ikut push/ack/resend produksi.

## Cara trial

Aktifkan `SAP_SIMULATION_ENABLED=true` hanya pada lingkungan trial dan matikan `STAGING_PUSH_ENABLED`. Default `.env.example` tetap false. Tombol simulasi berada di menu Integrasi SAP, pada outbox DELIVERY berstatus PENDING. Tombol putar ulang hanya berlaku pada hasil trial.

```powershell
pnpm db:migrate
pnpm --filter @avicenna/db db:seed-delivery-trial
```

Seed membuat loading list hari operasional berjalan, dua box, mapping customer, kartu internal terisi, dan saldo dummy staging. Tidak mereset scan dokumen yang sudah ada. Prefiks `LL-TRIAL-*` dicadangkan untuk fixture; seluruh outbox dari dokumen ini otomatis ditandai trial. Barcode dicetak pada output perintah. Buka `/delivery-scan`, scan loading list, lalu barcode customer dan internal sesuai pasangan.

Pemeriksaan otomatis:

```powershell
pnpm --filter @avicenna/api test
pnpm --filter @avicenna/domain test
$env:DELIVERY_TRIAL_CHECK='true'
pnpm --filter @avicenna/api test:delivery-trial
```

Check integrasi opt-in membuat fixture QA baru bertanda `LL-TRIAL-QA-*` pada database lokal; tidak mengubah transaksi/master lama. Fixture dipertahankan agar audit bisa diperiksa. Check mencakup impor ulang, dua item satu part, retry idempoten, duplikat, mismatch, undo, over, penutupan bersamaan, stok, GI simulasi, penerimaan, dan riwayat.

## Menunggu kesepakatan SAP

- Endpoint/tabel posting GI dan flag balasan, movement type final, serta pemetaan nomor material/DO/billing.
- Arti `A/C`, QC, SM dan flag receive. Nilai mentah tidak otomatis mengubah status MES.
- Kunci master sales area/customer function dan format e-kanban customer.
- Kolom waktu acuan ekstraksi operasional 06:00–06:00. Saat ini query mengikuti `CHR_DEL_DATE` hari terpilih; UI menampilkan periode operasional, bukan jaminan cutoff timestamp sumber.
- Writeback penerimaan customer. Scan surat jalan kembali belum menulis ke SAP.

Sumber shipping tetap SAP/staging. Dokumen dummy dan label `SIM-*` hanya untuk trial, bukan dokumen resmi customer.
