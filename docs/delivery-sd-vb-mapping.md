# Pemetaan staging SD untuk Delivery AVICENNA

Analisis 2 November 2026, khusus delivery customer, pulling, preparation, DO, dan absensi driver. Tidak mencakup receiving supplier, produksi, atau stock movement umum. Tidak menjalankan program VB, mengubah staging, maupun mem-posting SAP.

## Informasi tambahan dari pengguna, 16 November 2026

Sumber: screenshot percakapan yang diberikan pengguna. Pengguna menegaskan tiga kolom berikut sebagai pemicu utama request delivery. Nilainya sudah dicocokkan dengan seleksi dan percabangan worker VB, lalu diterapkan pada writer Finish Pulling. Belum dilakukan posting ke staging nyata dalam pekerjaan ini.

| Kolom | Nilai dari pengguna | Peran dalam worker VB |
|---|---|---|
| `TT_GOODS_MOVEMENT_H.CHR_TYPE_TRANS` | `NODL` | Termasuk tipe yang dipilih worker, lalu diarahkan ke RFC `ZZBAPI_AIIECC_SD00004`. |
| `TT_GOODS_MOVEMENT_H.CHR_VALIDATE` | `X` | Syarat header agar request dipilih worker. |
| `TT_GOODS_MOVEMENT_L.CHR_UPLOAD` | `0` | Syarat item agar dipilih worker. Bukan penanda posting SAP sudah berhasil. |

Ketiganya sesuai filter aktif VB pada baris 96; header dan item dijoin melalui `INT_NUMBER`. Jalur `NODL` terlihat pada baris 190–215. Data transaksi seperti material, jumlah, plant, SLOC, nomor delivery dan item tetap dibaca serta diteruskan ke RFC. Konfirmasi pemicu ini belum menjelaskan apakah satu pemanggilan menjalankan GI AIIA sekaligus GR AII; isi RFC tidak tersedia dalam sumber VB.

Informasi pendukung dari screenshot sebelumnya tetap dicatat berikut, tanpa mengubah master plant:

| Kolom | Informasi yang diterima | Batas kepastian |
|---|---|---|
| `H.CHR_MVMT_TYPE` | `601` | Dipakai request Finish Pulling; tidak diterapkan ke GR AII atau Selesai Pickup. |
| `H.CHR_PLANT` | Mengikuti FG pulling: BODY `700`, UNIT `800`, ELC `900` | Mapping konteks pulling; tidak mengubah kode plant global untuk proses produksi/receiving/transfer. |
| `L.CHR_SLOC_TO` | Screenshot menuliskan `"null"` | Implementasi memakai SQL NULL sebagai nilai kosong, bukan teks literal `null`. Ini interpretasi teknis yang perlu disesuaikan jika kontrak SAP menyatakan lain. |

`CHR_TYPE_TRANS=NODL`, `CHR_VALIDATE=X`, dan `CHR_UPLOAD=0` sudah menjadi acuan request Finish Pulling. `CHR_SLOC_FROM` diambil dari lokasi FG asal yang dipilih saat pulling. Kontrak hasil GI/GR serta tabel GI lanjutan belum tersedia. Pengguna menyatakan aturan Selesai Pickup akan diberikan kemudian.

Metadata terakhir yang diverifikasi adalah pemeriksaan 11 November: `CHR_PLANT_TO` dan keenam kolom `CHR_PGI_*` / `CHR_GR_*` sudah tersedia di `A_DB_STG`. Bagian pemeriksaan 3 November di bawah merupakan catatan historis. Rincian struktur terbaru: [database Logistik](logistics-database-map.md).

## Antrean setelah Finish Pulling, 16 November 2026

Pengguna mengonfirmasi bahwa aturan berikut berlaku **hanya untuk Finish Pulling**. Aturan Selesai Pickup akan diberikan kemudian.

1. Request Finish Pulling ditulis ke `TT_GOODS_MOVEMENT_H/L`, dengan `NODL`, validasi `X`, dan upload awal `0`.
2. Job membaca `TT_GOODS_MOVEMENT_L.CHR_UPLOAD` milik request tersebut. Seluruh item harus bernilai `X` sebelum boleh diteruskan ke tabel GI. AVICENNA tidak mengubah `0` menjadi `X` sendiri.
3. Setelah syarat terpenuhi, tulis request ke tabel GI. Tabel serta mapping kolom GI belum tersedia, sehingga penulisan ini belum diimplementasikan.

