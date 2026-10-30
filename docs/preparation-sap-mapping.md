# Preparation Monitoring — pemetaan dan batas integrasi

Menu Logistik → **Preparation Monitoring**, route `/preparation-monitoring`.
Referensi: `stagging-body`, `/dashboard/delivery`, `LoadingListController`, `dashboard_delivery.blade.php`.
Struktur SAP di bawah diperiksa read-only melalui DBeaver pada 23 Oktober 2026, database `aisinbisa_sap_stagging`, schema `dbo`.

## Sumber data

| Kebutuhan | Tabel / kolom SAP | Pemetaan MES |
| --- | --- | --- |
| Dokumen delivery | `TT_DELIVERY.CHR_DEL_NO` (PK) | `deliveries.documentNumber` |
| Manifest, PDS | `CHR_DOK_NO`, `CHR_PDS_NO` | Referensi dokumen; nama bisnis resminya masih perlu konfirmasi SAP |
| Customer, destination | `CHR_CUS_NO`, `CHR_CUS_DEST` | Customer lokal yang sudah terpetakan dan destination dokumen |
| Cycle, tanggal kirim | `CHR_CYCLE`, `CHR_DEL_DATE` | Cycle dinormalisasi (`01`, `1-`, `Cycle 1` → 1); tanggal `YYYYMMDD` |
| Baris pesanan | `TT_DELIVERY_ITEM`, PK `CHR_DEL_NO + CHR_DEL_ITEM` | Satu baris MES per nomor item SAP, **bukan** per part saja |
| Part customer/internal | `CHR_CUST_PART_NO`, `CHR_PART_NO` | Referensi part pada item |
| Rencana pcs/kemasan | `INT_TOTAL_QTY`, `INT_QTY_PER_BOX` | Rencana kanban memakai aturan importer delivery yang sudah ada. Arti qty rencana vs qty kirim perlu dikonfirmasi. |
| Nama customer | `TM_CUST.CHR_CUST_NO`, `CHR_CUST_NAME` | Master lokal; key sumber sebenarnya juga mencakup `CHR_SORG + CHR_DIS_CHANNEL + CHR_DIVISION` |
| Part/back number | `TM_PARTS.CHR_PART_NO`, `CHR_PART_NAME`, `CHR_BACK_NO` | Master part lokal yang sudah dipetakan ke pabrik |
| Pemetaan part customer | `TM_SHIPPING_PARTS` | Key sumber `CHR_SALES_ORG + CHR_DIS_CHANNEL + CHR_CUS_NO + CHR_PART_NO`; jangan join hanya part |
| Referensi jadwal SAP | `TM_DELIV_TIME.CHR_PICK_TIME`, `CHR_LOADING_TIME`, `CHR_DEL_TIME` | Disimpan terpisah sebagai jam mentah SAP, tidak otomatis menjadi jadwal PPIC |

Key `TM_DELIV_TIME`: **`CHR_CUST_NO + CHR_DEST_NO + CHR_GATE_NO + CHR_CYCLE`**.
Header delivery tidak memiliki gate, sehingga beberapa gate pada customer/destination/cycle yang sama tidak boleh dipilih sembarang.
Tujuh sampel jadwal yang diperiksa mempunyai seluruh kolom jam kosong. Cycle juga memakai bentuk `1-` dan `10-`.

Tambahan referensi file 28 Oktober 2026: workbook `SD/Sample Data for All Table Linked to SAP - SD.xlsx` sheet `TM_DELIV_TIME!A2:I51` memiliki 50 baris dengan clock terisi. Sebanyak 19 baris memakai 000000 pada ketiga jam; makna midnight vs belum dijadwalkan belum pasti. Ada 13 key customer/destination/cycle dengan lebih dari satu gate. Contoh baris 2: pick 04:00, loading 06:45, delivery 07:00; baris 51: 15:50 → 23:35 → 03:10. Bukti file ini melengkapi snapshot database sebelumnya, tidak menyatakan database saat ini mempunyai isi identik. Lihat [sap-sd-mm-reference.md](sap-sd-mm-reference.md).

`TM_KANBAN` dapat menjadi referensi packaging/kanban/pabrik, tetapi bukan sumber progres preparation aktual.
`TT_EKANBAN_ORDER` merupakan kandidat demand sebelum delivery dan tidak digabungkan dengan delivery agar tidak double count.
`TT_EKANBAN_CUST` pada schema yang diperiksa hanya memiliki `CHR_ID` char(800), bukan kolom barcode terstruktur.

## Kepemilikan dan perhitungan

