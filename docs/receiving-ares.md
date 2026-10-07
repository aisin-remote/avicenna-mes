# Receiving ARES di Avicenna

`/receiving` menjadi pintu masuk: pilih warehouse, scan Order Sheet, lalu lanjut ke layar handheld `/receiving-scan/:id`. Sesi terbuka di-resume, bukan dibuat ulang. Penerimaan manual/non-ARES dan histori lama tetap tersedia.

## Alur

- Barcode Order Sheet: `ARES:P:826100500101` (basis `826100500100`, revisi 1) atau format lama `ARES:P:PL-260921-0107-0`.
- Barcode box: `ARES:K:<ID kanban ARES>`. Scan PRINTED/SHIPPED diterima; PRINTED diberi catatan tanpa konfirmasi kirim supplier. Kanban salah order, dibatalkan, diterima ARES/MES lain, atau melebihi pesanan ditolak. Duplikat tidak menambah jumlah.
- Setiap barcode diberi UUID, masuk FIFO perangkat, dan disimpan sebelum dikirim. Retry memakai UUID yang sama. Antrean tidak dibuang saat koneksi gagal. Keyboard manual dan suara tersedia.
- Stok belum bertambah ketika scan. Tutup sesi menghasilkan lot dan mutasi RECEIVING_IN berdasarkan box aktual × pcs/box, sekali saja. Kekurangan wajib mempunyai alasan.
- Pembatalan admin mencatat koreksi, bukan menghapus riwayat. Diblokir bila stok telah dipindah/dipakai atau GR sudah SENT/CONFIRMED.

## Koneksi & mapping

Isi `ARES_DATABASE_URL` di `.env` root, restart API, dan jalankan migrasi `0017`. Adapter hanya SELECT; deployment wajib memakai akun dengan hak SELECT saja.

Mapping yang diperlukan: kode plant ARES = kode plant MES; SAP vendor number ARES = kode Master Supplier MES; part number **atau** SAP material number ARES = satu Master Part aktif di plant MES. Satuan harus sama (PC/PCS dianggap sama). Lokasi tujuan wajib WAREHOUSE di plant tersebut. Master yang belum cocok ditolak dengan pesan, bukan dibuat otomatis untuk transaksi nyata.

Order Sheet eligible: ISSUED, DOWNLOADED, SHIPPED. Detail disnapshot ketika sesi dibuka. Status/kuantitas kanban dan order tetap dibaca ulang dari ARES saat scan dan tutup, bukan dipercaya dari cache. Revisi/recovery yang memindah kanban ke order lain mengikuti kepemilikan line di ARES; jangan menerimanya di sesi lama.

## Batas cutover

Receiving, stok, dan audit baru menjadi milik MES. **Tidak ada penulisan balik** status order/kanban/receipt ke ARES; layar scan receiving ARES belum dihapus/dinonaktifkan oleh perubahan repo ini. Saat trial/cutover, jangan scan order yang sama di dua aplikasi. Sinkronisasi status dan migrasi saldo/receipt historis perlu diputuskan sebelum produksi.

GR dari receiving ARES ditahan di outbox HELD, termasuk saat collector/release otomatis berjalan. Pendorong GR/PO/item/batch ke SAP dan reversal 102 belum diaktifkan. Pembatalan menghasilkan SKIPPED. Tidak ada posting SAP nyata dari trial ini.

## Check lokal

```powershell
$env:RECEIVING_TRIAL_CHECK = 'true'
pnpm --filter @avicenna/api test:receiving-trial
```

Membuat fixture QA MES berlabel QA, menguji concurrency/idempotensi/parsial/rollback, lalu membalik stok fixture ke nol. Riwayat tetap tersimpan; ARES dan SAP tidak ditulis.

Opsional `$env:RECEIVING_ARES_DEMO = 'true'` memasterkan **hanya** supplier/part dari Order Sheet ARES yang sudah berlabel “Supplier Uji” (`PL-260921-0107`, revisi 0) di MES, supaya bisa dicoba di UI. Tidak membuat/mengubah Order Sheet sumber.

Demo: pilih UNIT / WH00, buka `ARES:P:PL-260921-0107-0`, scan `ARES:K:01M30QPXAX0YJC4DX5YVZH9VCM` (1 box × 12 pcs).
