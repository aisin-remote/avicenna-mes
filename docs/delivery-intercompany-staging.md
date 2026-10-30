# Delivery AIIA → AII → Customer

## Perilaku AVICENNA

1. Scan PPIC di `/delivery-scan` membuka pulling (loading list + kartu customer + kartu internal untuk mode tiga arah). Finish Pulling memindahkan stok fisik FG ke staging.
2. Setelah seluruh loading list customer/PDS selesai, sistem menyimpan snapshot dan satu request `DELIVERY_GI_AIIA` dalam outbox. Belum ada nomor DO yang dialokasikan.
3. Hanya `CONFIRMED` disertai nomor dokumen SAP yang membuka `DELIVERY_GR_AII`. `SENT`, `HELD`, `FAILED`, `REJECTED`, atau nomor kosong tidak membuka tahap berikutnya.
4. Sesudah GR AII dikonfirmasi dengan nomor dokumen, AVICENNA menerbitkan nomor `SJA/YY/NNNNNN` dan membuka cetak DO. Snapshot aktual dan nomor tidak berubah saat cetak ulang.
5. **Absensi Driver** di `/delivery-return` mencatat safety, foto, tujuan/cycle, dan QR manifest/PDS atau nomor DO pada sesi pickup. Manifest yang menaungi beberapa DO wajib dipilih secara eksplisit. **Selesai Pickup** membuat request `DELIVERY_GI_AII` seluruh DO dalam satu transaksi; scan / mulai pickup belum memicu GI. Retry akhir pickup idempoten.
6. GI AII dikonfirmasi → stok fisik staging dikurangi satu kali memakai qty snapshot dan FIFO lot; loading list menjadi SHIPPED/truk DEPARTED. Driver scan sendiri belum berarti SAP berhasil atau barang diterima customer.
7. Tab **Dokumen Kembali** baru dapat menandai RECEIVED setelah GI AII berhasil. Kejadian driver dan customer diterima memiliki jejak audit terpisah.

Outbox transaksi intercompany bersumber `TT_DELIVERY_ORDER`; mutasi fisik `TT_DELIVERY`/`TT_DELIVERY_ORDER` tidak dikumpulkan lagi menjadi request transfer/delivery lama. Endpoint ship lama menolak keberangkatan langsung.

## Bukti struktur staging (DBeaver, dbo, 27 Oktober 2026)

Koneksi DBeaver **master → aisinbisa_sap_stagging → dbo** dapat membaca metadata. Koneksi Node menggunakan STAGING_* masih ditolak SQL Server: login failed. Tidak ada INSERT/UPDATE/DELETE di staging selama analisis.

| Tabel | Kolom terverifikasi | Analisis, belum kontrak SAP |
|---|---|---|
| TT_DELIVERY | CHR_DEL_NO (10), CHR_DOK_NO (10), CHR_PDS_NO (50), CHR_GI_DEL (1), CHR_SM_H_FLAG (1), CHR_SM_L_FLAG (1), CHR_FLAG_RECEIVE (1) | Sumber rencana dan status delivery. Flag ini belum cukup membedakan GI AIIA, GR AII, GI AII. |
| TT_DELIVERY_ITEM | CHR_DEL_NO (10), CHR_DEL_ITEM (10), INT_TOTAL_QTY, INT_DEL_QTY, INT_SCAN_QTY, INT_ACTUAL_DEL | Kandidat referensi item dan qty rencana/scan/aktual. Hak arah tulis tiap qty belum disepakati. |
| TT_GOODS_MOVEMENT_H | INT_NUMBER, CHR_PLANT (3), CHR_PLANT_TO (3), CHR_TYPE_TRANS (4), CHR_MVMT_TYPE (3), CHR_PLS_NO (20), CHR_VALIDATE (1) | Kandidat kepala request perpindahan antar plant/perusahaan. Jenis transaksi dan movement type wajib dikonfirmasi. |
| TT_GOODS_MOVEMENT_L | INT_NUMBER, INT_NUMBER_ITEM, CHR_DEL_NO (10), CHR_DEL_ITEM (6), CHR_PDS_NO (15), CHR_SLOC_FROM/TO (4), CHR_PART_NO/TO (18) | Kandidat penghubung request dengan delivery/PDS dan part/SLOC AIIA–AII. **PDS 15 vs header 50**, item 6 vs 10: dilarang memotong nilai diam-diam. |
| TT_GOODS_MOVEMENT_L | CHR_STATUS (1), CHR_MESSAGE (220), CHR_MATDOC (10), CHR_MATDOC_YEAR (4), CHR_PICK_STATUS (1), CHR_COMPLETE_STATUS (1), CHR_MESSAGE_DO (220) | Status umum/picking/complete dan pesan DO. Tidak boleh disamakan otomatis dengan sukses GI/GR. |
| TT_GOODS_MOVEMENT_L | CHR_PGI_DOC (10), CHR_PGI_YEAR (4), CHR_PGI_STATUS (1), CHR_GR_DOC (10), CHR_GR_YEAR (4), CHR_GR_STATUS (1) | Kandidat terkuat untuk balasan PGI dan GR. Kehadiran kolom belum membuktikan siapa yang mengisi, nilai sukses, atau satu request menghasilkan dua posting. |
| TM_MATDOC_IP_H/L | CHR_MATDOC_CKD, CHR_MATDOC_YEAR; item punya plant/SLOC/part, quantity, qty scan, supplier | Nama dan kolom mengarah ke material document inbound/import; tidak cukup bukti untuk memakainya sebagai request GR intercompany. |