**Yang sudah ditambahkan ke kode:** Finish Pulling membuat antrean lokal `sap.TT_SAP_OUTBOX` berjenis `FINISH_PULLING_GI` dalam transaksi yang sama dengan antrean tahap awal. `CHR_SOURCE_TABLE=TT_SAP_OUTBOX` dan `INT_SOURCE_ID` menunjuk ID outbox Goods Movement, bukan nomor staging. Kunci unik `finish-pulling-gi:{outboxId}` mencegah antrean ganda. Job `check-finish-pulling-gi` dijadwalkan setiap menit melalui BullMQ yang sudah ada; job juga melengkapi antrean untuk request lama yang masih menunggu. Tidak ada migrasi tabel baru.

| State dalam `CHR_PAYLOAD` antrean GI | Kondisi |
|---|---|
| `WAITING_GOODS_MOVEMENT` | Request asal belum `SENT` dengan `INT_STAGING_NUMBER`, atau asal tidak valid/simulasi. |
| `WAITING_UPLOAD` | Data staging belum lengkap/cocok, ada item bukan `X`, atau pembacaan staging gagal. Alasan tersedia di `CHR_LAST_ERROR`. |
| `WAITING_GI_TABLE` | Semua item request cocok dan upload `X`; masih ditahan karena tabel/mapping GI belum tersedia. |

Pengecekan menggunakan **`INT_STAGING_NUMBER` dari outbox asal → `H.INT_NUMBER=L.INT_NUMBER`**, bukan PDS saja atau ID outbox lokal. Jumlah item, material dan qty dibandingkan dengan snapshot Finish Pulling. Item hilang, tambahan, identitas duplikat, header bukan `NODL/X`, nilai kosong maupun `0` menahan proses. Percobaan ulang membaca kondisi staging terbaru dan tidak menghabiskan attempts pengiriman. Simulasi serta request GR AII/GI AII tidak membuat antrean ini.

Antrean GI tetap berstatus `HELD` selama writer GI belum tersedia. `X` tidak mengubah tahap GI/GR menjadi `CONFIRMED`, tidak menerbitkan nomor DO, dan tidak melepas stok. Writer GI nantinya harus memeriksa ulang seluruh item `X` saat akan menulis, menggunakan referensi request yang sama, dan mencegah insert ulang saat retry.

**Writer Goods Movement:** snapshot menyimpan `sapDeliveryNumber`, `sapItemNumber`, `fgPlantCode`, `fgLocationCode`, dan `fgLocationKind` per item. Request Finish Pulling baru yang lengkap masuk `PENDING`. Worker push menulis header dan seluruh item dalam satu transaksi SQL Server, memakai `sp_getapplock` per request dan referensi `CHR_REMARKS=AVI-FP-{outboxId}`. Retry sesudah commit remote memverifikasi lalu memakai header/item yang sama; tidak mengulang insert atau mereset upload. Setelah commit, `INT_NUMBER` dan daftar `INT_NUMBER_ITEM` dicatat pada outbox lokal. Pemeriksa upload memastikan identitas item tetap sesuai hasil insert.

Writer memakai `601`, plant BODY `700` / UNIT `800` / ELC `900`, dan SQL NULL untuk SLOC tujuan. Tidak ada pembulatan qty atau pemotongan nomor identitas. Snapshot tidak lengkap, nomor melebihi lebar staging, item SAP duplikat, serta PDS lintas plant ditahan dengan alasan yang terlihat. Request lama yang sudah `HELD` tidak dilepas otomatis menggunakan master yang mungkin sudah berubah.

**Batas implementasi:** writer Goods Movement, job pengecekan, dan antrean lokal GI sudah ada. Saklar `STAGING_PUSH_ENABLED` tetap mengikuti konfigurasi sebelumnya; pekerjaan ini tidak mengaktifkannya atau menulis transaksi SAP nyata. Tabel/mapping GI beserta pembacaan hasilnya masih perlu disambungkan sebelum GI/GR dan penerbitan DO dapat berjalan penuh. Aturan Selesai Pickup tidak diubah. Pengujian memakai adapter SQL mock dan fixture PostgreSQL yang di-rollback.

