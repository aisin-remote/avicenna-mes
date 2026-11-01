# Referensi staging SD dan MM

Analisis 28 Oktober 2026 atas folder `D:/fabian/00_Project/AI Project/SD` dan `D:/fabian/00_Project/AI Project/MM`. Pembacaan file saja; workbook/DDL asli tidak diubah, kode VB tidak dijalankan, dan tidak ada posting ke staging/SAP.

## Kesimpulan untuk AVICENNA

Sumber rencana delivery tetap `TT_DELIVERY` + `TT_DELIVERY_ITEM`. Master customer, part customer, packaging, jadwal, dan saldo mempunyai sumber terpisah. Kode VB SD memperkuat kandidat request `TT_GOODS_MOVEMENT_H/L`, tetapi belum membuktikan `NOFG = GI AIIA + GR AII` dan `NODL = GI AII` pada integrasi yang sedang dipakai.

`TT_PURCHASE_RECEIPT_H/L` mempunyai kontrak contoh GR **terhadap purchase order supplier**. Jangan menggunakannya sebagai GR AII intercompany hanya karena keduanya disebut GR. Alur AVICENNA tetap melewati tiga status logis, dan posting nyata tetap HELD sampai pemetaan bisnis dikonfirmasi.

## Sumber dan lokasi bukti

| Sumber | Isi yang diperiksa |
| --- | --- |
| `SD/Sample Data for All Table Linked to SAP - SD.xlsx` | 9 sheet: customer, partner function, shipping parts, delivery header/item, forecast header/item, jadwal, dan raw e-kanban. |
| `MM/Sample Data for All Table Linked to SAP - MM.xlsx` | 19 sheet: part/SLOC, stock, vendor, kanban, ELINA, material document inbound, PO, order penerimaan, receipt, dan BOM. |
| `SD/VB for Move SD.zip` | `VB_GOODS_MOVEMENT_SD/WindowsApplication9/Form1.vb`, terutama baris 63–70, 86–99, 124–137, 164–215. |
| `MM/VB for GR.zip` | `VB_RECEIPT/WindowsApplication9/Form1.vb`, baris 64–103 dan 115–157; `VB_RECEIPT_SLITTING/.../Form1.vb`, baris 106–143 dan 157–208; `VB_RDS_CANCEL/rds cancel/Form1.vb`, baris 42–78. |
| DDL `create_*.sql` | Nama tabel/schema, primary key, panjang kolom, tipe qty dan flag. File gabungan PostgreSQL tidak mencakup seluruh DDL individual. |

Jumlah baris di bawah dihitung sesudah membuang header dan memangkas padding CHAR. Teks `NULL` dinormalisasi sebagai kosong untuk analisis; nomor dokumen tetap teks.

## Tabel untuk setiap fitur