## Yang masih ditahan

Contoh 20 baris goods movement terbaru yang dibaca melalui DBeaver:

- `NOFG`: plant 700/800, delivery 2200000088–2200000093, nomor PGI dan GR pada kolom masing-masing. Ada PGI=S dan GR=S; ada juga PGI=S tetapi GR=E. Bahkan CHR_STATUS=S dapat berdampingan dengan GR=E. **Status umum tidak boleh dianggap sukses keseluruhan.**
- `NODL`: contoh memiliki PGI=S dan nomor PGI, namun GR=E/kosong. Ini kandidat jalur pengiriman berikutnya, bukan bukti final bahwa NODL adalah GI AII; perlu konfirmasi SAP.
- `STRM`: contoh 301 (plant 700 → 800) dan 311 (700 → 700), dengan material document umum. Tidak dipakai sebagai pengganti otomatis GI intercompany.
- `SUBC`: contoh movement 541, bukan bagian flow delivery ini.

Keberadaan dua status PGI/GR dalam satu baris `NOFG` mengindikasikan satu request mungkin menjalankan keduanya. Orkestrasi lokal memisahkan tahap untuk menjaga urutan; adapter final dapat membaca dua hasil dari request staging yang sama jika itu dikonfirmasi SAP. Jangan membuat request GR kedua dengan menebak movement type.

Tiga request dibuat **HELD**, movement type kosong, dengan alasan kontrak staging SD belum terkonfirmasi. Adapter lama dilarang mengirim atau membaca balasan generik untuk request ini. Menyalakan STAGING_PUSH_ENABLED saja tidak membuka pengiriman SD.

Konfirmasi SAP yang dibutuhkan: (1) request awal GI AIIA + GR AII satu atau dua request; (2) CHR_TYPE_TRANS/MVMT_TYPE per tahap; (3) company/plant/SLOC/part tujuan AII; (4) arah tulis flag picking/complete dan arti PGI/GR status; (5) pemicu GI AII oleh driver serta idempotency/reversal. Query baca saja tersedia di `delivery-intercompany-staging.sql`.

## Tambahan bukti file SD/MM (28 Oktober 2026)

Arsip `SD/VB for Move SD.zip`, `VB_GOODS_MOVEMENT_SD/WindowsApplication9/Form1.vb` baris 86–99 menunjukkan worker memungut goods movement yang header `CHR_VALIDATE=X` dan item `CHR_UPLOAD=0`. Baris 190–215 mengarahkan **NOFG dan NODL ke RFC yang sama `ZZBAPI_AIIECC_SD00004`** dengan parameter delivery/item, qty, plant/SLOC, movement, transaction type, status dan pick status. Ini memperkuat kandidat jalur staging SD; belum membuktikan pemetaan NOFG/NODL ke perusahaan/tahap atau bahwa worker legacy ini sudah aktif pada target S/4.

Kode hanya mengambil `T_RETURN` dan tidak memperlihatkan penulisan balik PGI/GR. File MM memberikan referensi GR PO supplier `TT_PURCHASE_RECEIPT_H/L` dengan movement 101; jalur tersebut tidak otomatis menjadi GR AII intercompany. Kedua workbook tidak mempunyai sheet goods movement.

Rincian tabel, key, filter worker, lokasi sumber, statistik relasi sampel, partial box dan jadwal tersedia di [sap-sd-mm-reference.md](sap-sd-mm-reference.md). Posting nyata tetap ditahan; dummy full flow yang telah disiapkan tidak diubah.

Simulasi hanya lewat endpoint admin yang sudah dijaga `SAP_SIMULATION_ENABLED=true` dan push nyata mati. Semua tahap harus konsisten simulasi/nyata. DO simulasi ditandai; balasan simulasi tidak boleh membuka alur nyata. Status CONFIRMED tidak dapat di-reset melalui tombol simulasi.
