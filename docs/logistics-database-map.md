# Database Logistik AVICENNA dan staging SAP

Pemeriksaan 11 November 2026, berdasarkan kode lokal pada commit `fab478d`, metadata PostgreSQL dan SQL Server yang terhubung melalui `.env` workspace. Pemeriksaan menggunakan SELECT; tidak menjalankan sinkronisasi, penyalinan data, atau posting SAP.

## 1. Kondisi saat diperiksa

| Bagian | Hasil |
|---|---|
| Database aplikasi | PostgreSQL `avicenna` |
| Database staging | SQL Server `A_DB_STG`, tabel integrasi dalam schema `dbo` |
| Tabel inti dalam schema `logistics` | 17 tabel |
| Push ke staging | `STAGING_PUSH_ENABLED=false`; tidak ada override di `org.TM_SETTING` |
| Pull dari staging | `STAGING_PULL_ENABLED=false`; tidak ada override di `org.TM_SETTING` |
| Antrean lokal | `sap.TT_SAP_OUTBOX` kosong saat diperiksa; ini bukan bukti riwayat pengiriman pada deployment lain |
| Adapter tulis yang tersedia | `TRANSFER` dan `PRODUCTION`; produksi berada di luar cakupan utama dokumen ini |
| Delivery intercompany | Masih `HELD`; belum ada writer dan pembaca hasil khusus GI AIIA / GR AII / GI AII |
| Receiving | Dokumen dan stok lokal tersedia; adapter GR ke staging belum tersedia |

**Koreksi metadata lama:** pada pemeriksaan ini `A_DB_STG.dbo.TT_GOODS_MOVEMENT_H.CHR_PLANT_TO` dan keenam kolom `TT_GOODS_MOVEMENT_L.CHR_PGI_DOC/YEAR/STATUS`, `CHR_GR_DOC/YEAR/STATUS` sudah ada. Catatan 3–4 November tentang ketidaktersediaannya merupakan kondisi historis. Kehadiran kolom belum membuktikan siapa yang mengisinya dan kontrak sukses setiap tahap.

Database PostgreSQL dan SQL Server terpisah. Contoh: `avicenna.logistics.TT_DELIVERY_ITEM` adalah tabel operasional lokal; `A_DB_STG.dbo.TT_DELIVERY_ITEM` adalah sumber rencana dari SAP. Perubahan counter lokal tidak otomatis memperbarui tabel staging yang namanya sama.

## 2. Tabel inti Logistik di PostgreSQL

Nama tabel pada bagian ini berada dalam schema `logistics`.

| Tabel | Satu baris mewakili | Isi utama / fungsi |
|---|---|---|
| `TT_DELIVERY` | Satu loading list/delivery sumber per plant | Nomor delivery, manifest, PDS, customer, tanggal/cycle, status pulling/truk, lokasi asal/staging, referensi DO, salinan status SAP |
| `TT_DELIVERY_ITEM` | Satu item dalam loading list | Part, nomor item SAP, part customer, rencana pcs/kanban, isi box, jumlah pulling dan aktual |
| `TT_DELIVERY_ORDER` | Satu DO untuk customer + PDS | Nomor `SJA/YY/NNNNNN`, snapshot item, waktu persiapan/terbit/pickup/berangkat; nomor belum dialokasikan saat menunggu GI/GR |
| `TT_DO_COUNTER` | Satu tahun penomoran | Tahun dan nomor urut DO terakhir |
| `TT_DELIVERY_KANBAN` | Satu kartu terdaftar yang terkait pengiriman | Delivery, item, kartu, pemilik, qty, waktu pelepasan; dicatat saat keberangkatan dikonfirmasi |
| `TT_DELIVERY_SYNC` | Hasil refresh terakhir per tanggal operasional | Waktu refresh dan JSON hasil impor, termasuk dokumen yang dilewati |
| `TT_DELIVERY_DOCUMENT` | Satu PDF upload | Jenis dokumen, referensi PDS/manifest/loading list, nama file, storage key, hash, ukuran, pengunggah |
| `TM_PREPARATION_CYCLE` | Jadwal customer + destination + gate + cycle | Jam preparation/truk lokal dan jam pick/loading/delivery dari SAP yang disimpan terpisah |
| `TM_DRIVER_DESTINATION` | Master tujuan pickup per plant | Customer, kode/nama tujuan, dock, perusahaan logistik, aktif/tidak |
| `TT_DRIVER_ATTENDANCE` | Satu sesi pickup driver | Slot, tujuan/cycle, safety helmet/vest/shoes, referensi foto, waktu mulai/selesai, petugas |
| `TT_DRIVER_ATTENDANCE_DO` | Hubungan sesi pickup dengan DO | Satu sesi dapat memuat beberapa DO; satu DO hanya terhubung ke satu sesi |
| `TT_PIS_SESSION` | Konteks PIS per pengguna + plant | JSON state: pilihan dokumen, proses scan yang sedang berlangsung, interlock dan konteks operator |
| `TT_PIS_PACKING` | Total packing satu item delivery | `INT_PACKED_QTY`; terpisah dari counter pulling |
| `TT_PURCHASE_RECEIPT_H` | Satu dokumen/sesi receiving | Supplier, PDS/order sheet, dokumen supplier, lokasi, status, snapshot sumber, waktu tutup |
| `TT_PURCHASE_RECEIPT_L` | Satu detail receiving | Header receiving, part, lot, qty diterima dan UOM |
| `TT_GOODS_MOVEMENT_H` | Satu dokumen transfer lokal | Nomor transfer, plant, lokasi/line asal-tujuan, waktu, status, petugas |
| `TT_GOODS_MOVEMENT_L` | Satu detail transfer lokal | Header transfer, part, lot/serial, qty |

`Preparation Monitoring` dan `Mutation Delivery` menampilkan gabungan tabel delivery, item, jadwal, scan dan status terkait. Keduanya tidak mempunyai salinan lengkap loading list tersendiri.

PDF customer disimpan pada storage file; database menyimpan metadata dan `CHR_STORAGE_KEY`. Pola potong PDF berada di `kanban.TM_KANBAN_CROP_PROFILE`. Foto driver juga berupa file dengan referensi pada `CHR_PHOTO`. File ini tidak dikirim ke staging oleh adapter sekarang.

## 3. Tabel pendukung lintas schema