## Kesimpulan

- **Sumber rencana:** staging SQL Server `dbo.TT_DELIVERY` dan `dbo.TT_DELIVERY_ITEM`. AVICENNA menyalin rencana ke PostgreSQL lokal.
- **Tujuan request yang dikonsumsi worker VB SD:** staging `dbo.TT_GOODS_MOVEMENT_H` dan `dbo.TT_GOODS_MOVEMENT_L`.
- **Hasil posting:** pada target `A_DB_STG` tersedia status umum, picking/complete, pesan, dan material document. Pemeriksaan ulang 11 November juga menemukan kolom PGI/GR terpisah; kontrak penulis dan hasil setiap tahap masih perlu dipastikan.
- **Implementasi sekarang:** impor delivery dan writer Goods Movement Finish Pulling sudah ada. Job menunggu upload seluruh item `X`, lalu menahan antrean lanjutan sampai tabel GI tersedia. Konfirmasi posting GI AIIA / GR AII / GI AII belum tersambung; upload `X` tidak dianggap sebagai konfirmasi bisnis tersebut.

Nama tabel yang sama tidak berarti database yang sama. `logistics.TT_DELIVERY_ITEM` di PostgreSQL AVICENNA berbeda dari `dbo.TT_DELIVERY_ITEM` di SQL Server staging. Scan yang memperbarui counter lokal tidak otomatis mengubah staging.

## Bukti yang dibaca

1. `D:/fabian/00_Project/AI Project/SD/VB for Move SD.zip`, anggota `VB_GOODS_MOVEMENT_SD/WindowsApplication9/Form1.vb` (271 baris).
2. DDL individual `SD/create_delivery_header.sql`, `create_delivery_line.sql`, `create_customer.sql`, `create_customer_function.sql`, `create_shipping_parts.sql`, `create_delivery_time.sql`, `create_ekanban_customer.sql`.
3. Implementasi AVICENNA: [importer](../apps/api/src/staging/staging-pull.service.ts), [pusher](../apps/api/src/staging/staging-push.service.ts), [mapping](../apps/api/src/staging/staging-tables.ts), [flow delivery](../apps/api/src/loading/delivery-flow.ts), [schema lokal](../packages/db/src/schema/delivery.ts).
4. Temuan metadata staging **historis**, 27 Oktober 2026: [delivery-intercompany-staging.md](delivery-intercompany-staging.md). Bukan pemeriksaan ulang database live pada analisis ini.

Koreksi pemilik sistem pada 3 November 2026: target yang benar adalah **`A_DB_STG.dbo`**. `aisinbisa_sap_stagging` adalah database trial tim SAP; temuan metadata/data historis dari database itu tidak otomatis membuktikan kontrak target yang benar.

DDL asli menargetkan `DB_AIS.dbo`. Konversi SQL PostgreSQL dalam folder SD menargetkan `public`, bukan schema lokal AVICENNA. Sumber referensi, database trial, target `A_DB_STG`, dan database lokal AVICENNA harus dibedakan.

### Verifikasi target 3 November 2026

Koneksi menggunakan kredensial staging yang sudah ada berhasil; `SELECT DB_NAME()` mengembalikan `A_DB_STG`. Pemeriksaan hanya metadata, tanpa membaca baris transaksi atau menulis data. API juga melaporkan target `A_DB_STG`, koneksi berhasil, push=false, pull=false.

- Seluruh sembilan tabel pada analisis ini tersedia di `dbo`; kolom yang dipakai importer delivery/master/jadwal saat ini tersedia.
- `TT_GOODS_MOVEMENT_H` mempunyai 17 kolom, tanpa `CHR_PLANT_TO`.
- `TT_GOODS_MOVEMENT_L` mempunyai 44 kolom, tanpa keenam kolom `CHR_PGI_DOC/YEAR/STATUS` dan `CHR_GR_DOC/YEAR/STATUS`.
- Identity terverifikasi: header `INT_NUMBER`, item `INT_NUMBER_ITEM`.
- Default item: `CHR_STATUS='N'`, `CHR_PICK_STATUS='N'`, `CHR_UPLOAD='0'`; default header `CHR_VALIDATE` kosong. Default tidak membuktikan semantik sukses setiap tahap.
- Lebar tetap perlu dijaga: PDS header delivery 50 vs item goods movement 15; nomor item delivery 10 vs goods movement 6.