| Fitur | Sumber | Key/kolom penting dan batas penggunaan |
| --- | --- | --- |
| Delivery, detail pesanan, pulling | `TT_DELIVERY`, `TT_DELIVERY_ITEM` | Header PK `CHR_DEL_NO`; item PK `CHR_DEL_NO + CHR_DEL_ITEM`. Manifest/PDS: `CHR_DOK_NO`, `CHR_PDS_NO`. Rencana dan aktual qty harus dibedakan. |
| Master customer/destination | `TM_CUST`, `TM_CUST_FUNC` | Customer memakai sales area `CHR_CUST_NO + CHR_SORG + CHR_DIS_CHANNEL + CHR_DIVISION`. Partner function/count memperinci partner, bukan progres delivery. |
| Part customer | `TM_SHIPPING_PARTS` | `CHR_SALES_ORG + CHR_DIS_CHANNEL + CHR_CUS_NO + CHR_PART_NO`; nilai `CHR_CUS_PART_NO` tidak boleh dicari hanya berdasarkan part. |
| Preparation Monitoring | `TM_DELIV_TIME` + rencana delivery + scan MES | Key jadwal `CHR_CUST_NO + CHR_DEST_NO + CHR_GATE_NO + CHR_CYCLE`; jam `CHR_PICK_TIME`, `CHR_LOADING_TIME`, `CHR_DEL_TIME`. Aktual preparation tetap ledger pulling MES. |
| Master part dan packaging | `TM_PARTS`, `TM_KANBAN` | Back number, UOM, qty/box. `TM_KANBAN` PK `CHR_KANBAN_TYPE + INT_KANBAN_NO + CHR_PART_NO`; plant, SLOC asal/tujuan, work center, box dan rak adalah atribut. Ini master kartu, bukan bukti isi box fisik sudah diproduksi. |
| Referensi saldo SAP | `TT_PARTS_SLOC` | PK `CHR_SLOC + CHR_PART_NO`, saldo `INT_PART_QTY`. Perlu scoping plant/database; jangan menjumlahkannya dengan saldo ledger MES sebagai stok tambahan. |
| Daftar part yang boleh di SLOC | `TM_PARTS_SLOC` di DDL | Workbook menamai sheet `TM_PART_SLOC`. Perbedaan ini perlu dicocokkan dengan metadata database aktual. |
| Kandidat request GI/GR delivery | `TT_GOODS_MOVEMENT_H/L` | Dirujuk kode VB SD dan sudah diperiksa di database pada 27 Oktober. Tidak ada sheet/DDL goods movement di kedua folder ini, sehingga struktur lengkap tetap mengacu metadata staging aktual. |
| GR penerimaan supplier | `TT_PURCHASE_RECEIPT_H/L` | Header PK `CHR_PDS_NO + INT_PDS_PROCSEQ`; item PK menambah `INT_PDS_LINENO + CHR_PART_NO`. `INT_PDS_DELNO` adalah atribut tambahan, bukan pengganti key yang dideklarasikan. |
| Demand inbound dari supplier | `TT_PURCHASE_ORDER_H/L`, `TT_PO_HEADER/LINE` | PDS lokal mengacu nomor PO/item SAP lewat `CHR_PONO_R3`, `CHR_PONO_LINE_R3`. Ini jalur inbound; tidak dicampurkan dengan PDS customer delivery. |
| Referensi GR/import CKD | `TM_MATDOC_IP_H/L` | Header PK material document + tahun, item menambah nomor item. Ada PIB, supplier, plant, SLOC, qty/qty scan. Belum ada bukti tabel ini adalah pemicu GR intercompany delivery. |
| Preparation material produksi | `PRD.TT_ELINA_H/L` | Mengacu `CHR_PRD_ORDER_NO`, part FG/material, work center dan prepare area. Kata preparation di sini berkaitan dengan order produksi; bukan pengganti Preparation Monitoring delivery customer. |
| Referensi pelengkap | `TT_CUST_FORECAST_H/L`, `TM_VENDOR`, `TM_VENDOR_PARTS`, `TM_VENDOR_STOCK`, `TM_PART_SUBCONT`, `TM_BOM_SAP`, `TT_EKANBAN_CUST` | Forecast bukan tambahan qty delivery; vendor/BOM/subcont untuk inbound/produksi. Raw `TT_EKANBAN_CUST.CHR_ID` memerlukan parser format customer yang disepakati. |

## Yang terbukti dari kode VB SD

1. Worker membaca JOIN `TT_GOODS_MOVEMENT_H.INT_NUMBER = TT_GOODS_MOVEMENT_L.INT_NUMBER`.
2. Filter aktif: header `CHR_VALIDATE = 'X'`, item `CHR_UPLOAD = '0'`, dan transaksi header termasuk `FGDL`, `DLFG`, `NOFG`, `NODL`, `DLGD`, `DLRP`, `DLCL`, `GDDL`, `RPDL`, `CLDL` (Form1.vb baris 86–99).
3. `FGDL/DLFG` diarahkan ke RFC `ZZBAPI_AIIECC_SD00001`. `NOFG/NODL` diarahkan ke `ZZBAPI_AIIECC_SD00004` (baris 164–215).
4. Untuk `NOFG/NODL`, `T_GOODSMVT` menerima `MATERIAL`, `ITEM_TEXT` (INT_NUMBER_ITEM), `PLANT`, `STGE_LOC`, `MOVE_STLOC`, `MOVE_TYPE`, `ENTRY_QNT`, `LONGNUM` (INT_NUMBER), `DEL_NO`, `DEL_ITEM`, `TRANS_TYPE`, `STAT`, dan `STAT_PICK`. Header RFC memakai `I_PSTNG_DATE` dan `I_HEADER_TXT`.
5. Script mengambil `T_RETURN`, tetapi tidak memetakan atau menulis balik hasilnya dalam kode VB tersebut. Kepemilikan update PGI/GR/UPLOAD di database belum dapat ditentukan dari script ini saja.