| Tabel | Peran dalam Logistik |
|---|---|
| `master.TM_CUST` | Master customer, format barcode/part dan pengaturan direct kanban |
| `master.TM_SHIPPING_PARTS` | Menghubungkan part internal dengan customer, nomor part/back number customer, qty per box |
| `master.TM_PARTS` | Part internal, back number, UOM, isi box, plant dan cara pelacakan serial/lot/quantity |
| `master.TM_VENDOR` | Master supplier untuk receiving |
| `master.TM_LINE` | Line asal/tujuan transfer |
| `org.TM_PLANT` | Plant lokal dan kode SAP `CHR_SAP_CODE` |
| `org.TM_USER`, `org.TM_DEVICE` | Identitas petugas dan scanner/RFID untuk otorisasi dan audit |
| `inventory.TM_LOCATION` | Lokasi gudang, FG, staging fisik dan lokasi lain; lokasi fisik MES tidak selalu merupakan SLOC SAP |
| `inventory.TT_LOT` | Batch/lot barang, supplier, jumlah awal dan status lot |
| `inventory.TT_STOCK_MUTATION` | Buku mutasi stok: qty positif masuk, qty negatif keluar, referensi dokumen, waktu dan petugas |
| `inventory.TT_STOCK_BALANCE` | Rekap saldo harian turunan dari mutasi, bukan tabel rencana delivery |
| `production.TT_HISTORY_SCAN` | Audit scan receiving/delivery/PIS, raw code, qty, user/device, waktu, dedupe key dan JSON konteks |
| `kanban.TM_KANBAN` | Master kartu: part, serial, pemilik INTERNAL/CUSTOMER, isi box, status, jumlah siklus |
| `kanban.TT_KANBAN_ITEM` | Unit yang saat ini menempel pada kartu terdaftar |
| `kanban.TT_KANBAN_EVENT` | Riwayat kejadian kartu; termasuk pelepasan kartu internal dan pengiriman kartu customer |
| `kanban.TM_KANBAN_CROP_PROFILE` | Garis potong horizontal/vertikal per customer; kolom ukuran/grid lama masih tersedia |
| `sap.TT_SAP_OUTBOX` | Antrean integrasi, payload, status, nomor request staging, hasil SAP dan flag simulasi |
| `org.TM_SETTING` | Override saklar push/pull staging |

Audit scan berada dalam schema `production` karena dipakai bersama beberapa modul. RFID tidak mempunyai tabel scan khusus; `CHR_META` menyimpan `method`, `rfidTagId`, `deliveryId`, `deliveryLineId` dan konteks lain. Kartu/barcode customer eksternal tidak selalu mempunyai baris di `TM_KANBAN` lokal.

Receiving saat ini masih membaca order sheet dari koneksi MySQL yang dikonfigurasi melalui `ARES_DATABASE_URL`: `TT_PICKLIST_H/L`, `TM_VENDOR_PARTS`, `TM_PARTS`, `TM_KANBAN`, `TM_VENDOR`, `TM_PLANT`. Hasil scan dan penerimaan disimpan di AVICENNA; pembaca sumber ini SELECT-only. Nama teknis tersebut masih ada di kode dan database, meskipun menu pengguna bernama Receiving.

## 4. Relasi dan counter penting

| Relasi | Kunci |
|---|---|
| Delivery ke item | `TT_DELIVERY.INT_ID` → `TT_DELIVERY_ITEM.INT_DELIVERY_ID` |
| Identitas delivery sumber | Unik lokal pada `INT_PLANT_ID + CHR_DEL_NO` |
| Identitas item sumber | Unik lokal pada `INT_DELIVERY_ID + CHR_DEL_ITEM`; part yang sama dapat muncul pada item SAP berbeda |
| Customer/PDS ke DO | Unik `TT_DELIVERY_ORDER.INT_CUSTOMER_ID + CHR_PDS_NO`; beberapa loading list dapat terhubung melalui `TT_DELIVERY.INT_DO_ID` |
| Receiving ke item | `TT_PURCHASE_RECEIPT_H.INT_ID` → `TT_PURCHASE_RECEIPT_L.INT_RECEIPT_ID` |
| Transfer ke item | `TT_GOODS_MOVEMENT_H.INT_ID` → `TT_GOODS_MOVEMENT_L.INT_TRANSFER_ID` |
| PIS ke item | `TT_PIS_PACKING.INT_DELIVERY_ITEM_ID` → `TT_DELIVERY_ITEM.INT_ID` |
| Pickup ke DO | `TT_DRIVER_ATTENDANCE_DO.INT_ATTENDANCE_ID` dan `INT_DO_ID` |
| Outbox ke dokumen | Referensi logis `CHR_SOURCE_TABLE + INT_SOURCE_ID + CHR_DOC_TYPE`, unik; bukan FK langsung ke banyak tabel |
| Audit scan ke delivery/item | Referensi dalam `TT_HISTORY_SCAN.CHR_META` JSON |

Kolom qty pada `logistics.TT_DELIVERY_ITEM`:

| Kolom | Arti dan penulis |
|---|---|
| `INT_TOTAL_QTY` | Rencana pcs hasil impor; memakai `INT_TOTAL_QTY` sumber, fallback `INT_DEL_QTY` bila rencana tidak positif |
| `INT_DEL_QTY` | Salinan qty delivery dari staging |
| `INT_QTY_PER_BOX` | Isi satu kanban/box; dari staging, fallback master lokal |
| `INT_PLANNED_KANBAN` | Target jumlah kanban, dihitung `ceil(rencana pcs / isi box)` |
| `INT_PICKED_KANBAN` | Jumlah kanban yang diterima scan pulling lokal |
| `INT_SCAN_QTY` | Qty pulling lokal; implementasi scan sekarang menghitung jumlah kanban × isi box |
| `INT_ACTUAL_KANBAN`, `INT_ACTUAL_DEL` | Dalam flow intercompany, diisi dari snapshot pulling saat GI AII dikonfirmasi dan barang dinyatakan berangkat |

Karena itu, jangan menganggap kesamaan nama `INT_SCAN_QTY` / `INT_ACTUAL_DEL` berarti counter ini sudah ditulis balik ke SQL Server. Writer tersebut belum ada. Jumlah pcs pecahan box juga belum dapat diasumsikan mengikuti isi aktual kartu; logika scan saat ini memakai `INT_QTY_PER_BOX`.

