# Delivery SD: fondasi lokal dan trial

## Yang sudah tersedia

- Pull staging read-only: header PO, sales area, delivery type, invoice, tanggal aktual dan flag SAP mentah. Item memakai `CHR_DEL_ITEM`, sehingga satu part di dua item tetap dua baris.
- Normalisasi CHAR/NULL/tanggal/jam dan validasi qty/item. Impor berulang memperbarui salinan, tanpa mereset progres scan. Identitas atau ukuran box yang berubah setelah scan ditahan dengan catatan.
- Hasil sinkronisasi per tanggal: dokumen baru, diperbarui, dilewati, serta maksimal 20 catatan. Masalah impor dan delivery disatukan di filter **Perlu tindakan**.
- Scan mobile: dokumen → customer → internal, detail item, progres server, antrean lokal, stable clientRef untuk retry, deteksi seri duplikat, mismatch, over/under, dan undo beralasan. Undo hanya pada tahap yang masih terbuka.
- Detail/Mutation Delivery menampilkan riwayat scan diterima/ditolak, koreksi, perpindahan stok, dan surat jalan kembali. Riwayat tidak dihapus saat undo.
- Manifest, picklist, dan Kanban Internal dibuka terpisah untuk pemilihan printer. Cetak Kanban Internal memilih nomor seri kartu yang sudah terdaftar untuk part/pabrik pada loading list; QR memakai `BACKNUMBER|SERIAL`. Cetak ulang tidak membuat kartu, stok, atau scan baru.
- Kanban customer berasal dari PDF portal customer yang diupload melalui menu Kanban Customer, lalu dipotong sesuai profil customer. AVICENNA tidak membuat pengganti kanban customer pada halaman cetak delivery.
- Finish Pulling memindahkan stok FG ke staging dan membuat alur GI AIIA → GR AII. Setelah keduanya dikonfirmasi dengan nomor dokumen, AVICENNA menerbitkan satu DO per customer/PDS dengan nomor tahunan `SJA/YY/NNNNNN`.
- Absensi Driver menyediakan dua posisi truk, checklist safety, foto, customer/dock/logistik, cycle, dan beberapa DO per pickup. **Selesai Pickup** memicu GI AII; scan DO / Mulai Pickup belum memicu GI. Riwayat menyediakan rincian dan Excel; **Dokumen Kembali** menandai penerimaan setelah GI AII berhasil. Rincian ada di [driver-attendance.md](driver-attendance.md).
- Tiga tahap intercompany masuk ke outbox sebagai `DELIVERY_GI_AIIA`, `DELIVERY_GR_AII`, dan `DELIVERY_GI_AII`. Simulasi administrator memberikan balasan `SIM-*`; semua baris simulasi diberi `FLG_SIMULATION` dan tidak ikut push/ack/resend produksi.

## Cara trial

Aktifkan `SAP_SIMULATION_ENABLED=true` hanya pada lingkungan trial dan matikan `STAGING_PUSH_ENABLED`. Restart API setelah mengubah environment. Default `.env.example` tetap false. Tombol centang simulasi berada di menu Integrasi SAP, pada tahap intercompany berstatus HELD (**Ditahan**). Akses simulasi memerlukan Administrator.

```powershell
pnpm db:migrate
pnpm --filter @avicenna/db db:seed-delivery-trial
```

Seed membuat loading list hari operasional berjalan (cutoff 06:00 WIB), satu part dummy tersendiri, dua box × 20 pcs, mapping customer, dua kartu internal masing-masing berisi 20 unit, dan stok **40 pcs di FG**. Dokumen mulai dari **DRAFT, 0/2 box**. Seed berulang mempertahankan progres dan tidak menambah stok. Gunakan `DELIVERY_TRIAL_RUN=2` (hingga 99) untuk membuat trial baru pada hari yang sama.

Prefiks `LL-TRIAL-*` dicadangkan untuk fixture; outbox dokumen ini ditandai simulasi sejak tahap pertama. Barcode dan ID dokumen dicetak sebagai JSON pada output perintah. Lembar QR untuk dataset 28 Oktober 2026/run 01 tersedia di `/trial/delivery-full-20261028-01.html`.

Barcode customer pada lembar trial merupakan fixture khusus dummy untuk menguji scan; pada operasional barcode customer tetap berasal dari PDF portal. Untuk mencetak kartu internal dummy, buka `/delivery/<id>/label`, centang kedua seri TRIAL yang terdaftar, tekan **Tampilkan label pilihan**, lalu **Cetak**. Data qty pada kartu mengikuti master kartu; dukungan partial box belum ditambahkan.

1. Buka `/delivery-scan`, scan manifest atau loading list. Scan customer box 1 → internal box 1 → customer box 2 → internal box 2. Progres harus 2/2 box.
2. Tekan **Finish Pulling**. Buka `/sap?status=HELD`, cari PDS dummy, konfirmasi `DELIVERY_GI_AIIA`, lalu konfirmasi `DELIVERY_GR_AII` yang muncul. Refresh daftar bila perlu. Ini mensimulasikan balasan SAP, bukan posting SAP nyata.
3. Buka `/delivery/<id>` untuk melihat/mencetak DO bernomor `SJA/YY/NNNNNN`. QR DO berisi manifest (atau PDS jika manifest kosong).
4. Buka `/delivery-return` (**Absensi Driver**), pilih pabrik dummy dan posisi truk. Tekan **Mulai**, lengkapi helm/rompi/sepatu, ambil foto, pilih tujuan **CUSTOMER DUMMY FULL DELIVERY**, C1, lalu scan QR DO tadi dan **Mulai Pickup**. Setelah muat selesai, tekan **Selesai Pickup**. Konfirmasi `DELIVERY_GI_AII` di Integrasi SAP. Status menjadi **SHIPPED** dan stok staging berkurang 40 pcs sekali saja. Seed juga menyiapkan Tujuan Pickup khusus dummy.

Status akhir yang diharapkan: picked 2/2 box, DO terbit, waktu driver scan tercatat, ketiga tahap CONFIRMED + SIM-*, stok FG/staging part dummy masing-masing 0. Tab penerimaan customer adalah proses terpisah setelah pengiriman ini.

Pemeriksaan otomatis:

```powershell
pnpm --filter @avicenna/api test
pnpm --filter @avicenna/domain test
$env:DELIVERY_TRIAL_CHECK='true'
pnpm --filter @avicenna/api test:delivery-trial
```

Check integrasi opt-in membuat fixture QA bertanda `LL-TRIAL-QA-*` pada database lokal di dalam transaksi yang di-rollback. Check mencakup impor ulang, dua item satu part, retry idempoten, duplikat, mismatch, undo, over, stok, simulasi GI AIIA/GR AII/GI AII, penerimaan, dan riwayat. Dataset manual dari seed tetap tersedia dan tidak dipakai oleh test.

## Menunggu kesepakatan SAP

- Endpoint/tabel posting GI dan flag balasan, movement type final, serta pemetaan nomor material/DO/billing.
- Arti `A/C`, QC, SM dan flag receive. Nilai mentah tidak otomatis mengubah status MES.
- Kunci master sales area/customer function dan format e-kanban customer.
- Kolom waktu acuan ekstraksi operasional 06:00–06:00. Saat ini query mengikuti `CHR_DEL_DATE` hari terpilih; UI menampilkan periode operasional, bukan jaminan cutoff timestamp sumber.
- Writeback penerimaan customer. Scan surat jalan kembali belum menulis ke SAP.

Sumber shipping tetap SAP/staging. Dokumen dummy dan label `SIM-*` hanya untuk trial, bukan dokumen resmi customer.