Lulus pemeriksaan struktur adapter yang ada bukan berarti posting intercompany sudah terimplementasi. Pada 3 November keenam kolom tersebut hanya ditemukan di trial; pemeriksaan 11 November menemukan kolom yang sama sudah tersedia di target. Kontrak hasil GI/GR tetap perlu dipetakan.

## Tabel yang diambil

Arah berikut adalah rancangan integrasi Delivery dan perilaku importer saat ini. DDL sendiri hanya membuktikan struktur, bukan kepemilikan proses bisnis.

| Tabel staging | Kegunaan / kolom utama | Key dan perlakuan |
| --- | --- | --- |
| `TT_DELIVERY` | `CHR_DEL_NO`, `CHR_DOK_NO`, `CHR_PDS_NO`, `CHR_CUS_NO`, `CHR_CUS_DEST`, `CHR_DEL_DATE`, `CHR_CYCLE`, `CHR_PO_NO`; sales area `CHR_SORG`, `CHR_DIS_CHANNEL`, `CHR_DIVISION` | PK `CHR_DEL_NO`. Sumber header rencana; jangan membuat ulang header SAP untuk tiap scan. Nama bisnis DEL/DOK/PDS tetap mengikuti kontrak SAP. |
| `TT_DELIVERY_ITEM` | `CHR_DEL_NO`, `CHR_DEL_ITEM`, `CHR_PART_NO`, `CHR_CUST_PART_NO`, `CHR_PART_NAME`, `INT_TOTAL_QTY`, `INT_DEL_QTY`, `INT_QTY_PER_BOX`, `CHR_ITEM_TYPE`, `CHR_DELETE_FLAG` | PK `CHR_DEL_NO + CHR_DEL_ITEM`. Part yang sama dapat muncul pada item berbeda; jangan menggabungkan hanya berdasarkan part. |
| `TM_CUST` | Nomor/nama/alamat customer dan sales area | PK customer + sales org + distribution channel + division. Importer sekarang hanya memetakan kode/nama; sales area perlu ditangani jika ada duplikasi kode customer lintas area. |
| `TM_SHIPPING_PARTS` | `CHR_CUS_NO`, `CHR_PART_NO`, `CHR_CUS_PART_NO`, `CHR_CUS_PART_DESC`, sales org/channel | PK `CHR_SALES_ORG + CHR_DIS_CHANNEL + CHR_CUS_NO + CHR_PART_NO`. Referensi pencocokan part customer. Importer belum mempertahankan seluruh key sales area. |
| `TM_DELIV_TIME` | `CHR_CUST_NO`, `CHR_DEST_NO`, `CHR_GATE_NO`, `CHR_CYCLE`, `CHR_PICK_TIME`, `CHR_LOADING_TIME`, `CHR_DEL_TIME` | PK customer + destination + gate + cycle. Jam referensi preparation/pickup/delivery. Header delivery tidak mempunyai gate; jadwal beberapa gate tidak boleh dipilih sembarang. |
| `TM_CUST_FUNC` | `CHR_PARTNER_FUNCTION`, `CHR_PARTNER_COUNT`, `CHR_PARTNER_NO`, customer dan sales area | Pelengkap bila perlu memetakan partner/ship-to; bukan progres scan. Tidak ada importer khusus tabel ini pada jalur delivery yang diperiksa. |
| `TT_EKANBAN_CUST` | Hanya `CHR_ID char(800)` | Referensi raw e-kanban, opsional setelah formatnya diketahui. Tidak menyediakan kolom terpisah untuk PDS/customer/qty, dan bukan tempat menyimpan PDF customer. Tidak membuktikan perlunya INSERT tiap pembacaan RFID. |