## 5. Data staging yang dibaca AVICENNA

Adapter baca sudah ada. Pada konfigurasi saat diperiksa, pull otomatis mati; beberapa endpoint mendukung refresh manual.

| Sumber `A_DB_STG.dbo` | Tujuan lokal | Kolom/data yang dipakai |
|---|---|---|
| `TT_DELIVERY` | `logistics.TT_DELIVERY` | `CHR_DEL_NO`, `CHR_DOK_NO`, `CHR_PDS_NO`, `CHR_CUS_NO`, `CHR_CUS_DEST`, `CHR_DEL_DATE`, `CHR_CYCLE`, PO, sales area, invoice, QC dan salinan flag SAP |
| `TT_DELIVERY_ITEM` | `logistics.TT_DELIVERY_ITEM` | JOIN `CHR_DEL_NO`; nomor item `CHR_DEL_ITEM`, part/part customer, `INT_TOTAL_QTY`, `INT_DEL_QTY`, `INT_QTY_PER_BOX`, tipe item, flag hapus |
| `TM_CUST` | `master.TM_CUST` | Kode/nama customer dan flag hapus; bukan seluruh atribut/alamat/sales area |
| `TM_SHIPPING_PARTS` | `master.TM_SHIPPING_PARTS` | Kode customer, material, nomor part customer |
| `TM_PARTS` + `TM_PROCESS_PARTS` | `master.TM_PARTS` | Material, nama, back number, UOM, isi box; plant diturunkan dari routing `TM_PROCESS_PARTS` |
| `TM_VENDOR` | `master.TM_VENDOR` | Kode/nama supplier dan flag hapus |
| `TM_DELIV_TIME` | `logistics.TM_PREPARATION_CYCLE` | Customer, destination, gate, cycle, `CHR_PICK_TIME`, `CHR_LOADING_TIME`, `CHR_DEL_TIME` |

Flag SAP pada delivery seperti `CHR_GI_DEL`, `CHR_SM_H_FLAG`, `CHR_SM_L_FLAG`, `CHR_FLAG_RECEIVE` disalin sebagai referensi. Flag ini belum menjadi pembaca hasil tiga tahap intercompany.

Hari operasional berubah pukul 06:00 WIB. Query importer memilih `CHR_DEL_DATE=YYYYMMDD` untuk hari operasional tersebut; belum merupakan filter timestamp 06:00–06:00 terhadap sumber. Jadwal SAP disimpan sebagai jam referensi terpisah dari batas waktu preparation PPIC.

Belum ada importer khusus `TM_CUST_FUNC` / `TT_EKANBAN_CUST` pada jalur ini. Konstanta `TT_PARTS_SLOC` ada di kode, tetapi belum ada pemakaian adapter tersebut untuk mengisi saldo Stock. Saldo operasional MES dihitung dari mutasi lokal.

## 6. Data yang dapat dikirim ke staging

**Tidak ada pengiriman otomatis aktif pada konfigurasi yang diperiksa.** Tabel di bawah membedakan kemampuan adapter dari pengiriman yang benar-benar terjadi. Outbox lokal sedang kosong.

| Aktivitas | Jenis outbox | Target staging | Kondisi implementasi |
|---|---|---|---|
| Transfer umum antar lokasi/line yang memenuhi aturan SLOC | `TRANSFER` | `TT_GOODS_MOVEMENT_H/L` | Writer dan pembaca balasan tersedia; membutuhkan push aktif, mapping dan preflight lulus |
| Finish Pulling | `DELIVERY_GI_AIIA` | Kandidat request `TT_GOODS_MOVEMENT_H/L` | Antrean lokal `HELD`; belum menulis staging |
| GR AII setelah GI AIIA | `DELIVERY_GR_AII` | Kontrak request intercompany belum selesai | Tahap lokal tersedia; writer belum ada |
| Selesai Pickup driver | `DELIVERY_GI_AII` | Kandidat request `TT_GOODS_MOVEMENT_H/L` | Tahap lokal tersedia; writer belum ada |
| Receiving | `GOODS_RECEIPT` | `TT_PURCHASE_RECEIPT_H/L` | Writer belum ada; receiving scan ditahan dari posting |
| Cancel receiving setelah terkirim | Belum ada jalur reversal SAP | Kontrak cancel receipt | Ditolak di aplikasi; belum membuat request reversal |
| Scan barcode/RFID per kartu | Audit/counter lokal | Tidak ada write per scan ke staging | Disimpan di PostgreSQL |
| Dokumen kembali dari customer | Status `RECEIVED` lokal dan audit | Belum ada writer receive flag | Belum UPDATE `CHR_FLAG_RECEIVE/DATE_RECEIVE/TIME_RECEIVE` di staging |
| PDF manifest, kanban customer, skid label; crop; PIS; foto/safety driver | Data/file operasional lokal | Tidak ada | Tidak dikirim oleh adapter sekarang |

Mutasi fisik Finish Pulling bersumber `TT_DELIVERY` dikecualikan dari pengumpul transfer umum. Dengan demikian, keberadaan writer `TRANSFER` tidak berarti proses delivery sudah dapat menggunakan jalur itu. Writer `PRODUCTION` ke `TT_PRODUCTION_RESULT` tersedia untuk modul produksi dan bukan pengganti GI/GR delivery.

### Kolom yang ditulis writer TRANSFER yang sudah ada

Daftar ini mengikuti nilai runtime di `dorongSatu()` dan daftar kolom INSERT; beberapa komentar pemetaan lama belum sama dengan perilaku runtime.