- SAP memiliki kepala dokumen dan rencana item. MES hanya menyalin melalui importer delivery yang sudah ada.
- Preparation memakai **pickedKanban/pickedQty**, bukan actualKanban/actualQty (loading).
- Aktual berasal dari ledger scan MES (`TT_HISTORY_SCAN`, kind DELIVERY, metadata `phase=PULLING`, `deliveryId`, `deliveryLineId`). Kolom bernama `INT_SCAN_QTY` di staging **tidak diasumsikan** sama dengan progress pulling baru ini.
- Undo dilipat per item/tahap. Timestamp scan yang dibatalkan tidak dihitung sebagai penyelesaian.
- Kekurangan dihitung per item `max(plan − picked, 0)`, lalu dijumlah. Over-scan suatu item tidak menutupi kekurangan item lain.
- Dokumen tanpa target/packaging yang valid tidak dinyatakan complete. Complete tanpa jejak waktu yang lengkap tidak diklaim on time.
- Pengelompokan memakai pabrik, customer, tanggal delivery, cycle, destination; PDS dipecah di dalamnya. PDS kosong tidak menggabungkan semua dokumen.
- Jejak produksi dicocokkan dengan pabrik+part+seri dan timestamp produksi **terakhir sebelum pulling**. Tidak memakai `kanbans.producedAt` saat ini, karena kartu dapat dipakai berulang.
- Detail riwayat menampilkan maksimal 1.000 event terakhir dan memberi peringatan jika terpotong. Angka ringkasan tetap berasal dari counter item lengkap.

## Master Cycle dan waktu

Tabel lokal baru: `logistics.TM_PREPARATION_CYCLE`.
Field PPIC: customer, destination/gate opsional, cycle, mulai/selesai preparation, hari offset H−14…H+14, ETA truck, aktif/nonaktif.
Field SAP: pick/loading/delivery clock dan syncedAt, terpisah dari override PPIC.

Jadwal PPIC yang terkonfigurasi diprioritaskan atas baris jam SAP kosong. Jadwal gate kosong dapat menjadi acuan PPIC untuk gate yang ambigu.
Semua datetime memakai **Asia/Jakarta**. Jika selesai ≤ mulai, preparation selesai hari berikutnya. Posisi ETA truck mengikuti aturan lintas tengah malam pada referensi lama; hari offset juga diterapkan. Data H±hari yang menyentuh periode tampilan tetap terlihat.

Status truk memakai timestamp pickup lokal yang sudah ada (`truckPickedAt`). Belum ditemukan timestamp kedatangan/pickup truk pada SAP header yang diperiksa. Arrival dan departure tidak diturunkan dari flag GI.

## Fitur layar

- Dashboard dan Master Cycle dalam satu menu.
- Filter tanggal/customer/cycle/status, timeline harian atau multi-hari/mingguan otomatis sesuai rentang (maksimal 31 hari).
- KPI delivery, pickup, preparation telat, dan truck delay.
- Bar preparation bertingkat bila jadwal tumpang-tindih, segmentasi PDS, truck ETA, now marker, tooltip dan dialog detail.
- Drill-down loading list → item, kekurangan, perbandingan produksi/pulling dan selisih deadline.
- Panel Dokumen Customer dari timeline/PDS menampilkan arsip Kanban Customer hasil potong, Manifest, dan Skid Label dari PDF portal, dengan Cetak / Preview / Download. Upload dan pemotongan tersimpan per customer/pabrik/PDS, terpisah dari Kanban Internal. Lihat `customer-delivery-documents.md`.
- CRUD Master Cycle, daftar customer, setting marker ETA/finish per browser, mode fullscreen, refresh tampilan otomatis 30 detik.
- Popup keterlambatan dan alarm audio opt-in, konfirmasi per sesi browser (tidak mengubah transaksi).
- Sync manual tiga hari dari tanggal awal, hasil dan catatan skip. Ini hanya membaca staging dan memperbarui cache lokal; **tidak** mengaktifkan global master pull/push.

## Yang belum setara / perlu konfigurasi

1. Koneksi `STAGING_HOST/DATABASE/USER/PASSWORD` masih belum tersedia pada `.env` AVICENNA yang diperiksa 27 Oktober 2026. Live pull belum diuji; tombol sync dinonaktifkan sampai lengkap. Tidak mengambil password dari DBeaver.
2. WhatsApp otomatis pada aplikasi lama belum dihubungkan. Tidak ada pesan eksternal yang dikirim dari implementasi ini; popup/alarm lokal sudah tersedia.
3. Silent print QZ Tray dan pemilihan PDF sumber asli legacy tidak disalin. Dokumen dibuka melalui fasilitas cetak AVICENNA; tidak mengirim job ke printer saat pengujian.
4. Data lama dari database stagging-body tidak dimigrasikan. Staging SAP yang diperiksa tidak berisi seluruh jejak pulling/produksi legacy maupun Master Cycle PPIC.
5. Nama bisnis CHR_DEL_NO/DOK_NO/PDS_NO, arti qty dan jam SAP, flag status, gate resmi, serta jalur pickup truck masih perlu validasi pemilik proses/SAP. Integrasi menolak master customer/part/pabrik yang belum bisa dipetakan secara aman.

## Pengujian

`pnpm --filter @avicenna/api test:preparation`: PostgreSQL lokal, fixture di transaksi yang selalu di-rollback, SELECT-only staging mock, normalisasi cycle, jadwal SAP tidak menimpa PPIC, key ambigu, undo, shortage, lintas hari, tracing sebelum pulling, dan batas akses pabrik/role.

`pnpm --filter @avicenna/domain test`: termasuk pengujian murni aturan preparation.