Master part/back number/packaging lokal juga dibutuhkan untuk validasi scan. Import master yang sudah ada membaca `TM_PARTS` dengan pemetaan plant dari `TM_PROCESS_PARTS`; itu dependensi master, bukan tabel request GI delivery.

Importer delivery saat ini memakai `INT_TOTAL_QTY`, fallback `INT_DEL_QTY`, sebagai rencana; `INT_QTY_PER_BOX` sebagai kapasitas box, fallback ke master lokal. `INT_SCAN_QTY` dan `INT_ACTUAL_DEL` **tidak dibaca untuk menggantikan progres scan lokal**. Arti bisnis empat kolom qty tersebut tetap perlu disepakati.

Pemilihan hari saat ini: ambil tanggal operasional yang berganti pukul 06:00, kemudian filter `CHR_DEL_DATE = YYYYMMDD`. Ini bukan query timestamp `06:00 <= waktu < 06:00 hari berikutnya`, karena header sumber hanya menyediakan tanggal untuk filter itu.

## Tabel request yang perlu disiapkan untuk ditulis

VB baris 86–96 menjalankan JOIN berikut:

```sql
FROM TT_GOODS_MOVEMENT_H H
JOIN TT_GOODS_MOVEMENT_L L ON H.INT_NUMBER = L.INT_NUMBER
WHERE H.CHR_VALIDATE = 'X'
  AND L.CHR_UPLOAD = '0'
  AND H.CHR_TYPE_TRANS IN
      ('FGDL','DLFG','NOFG','NODL','DLGD','DLRP','DLCL','GDDL','RPDL','CLDL')
```

Itulah bukti tabel tujuan request SD. VB **membaca**, bukan membuat, request tersebut. Pengisian oleh AVICENNA adalah tugas adapter yang harus memenuhi kontrak worker. Ini bukan instruksi menjalankan INSERT live sekarang.

| Tabel | Kolom yang perlu dipetakan | Keterangan |
| --- | --- | --- |
| `TT_GOODS_MOVEMENT_H` | `INT_NUMBER` | Identitas request; menurut metadata yang sudah dicatat pada adapter, diberikan SQL Server. Jangan membuat nomor sendiri tanpa pemeriksaan identity target. |
| Header | `CHR_DATE`, `CHR_REMARKS` | Posting date dan header text yang dikirim ke RFC. |
| Header | `CHR_PLANT`, `CHR_MVMT_TYPE`, `CHR_TYPE_TRANS` | Plant, movement type, jenis transaksi. Nilai untuk setiap tahap intercompany belum terbukti dari VB. |
| Header | `CHR_VALIDATE` | Nilai `X` membuat request memenuhi gerbang worker. Header dan semua item harus lengkap sebelum request dilepas. |
| `TT_GOODS_MOVEMENT_L` | `INT_NUMBER`, `INT_NUMBER_ITEM` | Referensi header dan identitas item. Metadata adapter menyatakan item ID identity; nomor SAP delivery item adalah field berbeda. |
| Item | `CHR_DEL_NO`, `CHR_DEL_ITEM` | Referensi SAP delivery + item asli yang dipertahankan dari hasil impor. Bukan diganti QR manifest/PDS atau nomor DO lokal. |
| Item | `CHR_PART_NO`, `CHR_SLOC_FROM`, `CHR_SLOC_TO`, `INT_TOTAL_QTY` | Material, SLOC asal/tujuan, qty transaksi yang sudah divalidasi. |
| Item | `CHR_STATUS`, `CHR_PICK_STATUS` | Keduanya dibaca dan dikirim sebagai input RFC. **Nilai awal/arti transisinya tidak dijelaskan VB**; jangan mengisi `S` untuk menyatakan sukses sendiri. |
| Item | `CHR_UPLOAD` | Worker memilih nilai `0`. Nilai setelah selesai dan pemilik penulisannya tidak dijelaskan kode ini. |

Pengelompokan H/L di atas memakai metadata adapter dan analisis schema sebelumnya. VB sendiri menggunakan `SELECT *` dan pembacaan nama kolom tanpa alias; untuk nama yang muncul di dua tabel, lokasi fisik harus diverifikasi di schema target. Tabel ini adalah daftar field yang terpakai oleh worker, bukan DDL/daftar lengkap seluruh kolom NOT NULL target.