| Target | Kolom | Nilai / sumber aktual |
|---|---|---|
| H | `INT_NUMBER` | Identity diberikan SQL Server; disimpan kembali ke `sap.TT_SAP_OUTBOX.INT_STAGING_NUMBER` |
| H | `CHR_PLANT` | `org.TM_PLANT.CHR_SAP_CODE` |
| H | `CHR_DATE`, `CHR_DOCUMENT_DATE` | Tanggal kejadian dari payload/outbox, format `YYYYMMDD` |
| H | `CHR_MVMT_TYPE` | `sap.TT_SAP_OUTBOX.CHR_MOVEMENT_TYPE` |
| H | `CHR_TYPE_TRANS` | Hasil mapping `typeTransUntuk('TRANSFER')`, default `STRM`, dapat dioverride env |
| H | `CHR_REMARKS` | Referensi `AVI-{outboxId}` beserta asal dokumen; dipakai mencari request yang sudah pernah ditulis |
| H | `INT_NUMBER_PROD` | ID staging produksi terkait bila ada |
| H | `CHR_USER` | `AVICENNA` |
| H | `CHR_VALIDATE` | `X` |
| H | `CHR_DATE_ENTRY`, `CHR_TIME_ENTRY` | Waktu penulisan, format tanggal/jam terpisah |
| L | `INT_NUMBER` | ID header hasil INSERT |
| L | `INT_NUMBER_ITEM` | Identity diberikan SQL Server |
| L | `CHR_PART_NO` | Material dari payload mutasi |
| L | `CHR_PART_NAME`, `CHR_BACK_NO` | Saat ini ditulis `NULL` |
| L | `CHR_SLOC_FROM`, `CHR_SLOC_TO` | Kode lokasi asal/tujuan dari payload |
| L | `INT_TOTAL_QTY` | Qty absolut, dibulatkan dengan `Math.round`; pecahan qty perlu diperhatikan sebelum dipakai untuk material bersatuan desimal |
| L | `CHR_UOM` | UOM dari payload |
| L | `CHR_SER_NO` | Nomor lot dari payload, bila ada |
| L | `CHR_MVMT_TYPE_L` | Movement type item, fallback movement type header |
| L | `CHR_DATE_ENTRY`, `CHR_TIME_ENTRY` | Waktu penulisan |
| L | `CHR_STATUS`, `CHR_UPLOAD` | Nilai awal `N` dan `0` |

Writer transfer ini belum mengisi `CHR_DEL_NO`, `CHR_DEL_ITEM`, `CHR_PDS_NO`, `CHR_PLANT_TO` atau hasil `CHR_PGI_*` / `CHR_GR_*`. Itu bukan adapter delivery SD.

Pembaca balasan transfer mengambil `CHR_STATUS`, `CHR_MESSAGE`, `CHR_MATDOC`, `CHR_MATDOC_YEAR`. Hasil dipakai untuk mengubah status outbox, pesan error dan nomor dokumen. Seleksi pembaca balasan hanya mencakup `TRANSFER`/`PRODUCTION`, non-simulasi, berstatus `SENT`. `SENT` hanya berarti request sudah ditulis ke staging, belum berarti posting SAP berhasil.

Default transfer `STRM` tidak termasuk filter aktif pada paket VB SD dan GR/MM yang dibaca sebelumnya. Worker yang mengonsumsi transfer tersebut tetap perlu diverifikasi; tersedianya adapter tidak membuktikan proses SAP ujung ke ujung.

## 7. Urutan penyimpanan flow delivery saat ini

| Tahap | Tabel lokal yang berubah | Hubungan dengan SAP |
|---|---|---|
| Refresh rencana | `TT_DELIVERY`, `TT_DELIVERY_ITEM`, `TT_DELIVERY_SYNC` | SELECT dari staging; master harus dapat dipetakan |
| Scan barcode/RFID | `TT_HISTORY_SCAN`, `TT_DELIVERY_ITEM`, status `TT_DELIVERY` | Tidak menulis staging |
| Finish Pulling | Mutasi keluar FG/masuk staging fisik; delivery menjadi `PICKED` | Mutasi ini tidak dikirim sebagai transfer umum |
| Semua loading list customer/PDS selesai pulling | `TT_DELIVERY_ORDER` menyimpan snapshot, delivery diberi `INT_DO_ID`, outbox GI AIIA dibuat `HELD` | Writer SD belum ada |
| GI AIIA dikonfirmasi | Tahap GR AII dibuat di outbox | Konfirmasi nyata belum dibaca otomatis |
| GI AIIA dan GR AII dikonfirmasi dengan nomor SAP | `TT_DO_COUNTER` dan nomor/tanggal terbit `TT_DELIVERY_ORDER` | Flow lokal menunggu hasil kedua tahap |
| Mulai pickup | `TT_DRIVER_ATTENDANCE`, `TT_DRIVER_ATTENDANCE_DO`, status truk | Belum memicu GI AII |
| Selesai pickup | Waktu selesai absensi, waktu pickup DO, audit dan outbox GI AII | Request GI AII masih ditahan |
| GI AII dikonfirmasi | Mutasi `DELIVERY_OUT`, aktual item, delivery `SHIPPED`, truk `DEPARTED`, riwayat/pelepasan kartu | Membutuhkan konfirmasi; scan driver sendiri tidak menyatakan SAP berhasil |
| Dokumen kembali | Delivery `RECEIVED`, waktu kedatangan/penerimaan dan audit | Receive flag staging belum ditulis |

Antrean lokal memakai status `PENDING`, `HELD`, `SENT`, `CONFIRMED`, `REJECTED`, `FAILED`, `SKIPPED`. `FLG_SIMULATION` memisahkan trial dari transaksi nyata; writer mengabaikan simulasi.

## 8. Sumber kode

- [Schema delivery](../packages/db/src/schema/delivery.ts), [receiving/transfer/lot](../packages/db/src/schema/supply.ts), [stok](../packages/db/src/schema/inventory.ts).
- [Schema preparation](../packages/db/src/schema/preparation.ts), [PIS](../packages/db/src/schema/pis.ts), [driver](../packages/db/src/schema/driver-attendance.ts), [dokumen](../packages/db/src/schema/delivery-documents.ts), [crop](../packages/db/src/schema/kanban-crop.ts).
- [Importer staging](../apps/api/src/staging/staging-pull.service.ts), [writer dan pembaca balasan](../apps/api/src/staging/staging-push.service.ts), [nama kolom](../apps/api/src/staging/staging-tables.ts).
- [Flow delivery](../apps/api/src/loading/delivery-flow.ts), [snapshot DO](../apps/api/src/loading/delivery-order.ts), [scan/pulling](../apps/api/src/loading/loading.service.ts), [absensi](../apps/api/src/loading/driver-attendance.service.ts).
- [Pengumpul outbox](../apps/api/src/sap/sap-outbox.service.ts), [worker](../apps/api/src/sap/sap.worker.ts), [sumber receiving](../packages/db/src/ares-source.ts).