Konsekuensi: AVICENNA tetap berbicara dengan **staging**, lalu worker SAP mengerjakan RFC. Menyalin pemanggilan RFC ke AVICENNA tidak diperlukan. Bukti filter X/0 menunjukkan sebuah baris staging dapat langsung dipungut worker; menulis dummy berflag ini ke staging nyata bukan langkah analisis.

Kode berlabel `AIIECC` adalah referensi legacy. Keberadaan file tidak membuktikan worker/RFC identik sudah aktif di target SAP S/4. Cabang DLGD/DLRP/dll masuk filter tetapi tidak mempunyai pemetaan bisnis eksplisit pada potongan tersebut; tidak digunakan sebagai tebakan flow baru.

## Jalur MM supplier dan balasannya

`VB_RECEIPT` memilih receipt PDS `D%` dengan `CHR_UPLOAD='0'`, menggabungkan header/item berdasarkan PDS + process sequence, lalu mengirim `ZZBAPI_GOODSMVT_CREATE` / `ZTAB`. Nilai hardcoded di kode ini: plant `600`, SLOC `WH00`, movement `101`, movement indicator `B`, code `01`, dengan referensi PO/item, qty, PDS, recovery, batch/serial/invoice. Nilai ini khusus referensi penerimaan tersebut; bukan default yang sah untuk GR AII delivery.

Workbook MM sheet `TT_PURCHASE_RECEIPT_H!A1:AF51` mempunyai 32 baris `CHR_UPLOAD=X` dan `CHR_ERROR_FLAG_R3=S`; 18 sisanya upload `0` dan status kosong. Contoh baris 2: PDS `D2609250082`, nomor material document `5001087223`, tahun `2026`, pesan `Success Create ...`. Ini mendukung pasangan status + nomor/tahun sebagai hasil receipt; bukan bukti cukup untuk menafsirkan hasil intercompany di goods movement.

`VB_RECEIPT_SLITTING` menangani PDS `S%`; PO bertipe `ZPOS` memerlukan agregasi berat/batch dari `TT_ORDER_COIL_UPLOAD`, tabel yang tidak ada pada kedua workbook. `VB_RDS_CANCEL` memakai `ZZBAPI_GOODSMVT_CANCEL`, material document/tahun dan flag delete receipt. Jalur cancel tersebut tidak otomatis berlaku untuk reversal delivery.

## Kualitas sampel dan pengaruhnya ke trial