Field tambahan seperti `CHR_PART_NO_TO`, `CHR_PDS_NO`, `CHR_PLS_NO`, UOM/audit mungkin diperlukan oleh kontrak lengkap. **VB tidak meneruskannya secara eksplisit** ke kedua RFC SD. `CHR_PLANT_TO` belum ada pada pemeriksaan target 3 November, tetapi sudah tersedia pada pemeriksaan 11 November. Keberadaan kolom belum menjelaskan bagaimana plant/material tujuan dipakai oleh RFC.

### Pemetaan langsung ke RFC

| Kolom input | Parameter SAP |
| --- | --- |
| `CHR_DATE` | `I_PSTNG_DATE` |
| `CHR_REMARKS` | `I_HEADER_TXT` |
| `CHR_PART_NO` | `T_GOODSMVT.MATERIAL` |
| `CHR_PLANT` | `T_GOODSMVT.PLANT` |
| `CHR_SLOC_FROM` / `CHR_SLOC_TO` | `STGE_LOC` / `MOVE_STLOC` |
| `CHR_MVMT_TYPE` | `MOVE_TYPE` |
| `INT_TOTAL_QTY` | `ENTRY_QNT` |
| `INT_NUMBER` / `INT_NUMBER_ITEM` | `LONGNUM` / `ITEM_TEXT` |
| `CHR_DEL_NO` / `CHR_DEL_ITEM` | `DEL_NO` / `DEL_ITEM` |
| `CHR_TYPE_TRANS` | `TRANS_TYPE` |
| `CHR_STATUS` / `CHR_PICK_STATUS` | `STAT` / `STAT_PICK` |

Bukti: VB baris 124–137, 167–186, 193–213. `ENTRY_QNT` dideklarasikan sebagai Integer; tidak ada konversi unit atau parameter UOM eksplisit pada kedua cabang SD.

## Routing yang terbukti, dan yang belum

| `CHR_TYPE_TRANS` | RFC yang dipanggil | Kepastian |
| --- | --- | --- |
| `FGDL`, `DLFG` | `ZZBAPI_AIIECC_SD00001` | Terlihat langsung, baris 164–188. |
| `NOFG`, `NODL` | `ZZBAPI_AIIECC_SD00004` | Terlihat langsung, baris 190–215. **Tidak membuktikan** NOFG = GI AIIA + GR AII atau NODL = GI AII. |
| `DLGD`, `DLRP`, `DLCL`, `GDDL`, `RPDL`, `CLDL` | `ZZBAPI_AIIECC_PP00010` | Masuk cabang `Else`, baris 216–234; makna bisnisnya tidak dijelaskan. |

Cabang SUBC/RTRN/STLT/VCLM/CKIP ada dalam file tetapi tidak tercapai oleh filter query aktif ini. Filter `CHR_STATUS='N'`, STNG, tanggal/user, serta `ORDER BY` berada di komentar; bukan persyaratan aktif worker SD ini.

## Hasil yang perlu dibaca kembali

Metadata staging **trial** historis menunjukkan kandidat berikut pada `TT_GOODS_MOVEMENT_L`. Keenam kolom PGI/GR tersebut belum ada di `A_DB_STG` pada 3 November, tetapi sudah ditemukan pada pemeriksaan ulang 11 November 2026:

- PGI: `CHR_PGI_STATUS`, `CHR_PGI_DOC`, `CHR_PGI_YEAR`.
- GR: `CHR_GR_STATUS`, `CHR_GR_DOC`, `CHR_GR_YEAR`.
- Kolom yang memang ada di target: `CHR_STATUS`, `CHR_MESSAGE`, `CHR_MESSAGE_DO`, `CHR_MATDOC`, `CHR_MATDOC_YEAR`, `CHR_PICK_STATUS`, `CHR_COMPLETE_STATUS`, `CHR_UPLOAD`.

VB hanya mengambil `T_RETURN` (188, 215, 234); tidak membacanya lebih lanjut, tidak melakukan UPDATE status/dokumen, dan tidak memperlihatkan callback/commit. Jadi daftar di atas **bukan kontrak acknowledgement yang sudah terbukti dari VB**. Pada contoh historis, status umum sukses dapat berdampingan dengan GR gagal; keputusan selesai harus per tahap dan disertai nomor dokumen yang benar.