## 9. Kamus kolom hasil pemeriksaan live

Lampiran berikut berisi seluruh kolom tabel inti Logistik dan tabel pendukung yang dipilih. Metadata ini tidak memuat isi baris bisnis, password, atau connection string. Constraint yang ditampilkan adalah constraint database; indeks unik tambahan didefinisikan juga dalam schema kode. `INT_*` dapat bertipe bigint atau integer, dan tidak semua relasi logis memakai FK database.

### logistics.TT_DELIVERY_ORDER

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `CHR_DO_NO` | character varying(64) | Ya |  |
| `INT_YEAR` | integer | Ya |  |
| `INT_SERIAL` | integer | Ya |  |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_PDS_NO` | character varying(64) | Tidak |  |
| `CHR_SNAPSHOT` | jsonb | Tidak |  |
| `DTM_ISSUED_AT` | timestamp with time zone | Ya |  |
| `INT_ISSUED_BY_ID` | bigint | Ya |  |
| `FLG_INTERCOMPANY` | boolean | Tidak |  |
| `DTM_PREPARED_AT` | timestamp with time zone | Tidak |  |
| `DTM_DRIVER_SCANNED_AT` | timestamp with time zone | Ya |  |
| `INT_DRIVER_SCANNED_BY_ID` | bigint | Ya |  |
| `DTM_SHIPPED_AT` | timestamp with time zone | Ya |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `FOREIGN KEY ("INT_DRIVER_SCANNED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `FOREIGN KEY ("INT_ISSUED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DO_COUNTER

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_YEAR` | integer | Tidak |  |
| `INT_LAST_SERIAL` | integer | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_YEAR")`

### logistics.TT_DELIVERY

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_DEL_NO` | character varying(64) | Tidak |  |
| `CHR_DOK_NO` | character varying(64) | Ya |  |
| `CHR_PDS_NO` | character varying(64) | Ya |  |
| `CHR_PO_NO` | character varying(64) | Ya |  |
| `CHR_SORG` | character varying(16) | Ya |  |
| `CHR_DIS_CHANNEL` | character varying(16) | Ya |  |
| `CHR_DIVISION` | character varying(16) | Ya |  |
| `CHR_DEL_TYPE` | character varying(16) | Ya |  |
| `CHR_GI_DEL` | character varying(16) | Ya |  |
| `CHR_INV_NO` | character varying(64) | Ya |  |
| `CHR_QC_STATUS` | character varying(16) | Ya |  |
| `DTM_DEL_DATE_ACT` | date | Ya |  |
| `CHR_SM_H_FLAG` | character varying(16) | Ya |  |
| `CHR_SM_L_FLAG` | character varying(16) | Ya |  |
| `CHR_FLAG_RECEIVE` | character varying(16) | Ya |  |
| `DTM_DATE_RECEIVE` | date | Ya |  |
| `DTM_TIME_RECEIVE` | time without time zone | Ya |  |
| `DTM_DEL_DATE` | date | Tidak |  |
| `INT_CYCLE` | integer | Tidak |  |
| `CHR_CUS_DEST` | character varying(32) | Ya |  |
| `DTM_PLAN_TIME` | time without time zone | Ya |  |
| `DTM_DEPARTED_AT` | timestamp with time zone | Ya |  |
| `DTM_ARRIVED_AT` | timestamp with time zone | Ya |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `INT_LOCATION_ID` | bigint | Ya |  |
| `INT_STAGING_LOCATION_ID` | bigint | Ya |  |
| `CHR_TRUCK_NUMBER` | character varying(32) | Ya |  |
| `CHR_DRIVER_NAME` | character varying(128) | Ya |  |
| `CHR_TRUCK_STATUS` | character varying(32) | Tidak |  |
| `DTM_TRUCK_PICKED_AT` | timestamp with time zone | Ya |  |
| `INT_TRUCK_PICKED_BY_ID` | bigint | Ya |  |
| `INT_CREATED_BY_ID` | bigint | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |
| `INT_DO_ID` | bigint | Ya |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CREATED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `FOREIGN KEY ("INT_DO_ID") REFERENCES logistics."TT_DELIVERY_ORDER"("INT_ID")`
- `FOREIGN KEY ("INT_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_TRUCK_PICKED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DELIVERY_ITEM

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_DELIVERY_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_CUSTOMER_PART_ID` | bigint | Ya |  |
| `CHR_CUST_PART_NO` | character varying(64) | Ya |  |
| `CHR_DEL_ITEM` | character varying(16) | Ya |  |
| `INT_DEL_QTY` | integer | Tidak |  |
| `CHR_ITEM_TYPE` | character varying(16) | Ya |  |
| `INT_PLANNED_KANBAN` | integer | Tidak |  |
| `INT_TOTAL_QTY` | integer | Tidak |  |
| `INT_QTY_PER_BOX` | integer | Tidak |  |
| `INT_PICKED_KANBAN` | integer | Tidak |  |
| `INT_SCAN_QTY` | integer | Tidak |  |
| `INT_ACTUAL_KANBAN` | integer | Tidak |  |
| `INT_ACTUAL_DEL` | integer | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_DELIVERY_ID") REFERENCES logistics."TT_DELIVERY"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DELIVERY_KANBAN

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_DELIVERY_ID` | bigint | Tidak |  |
| `INT_DEL_ITEM_ID` | bigint | Ya |  |
| `INT_KANBAN_ID` | bigint | Tidak |  |
| `CHR_OWNER` | character varying(32) | Tidak |  |
| `INT_QTY` | integer | Tidak |  |
| `DTM_RELEASED_AT` | timestamp with time zone | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_DELIVERY_ID") REFERENCES logistics."TT_DELIVERY"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_DEL_ITEM_ID") REFERENCES logistics."TT_DELIVERY_ITEM"("INT_ID")`
- `FOREIGN KEY ("INT_KANBAN_ID") REFERENCES kanban."TM_KANBAN"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DELIVERY_SYNC

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `DTM_OPERATIONAL_DATE` | date | Tidak |  |
| `DTM_SYNCED_AT` | timestamp with time zone | Tidak |  |
| `CHR_RESULT` | jsonb | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DELIVERY_DOCUMENT

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_REFERENCE_TYPE` | character varying(32) | Tidak |  |
| `CHR_REFERENCE_NO` | character varying(64) | Tidak |  |
| `CHR_KIND` | character varying(32) | Tidak |  |
| `CHR_FILENAME` | character varying(255) | Tidak |  |
| `CHR_STORAGE_KEY` | character varying(64) | Tidak |  |
| `CHR_SHA256` | character varying(64) | Tidak |  |
| `INT_BYTE_SIZE` | integer | Tidak |  |
| `INT_UPLOADED_BY_ID` | bigint | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_UPLOADED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TM_DRIVER_DESTINATION

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_CODE` | character varying(32) | Tidak |  |
| `CHR_NAME` | character varying(128) | Tidak |  |
| `CHR_DOCK` | character varying(32) | Tidak |  |
| `CHR_LOGISTIC` | character varying(128) | Tidak |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DRIVER_ATTENDANCE

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_SLOT` | integer | Tidak |  |
| `INT_DESTINATION_ID` | bigint | Tidak |  |
| `CHR_DESTINATION_NAME` | character varying(128) | Tidak |  |
| `CHR_DOCK` | character varying(32) | Tidak |  |
| `CHR_LOGISTIC` | character varying(128) | Tidak |  |
| `INT_CYCLE` | integer | Tidak |  |
| `FLG_HELMET` | boolean | Tidak |  |
| `FLG_VEST` | boolean | Tidak |  |
| `FLG_SHOES` | boolean | Tidak |  |
| `CHR_PHOTO` | character varying(64) | Tidak |  |
| `DTM_STARTED_AT` | timestamp with time zone | Tidak |  |
| `DTM_ENDED_AT` | timestamp with time zone | Ya |  |
| `INT_STARTED_BY_ID` | bigint | Ya |  |
| `INT_ENDED_BY_ID` | bigint | Ya |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_DESTINATION_ID") REFERENCES logistics."TM_DRIVER_DESTINATION"("INT_ID")`
- `FOREIGN KEY ("INT_ENDED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_STARTED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_DRIVER_ATTENDANCE_DO

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_ATTENDANCE_ID` | bigint | Tidak |  |
| `INT_DO_ID` | bigint | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_ATTENDANCE_ID") REFERENCES logistics."TT_DRIVER_ATTENDANCE"("INT_ID")`
- `FOREIGN KEY ("INT_DO_ID") REFERENCES logistics."TT_DELIVERY_ORDER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TM_PREPARATION_CYCLE

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_DEST_NO` | character varying(32) | Tidak |  |
| `CHR_GATE_NO` | character varying(32) | Tidak |  |
| `INT_CYCLE` | integer | Tidak |  |
| `DTM_PREP_START` | time without time zone | Ya |  |
| `DTM_PREP_END` | time without time zone | Ya |  |
| `INT_DAY_OFFSET` | integer | Tidak |  |
| `DTM_TRUCK_TIME` | time without time zone | Ya |  |
| `DTM_SAP_PICK_TIME` | time without time zone | Ya |  |
| `DTM_SAP_LOADING_TIME` | time without time zone | Ya |  |
| `DTM_SAP_DELIVERY_TIME` | time without time zone | Ya |  |
| `DTM_SYNCED_AT` | timestamp with time zone | Ya |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_PIS_SESSION

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_USER_ID` | bigint | Tidak |  |
| `CHR_STATE` | jsonb | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_USER_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_PIS_PACKING

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_DELIVERY_ITEM_ID` | bigint | Tidak |  |
| `INT_PACKED_QTY` | integer | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_DELIVERY_ITEM_ID") REFERENCES logistics."TT_DELIVERY_ITEM"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### inventory.TM_LOCATION

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `CHR_CODE` | character varying(32) | Tidak |  |
| `CHR_NAME` | character varying(128) | Tidak |  |
| `CHR_KIND` | character varying(32) | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### inventory.TT_STOCK_MUTATION

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_LOCATION_ID` | bigint | Ya |  |
| `INT_LINE_ID` | bigint | Ya |  |
| `INT_LOT_ID` | bigint | Ya |  |
| `CHR_TYPE` | character varying(32) | Tidak |  |
| `FLT_QTY` | numeric(14,4) | Tidak |  |
| `CHR_SOURCE_TABLE` | character varying(64) | Ya |  |
| `INT_SOURCE_ID` | bigint | Ya |  |
| `CHR_NPK` | character varying(32) | Ya |  |
| `INT_USER_ID` | bigint | Ya |  |
| `DTM_OCCURRED_AT` | timestamp with time zone | Tidak |  |
| `CHR_NOTE` | character varying(255) | Ya |  |
| `CHR_META` | jsonb | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_USER_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### inventory.TT_STOCK_BALANCE

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_LOCATION_ID` | bigint | Ya |  |
| `DTM_BALANCE_DATE` | date | Tidak |  |
| `FLT_OPENING_QTY` | numeric(14,4) | Tidak |  |
| `FLT_IN_QTY` | numeric(14,4) | Tidak |  |
| `FLT_OUT_QTY` | numeric(14,4) | Tidak |  |
| `FLT_CLOSING_QTY` | numeric(14,4) | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### inventory.TT_LOT

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `CHR_BATCH_NO` | character varying(64) | Tidak |  |
| `CHR_SUPPLIER_LOT_NUMBER` | character varying(64) | Ya |  |
| `INT_SUPPLIER_ID` | bigint | Ya |  |
| `DTM_RECEIVED_AT` | timestamp with time zone | Ya |  |
| `DTM_EXPIRES_AT` | date | Ya |  |
| `FLT_INITIAL_QTY` | numeric(14,4) | Tidak |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_SUPPLIER_ID") REFERENCES master."TM_VENDOR"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_PURCHASE_RECEIPT_H

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_SUPPLIER_ID` | bigint | Tidak |  |
| `CHR_PDS_NO` | character varying(64) | Tidak |  |
| `CHR_SUPPLIER_DOC_NUMBER` | character varying(64) | Ya |  |
| `DTM_RECEIVED_AT` | timestamp with time zone | Tidak |  |
| `INT_LOCATION_ID` | bigint | Ya |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `INT_RECEIVED_BY_ID` | bigint | Ya |  |
| `CHR_NOTE` | character varying(255) | Ya |  |
| `INT_ARES_ORDER_ID` | bigint | Ya |  |
| `CHR_SOURCE_SNAPSHOT` | jsonb | Ya |  |
| `DTM_CLOSED_AT` | timestamp with time zone | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_RECEIVED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `FOREIGN KEY ("INT_SUPPLIER_ID") REFERENCES master."TM_VENDOR"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_PURCHASE_RECEIPT_L

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_RECEIPT_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_LOT_ID` | bigint | Ya |  |
| `FLT_RECQTY` | numeric(14,4) | Tidak |  |
| `CHR_UOM` | character varying(16) | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_LOT_ID") REFERENCES inventory."TT_LOT"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_RECEIPT_ID") REFERENCES logistics."TT_PURCHASE_RECEIPT_H"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_GOODS_MOVEMENT_H

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `CHR_NUMBER` | character varying(64) | Tidak |  |
| `INT_FROM_LOCATION_ID` | bigint | Ya |  |
| `INT_TO_LOCATION_ID` | bigint | Ya |  |
| `INT_FROM_LINE_ID` | bigint | Ya |  |
| `INT_TO_LINE_ID` | bigint | Ya |  |
| `DTM_MOVED_AT` | timestamp with time zone | Tidak |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `INT_USER_ID` | bigint | Ya |  |
| `CHR_NOTE` | character varying(255) | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_FROM_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_FROM_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_TO_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_TO_LOCATION_ID") REFERENCES inventory."TM_LOCATION"("INT_ID")`
- `FOREIGN KEY ("INT_USER_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### logistics.TT_GOODS_MOVEMENT_L

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_TRANSFER_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_LOT_ID` | bigint | Ya |  |
| `CHR_SERIAL_NUMBER` | character varying(64) | Ya |  |
| `FLT_TOTAL_QTY` | numeric(14,4) | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_LOT_ID") REFERENCES inventory."TT_LOT"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_TRANSFER_ID") REFERENCES logistics."TT_GOODS_MOVEMENT_H"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### kanban.TM_KANBAN

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_KANBAN_NO` | integer | Ya |  |
| `CHR_KANBAN_TYPE` | character varying(32) | Tidak |  |
| `CHR_OWNER` | character varying(32) | Tidak |  |
| `CHR_SERIAL_NUMBER` | character varying(64) | Tidak |  |
| `INT_QTY_PER_BOX` | integer | Tidak |  |
| `INT_UNIT_PER_KANBAN` | integer | Tidak |  |
| `CHR_SIDE` | character varying(8) | Ya |  |
| `CHR_BOX_TYPE` | character varying(8) | Ya |  |
| `INT_CUSTOMER_ID` | bigint | Ya |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `DTM_PRODUCED_AT` | timestamp with time zone | Ya |  |
| `DTM_DELIVERED_AT` | timestamp with time zone | Ya |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |
| `INT_CYCLE_COUNT` | integer | Tidak |  |
| `DTM_RELEASED_AT` | timestamp with time zone | Ya |  |
| `CHR_PRODUCTION_VERSION` | character varying(8) | Ya |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### kanban.TT_KANBAN_ITEM

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_KANBAN_ID` | bigint | Tidak |  |
| `CHR_SERIAL_NUMBER` | character varying(64) | Tidak |  |
| `INT_SCAN_EVENT_ID` | bigint | Ya |  |
| `DTM_ATTACHED_AT` | timestamp with time zone | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_KANBAN_ID") REFERENCES kanban."TM_KANBAN"("INT_ID") ON DELETE CASCADE`
- `PRIMARY KEY ("INT_ID")`