| Pemeriksaan | Hasil dan konsekuensi |
| --- | --- |
| Delivery SD | 50 header (`A2:X51`), 150 item (`A2:L151`); 148 item cocok ke 48 header. Ada 2 item tanpa header sampel dan 2 header tanpa item sampel. Gunakan hanya subset yang berpasangan untuk fixture. |
| Nomor referensi | 16/50 header manifest kosong dan 2/50 PDS kosong. Fallback tampilan/scan harus eksplisit; PDS kosong tidak boleh menggabungkan delivery berbeda. |
| Ukuran box | 12/150 item mempunyai `INT_TOTAL_QTY` bukan kelipatan `INT_QTY_PER_BOX`; contohnya item row 17, total 2 dan box size 10. Harus diputuskan aturan partial box/loose pcs. Jangan menaikkan qty pesanan menjadi satu box penuh. |
| Qty aktual | `INT_DEL_QTY` kosong pada 133 item; `INT_ACTUAL_DEL` kosong pada 94. `INT_SCAN_QTY` terisi nonzero pada 24 item. Ketiga field tidak boleh dianggap salinan qty rencana yang selalu tersedia. |
| Status delivery | `CHR_GI_DEL` berisi A (46) dan C (4), sementara seluruh sample SM flags/receive flag tetap 0. Hubungan ke tiga tahap GI/GR tidak terbukti dari distribusi ini. |
| Jadwal SD | 50 baris `TM_DELIV_TIME!A2:I51` memiliki tiga clock terisi, tetapi **19 baris semuanya 000000**. Midnight vs jadwal belum diset masih perlu konfirmasi. Ada 13 kombinasi customer/destination/cycle dengan lebih dari satu gate. |
| Jadwal nyata yang bisa dipakai sebagai referensi | `TM_DELIV_TIME!A2:I2`: customer 0010-, destination 0010-01, gate 11-, cycle 1-, pick 04:00, loading 06:45, delivery 07:00. Row 51: pick 15:50, loading 23:35, delivery 03:10 (lintas hari). Makna jam sebagai start/deadline PPIC tetap harus dipetakan. |
| Receipt MM | 50 header, 258 item; 208 item cocok ke 46 header memakai PDS+process sequence. Sisa sampel tidak boleh dihubungkan berdasarkan urutan baris. |
| Material document inbound | 50 header cocok dengan seluruh 1.115 item menggunakan material document + tahun. Ini subset inbound yang lebih lengkap. |
| ELINA | 50 header cocok dengan 763 item menggunakan production order. Tetap bukan data rencana delivery customer. |
| Unit | Ada PC, PCS, ST, G, KG, UNT dan unit kosong. Pertahankan unit asli; kesetaraan/konversi harus punya mapping, terutama qty berat/pecahan. |
| DDL gabungan | SD PostgreSQL berisi 7 tabel, tidak mencakup jadwal/e-kanban. MM gabungan berisi 13 tabel, tidak mencakup kanban, ELINA, material document dan BOM. Tidak cukup mengandalkan nama file all_tables. |
| Versi sumber | DDL merujuk DB_AIS dan ELINA memakai schema PRD; workbook/DDL bukan otomatis salinan identik `aisinbisa_sap_stagging.dbo`. Metadata koneksi target tetap acuan eksekusi. |

## Yang dapat diteruskan dan yang masih perlu SAP

Pemetaan master, validasi relasi header-item, handling reference kosong, skenario beda gate/lintas hari, serta fixture partial box dapat dikembangkan dan diuji secara lokal dari referensi ini. Dummy full flow yang sudah disiapkan tetap dataset terpisah dan tidak berubah karena analisis ini.

Tiga kelompok konfirmasi paling menentukan:

1. **Kontrak NOFG/NODL:** pemicu Finish Pulling dan scan driver masing-masing memakai transaksi apa, apakah GI AIIA+GR AII satu request, serta nilai plant/SLOC/material/movement type AIIA dan AII. Pastikan worker SD00004 target benar-benar aktif.
2. **Balasan dan retry:** siapa mengubah upload/pick/complete/PGI/GR, nilai sukses tiap tahap, nomor+tahun yang dikembalikan, serta cara retry hanya tahap gagal tanpa mem-posting ulang tahap sukses. Kode VB tidak memuat implementasi RFC/ABAP atau kontrak ini.
3. **Qty dan jadwal operasional:** field plan/actual resmi, partial box, unit, makna jam 000000, pemilihan gate, dan waktu acuan cutoff 06:00–06:00. File menyediakan banyak contoh, tetapi tidak menetapkan aturan bisnis tersebut.

Tidak ada perubahan adapter posting atau aktivasi push nyata dari hasil analisis ini. Lihat juga `delivery-intercompany-staging.md` untuk bukti status PGI/GR di database dan urutan transaksi AVICENNA.