Satu-satunya INSERT SQL eksplisit di file adalah `TT_ERR_LOG_INTERFACE` (256–259), dengan `CHR_FUNCTION='ERR_SD'`, `CHR_ERROR_MESSAGE`, `CHR_DATE`, `CHR_TIME`. Ini log milik middleware, bukan tabel request delivery yang harus diisi AVICENNA.

## Dampak ke flow AVICENNA

1. Impor header/item dan simpan referensi SAP delivery/item asli.
2. Scan kanban/barcode/RFID memperbarui progres dan audit **lokal**. Jangan langsung memperbarui setiap field qty staging hanya berdasarkan namanya.
3. Finish Pulling membuat snapshot dan tahap lokal GI AIIA. Writer H/L memakai mapping yang dikonfirmasi pada 16 November; job menunggu seluruh item upload `X` sebelum melanjutkan ke antrean GI.
4. Jika satu request SAP sekaligus menjalankan GI AIIA + GR AII, dua status lokal harus membaca dua hasil dari request yang sama; jangan mengirim GR kedua secara otomatis.
5. Sesudah hasil GI/GR yang diperlukan dikonfirmasi, terbitkan DO AVICENNA. `SJA/26/025276` berjumlah 13 karakter; `CHR_DEL_NO`, `CHR_DOK_NO`, `CHR_INV_NO` di DDL sumber hanya 10. Jangan menggunakan salah satunya untuk nomor DO lokal tanpa kontrak field yang sesuai.
6. **Selesai Pickup** pada Absensi Driver memicu tahap lokal GI AII. Scan/mulai pickup saja belum memicu tahap ini.
7. Dokumen kembali mencatat penerimaan customer lokal. Pengisian staging `CHR_FLAG_RECEIVE`, `CHR_DATE_RECEIVE`, `CHR_TIME_RECEIVE` belum didukung/belum dibuktikan kepemilikannya oleh VB ini.

Pada [staging-push.service.ts](../apps/api/src/staging/staging-push.service.ts), request Finish Pulling ditangani writer khusus; tahap GR AII dan GI AII tetap ditahan. Pembaca balasan bisnis lama masih hanya menangani TRANSFER/PRODUCTION, sedangkan [job GI](../apps/api/src/staging/delivery-gi.service.ts) membaca upload tanpa mengonfirmasi posting. `BELUM_DIDUKUNG.DELIVERY` di `field-map.ts` adalah placeholder lama, bukan bukti adanya writer ke `TT_DELIVERY/ITEM`.

## Keputusan yang masih dibutuhkan sebelum posting nyata

1. Tabel/kolom GI lanjutan setelah upload Goods Movement `X`, cakupan posting GI AIIA/GR AII, dan mapping Selesai Pickup. Mapping awal Finish Pulling sudah dicatat di bagian 16 November.
2. Writer hasil posting dan aturan sukses/gagal/retry per tahap: isi `T_RETURN`/ABAP atau spesifikasi middleware. VB sendiri tidak menyelesaikan pembuktian ini.
3. Apakah AVICENNA juga wajib mengisi actual qty/receive flag pada tabel delivery; jika ya, field, nilai, dan waktu update yang resmi.

Catatan keandalan worker: table RFC dibuat sekali lalu `Insert()` + `Invoke()` tiap baris tanpa `Clear()` yang terlihat; tidak ada claim antrean/dedup eksplisit. Perilaku retry dan pemrosesan multi-item perlu dibuktikan sebelum mengaktifkan producer baru. Hal ini tidak mengubah pilihan tabel, tetapi menentukan cara aman menulis request.

Analisis awal 2 November tidak mengubah aplikasi atau SAP. Pada 3 November konfigurasi lokal dialihkan ke `A_DB_STG`, API direstart, dan koneksi/metadata target diverifikasi read-only. Push/pull otomatis tetap mati. Implementasi ABAP dan worker yang benar-benar terpasang belum diverifikasi; tidak ada posting SAP dari pemeriksaan ini.