### kanban.TT_KANBAN_EVENT

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_KANBAN_ID` | bigint | Tidak |  |
| `CHR_TYPE` | character varying(32) | Tidak |  |
| `INT_LINE_ID` | bigint | Ya |  |
| `INT_PAIRED_KANBAN_ID` | bigint | Ya |  |
| `INT_QTY` | integer | Ya |  |
| `INT_USER_ID` | bigint | Ya |  |
| `INT_DEVICE_ID` | bigint | Ya |  |
| `DTM_OCCURRED_AT` | timestamp with time zone | Tidak |  |
| `CHR_META` | jsonb | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_DEVICE_ID") REFERENCES org."TM_DEVICE"("INT_ID")`
- `FOREIGN KEY ("INT_KANBAN_ID") REFERENCES kanban."TM_KANBAN"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_USER_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### kanban.TM_KANBAN_CROP_PROFILE

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `INT_WIDTH_TENTHS` | integer | Tidak |  |
| `INT_HEIGHT_TENTHS` | integer | Tidak |  |
| `INT_OFFSET_X_TENTHS` | integer | Tidak |  |
| `INT_OFFSET_Y_TENTHS` | integer | Tidak |  |
| `INT_GAP_X_TENTHS` | integer | Tidak |  |
| `INT_GAP_Y_TENTHS` | integer | Tidak |  |
| `INT_COLUMNS` | integer | Tidak |  |
| `INT_ROWS` | integer | Tidak |  |
| `JSON_HORIZONTAL_LINES` | jsonb | Ya |  |
| `JSON_VERTICAL_LINES` | jsonb | Ya |  |
| `INT_UPDATED_BY_ID` | bigint | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_UPDATED_BY_ID") REFERENCES org."TM_USER"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### master.TM_LINE

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `CHR_CODE` | character varying(32) | Tidak |  |
| `CHR_NAME` | character varying(128) | Tidak |  |
| `CHR_PROCESS_TYPE` | character varying(32) | Tidak |  |
| `CHR_SCAN_MODE` | character varying(32) | Ya |  |
| `INT_INPUT_LOCATION_ID` | bigint | Ya |  |
| `INT_OUTPUT_LOCATION_ID` | bigint | Ya |  |
| `INT_SORT_ORDER` | integer | Tidak |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("CHR_PROCESS_TYPE") REFERENCES master."TM_PROCESS_TYPE"("CHR_CODE")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### master.TM_CUST

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `CHR_CUST_NO` | character varying(32) | Tidak |  |
| `CHR_CUST_NAME` | character varying(128) | Tidak |  |
| `CHR_DOCK` | character varying(32) | Ya |  |
| `CHR_PART_NUMBER_FORMAT` | character varying(32) | Tidak |  |
| `FLG_DIRECT_KANBAN` | boolean | Tidak |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_ID")`

### master.TM_VENDOR

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `CHR_SUPPLIER_ID` | character varying(32) | Tidak |  |
| `CHR_SUPPLIER_NAME` | character varying(128) | Tidak |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_ID")`

### master.TM_PARTS

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `INT_LINE_ID` | bigint | Ya |  |
| `CHR_PART_NO` | character varying(64) | Tidak |  |
| `CHR_BACK_NO` | character varying(64) | Ya |  |
| `CHR_PROJECT` | character varying(32) | Ya |  |
| `CHR_PART_NAME` | character varying(191) | Tidak |  |
| `CHR_PROCESS_TYPE` | character varying(32) | Tidak |  |
| `CHR_PART_TYPE` | character varying(32) | Tidak |  |
| `CHR_SOURCE_TYPE` | character varying(32) | Tidak |  |
| `CHR_TRACKING_MODE` | character varying(32) | Tidak |  |
| `CHR_PART_UOM` | character varying(16) | Tidak |  |
| `INT_QTY_PER_BOX` | integer | Ya |  |
| `INT_STANDARD_STOCK` | integer | Tidak |  |
| `CHR_PHOTO_PATH` | character varying(255) | Ya |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |
| `CHR_PRODUCTION_VERSION` | character varying(8) | Ya |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("CHR_PROCESS_TYPE") REFERENCES master."TM_PROCESS_TYPE"("CHR_CODE")`
- `FOREIGN KEY ("INT_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### master.TM_SHIPPING_PARTS

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PART_ID` | bigint | Tidak |  |
| `INT_CUSTOMER_ID` | bigint | Tidak |  |
| `CHR_CUS_PART_NO` | character varying(64) | Tidak |  |
| `CHR_CUS_BACK_NO` | character varying(64) | Ya |  |
| `INT_QTY_PER_BOX` | integer | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_CUSTOMER_ID") REFERENCES master."TM_CUST"("INT_ID") ON DELETE CASCADE`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID") ON DELETE CASCADE`
- `PRIMARY KEY ("INT_ID")`

### org.TM_PLANT

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `CHR_CODE` | character varying(32) | Tidak |  |
| `CHR_NAME` | character varying(128) | Tidak |  |
| `CHR_SAP_CODE` | character varying(4) | Ya |  |
| `FLG_SCAN_DIRECT_KANBAN` | boolean | Tidak |  |
| `FLG_IS_ACTIVE` | boolean | Tidak |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_ID")`

### org.TM_SETTING

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `CHR_KEY` | character varying(64) | Tidak |  |
| `CHR_VALUE` | character varying(191) | Tidak |  |
| `CHR_UPDATED_BY` | character varying(64) | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `PRIMARY KEY ("INT_ID")`

### production.TT_HISTORY_SCAN

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `CHR_KIND` | character varying(32) | Tidak |  |
| `CHR_PROCESS_TYPE` | character varying(32) | Ya |  |
| `INT_LINE_ID` | bigint | Ya |  |
| `INT_PART_ID` | bigint | Ya |  |
| `INT_MACHINE_ID` | bigint | Ya |  |
| `INT_PRODUCTION_PLAN_ID` | bigint | Ya |  |
| `CHR_RAW_CODE` | character varying(255) | Tidak |  |
| `CHR_SERIAL_NUMBER` | character varying(64) | Ya |  |
| `INT_QTY` | integer | Tidak |  |
| `INT_USER_ID` | bigint | Ya |  |
| `INT_DEVICE_ID` | bigint | Ya |  |
| `DTM_SCANNED_AT` | timestamp with time zone | Tidak |  |
| `CHR_DEDUPE_KEY` | character varying(128) | Tidak |  |
| `CHR_META` | jsonb | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("CHR_PROCESS_TYPE") REFERENCES master."TM_PROCESS_TYPE"("CHR_CODE")`
- `FOREIGN KEY ("INT_DEVICE_ID") REFERENCES org."TM_DEVICE"("INT_ID")`
- `FOREIGN KEY ("INT_LINE_ID") REFERENCES master."TM_LINE"("INT_ID")`
- `FOREIGN KEY ("INT_MACHINE_ID") REFERENCES master."TM_MACHINE"("INT_ID")`
- `FOREIGN KEY ("INT_PART_ID") REFERENCES master."TM_PARTS"("INT_ID")`
- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `FOREIGN KEY ("INT_USER_ID") REFERENCES org."TM_USER"("INT_ID")`
- `FOREIGN KEY ("INT_PRODUCTION_PLAN_ID") REFERENCES production."TT_PRODUCTION_PLAN"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`

### sap.TT_SAP_OUTBOX

| Kolom | Tipe | Boleh NULL | Identity |
|---|---|---|---|
| `INT_ID` | bigint | Tidak | Ya |
| `INT_PLANT_ID` | bigint | Tidak |  |
| `CHR_SOURCE_TABLE` | character varying(64) | Tidak |  |
| `INT_SOURCE_ID` | bigint | Tidak |  |
| `CHR_DOC_TYPE` | character varying(32) | Tidak |  |
| `CHR_MOVEMENT_TYPE` | character varying(8) | Ya |  |
| `CHR_IDEMPOTENCY_KEY` | character varying(128) | Tidak |  |
| `CHR_PAYLOAD` | jsonb | Tidak |  |
| `CHR_STATUS` | character varying(32) | Tidak |  |
| `FLG_SIMULATION` | boolean | Tidak |  |
| `INT_ATTEMPTS` | integer | Tidak |  |
| `CHR_LAST_ERROR` | character varying(1000) | Ya |  |
| `CHR_SAP_DOC_NUMBER` | character varying(32) | Ya |  |
| `INT_STAGING_NUMBER` | bigint | Ya |  |
| `DTM_OCCURRED_AT` | timestamp with time zone | Tidak |  |
| `DTM_SENT_AT` | timestamp with time zone | Ya |  |
| `DTM_CONFIRMED_AT` | timestamp with time zone | Ya |  |
| `DTM_CREATED_AT` | timestamp with time zone | Tidak |  |
| `DTM_UPDATED_AT` | timestamp with time zone | Tidak |  |

Kunci dan FK yang terpasang:

- `FOREIGN KEY ("INT_PLANT_ID") REFERENCES org."TM_PLANT"("INT_ID")`
- `PRIMARY KEY ("INT_ID")`
