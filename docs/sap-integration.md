# Integrasi SAP dan Model SLOC

Keputusan di halaman ini diambil setelah membandingkan sistem ini dengan
*Inventory Flow & Mapping Integration Table* milik MIS Dept PT. Aisin Indonesia
(aplikasi pihak ketiga yang akan digantikan).

## Tiga keputusan

### 1. SAP memiliki data master

`parts`, `suppliers` (vendor), dan `customers` dimiliki SAP. Kelak master di
sini hanya salinan baca-saja hasil sync.

**Sampai sync-nya dibangun, CRUD master tetap dibuka.** Mengunci sekarang
berarti tidak ada cara memasukkan data sama sekali. Yang perlu diingat: setiap
baris master yang diketik manual hari ini adalah data yang harus dicocokkan
ulang saat sync menyala — jadi kolom penghubung ke nomor SAP perlu disiapkan
sejak awal, bukan ditambahkan belakangan.

### 2. Ada database jembatan di antara keduanya

Avicenna tidak pernah bicara langsung dengan SAP. Di antara keduanya ada satu
database MS SQL — **staging** — dan lalu lintasnya dua arah:

```
Avicenna  ──dorong transaksi──▶  STAGING  ──ditarik──▶  SAP
Avicenna  ◀──tarik master─────   STAGING  ◀──didorong──  SAP
```

Kita punya akses penuh baca-tulis ke staging. SAP menulis balik **flag
berhasil/gagal** di baris yang sama, dan flag itulah yang menutup dokumen di
`TT_SAP_OUTBOX`.

Konsekuensi yang menentukan rancangan:

- Perlu **outbox**: baris yang siap dikirim, beserta statusnya. Menulis
  langsung ke MS SQL di dalam transaksi produksi tidak bisa dilakukan — dua
  database berbeda, dan kalau MS SQL sedang mati, scan di lantai produksi tidak
  boleh ikut gagal.
- Perlu **kunci idempoten lintas sistem**. Pengiriman ulang saat jaringan
  tersendat harus bisa dikenali di sisi MS SQL, bukan menghasilkan dokumen
  dobel.
- Perlu **status posting** per dokumen, dan `SENT` **bukan status akhir**.
  Barisnya sampai di staging tidak berarti SAP sudah menerimanya. Menganggap
  keduanya sama berarti dokumen yang ditolak SAP menghilang dari pandangan, dan
  selisihnya baru ketahuan saat tutup buku.
- Perlu **dua saklar terpisah**. `STAGING_PUSH_ENABLED` dan
  `STAGING_PULL_ENABLED` berdiri sendiri, karena begitu tarik master aktif, apa
  pun yang diketik orang di layar master Avicenna akan tertimpa isi staging pada
  putaran berikutnya — itu keputusan tersendiri, bukan efek samping dari
  menyambungkan koneksi.

### 3. Model SLOC diadopsi seluruhnya

Setiap perpindahan barang adalah **sepasang** mutasi: (−) di SLOC asal dan (+)
di SLOC tujuan. Ini yang membuat angka per SLOC di sini bisa dicocokkan dengan
angka di SAP.

### Kebijakan per langkah rute produksi

Di `/master/part-processes`, setiap part dan proses aktif punya pengaturan
SLOC input, SLOC hasil, SLOC tujuan transfer, izin kirim hasil produksi,
izin kirim transfer, dan movement type transfer. Contohnya Casting WIP dan
Casting FG bisa berbeda walaupun sama-sama melewati Casting. Machining WIP
dapat mencatat stok lokal tanpa membuat dokumen SAP.

Saat scan produksi diterima, Avicenna menulis hasil ke SLOC hasil. Bila SLOC
tujuan transfer diisi, scan yang sama langsung menulis mutasi keluar dari SLOC
hasil dan masuk ke SLOC tujuan. Ketiganya disimpan satu transaksi bersama scan
dan penempelan kanban FG. Dua izin kirim SAP mengontrol dokumen produksi dan
transfer secara terpisah; menonaktifkan izin tidak membatalkan mutasi stok lokal.
Pengaturan rute disalin ke metadata scan agar perubahan master tidak mengubah
keputusan pengiriman transaksi lama.

Backflush komponen memakai SLOC input langkah rute. Dokumen hasil produksi
baru masuk outbox setelah backflush selesai. Dokumen transfer boleh masuk
secara terpisah. Hasil produksi dikirim satu baris per scan ke
`TT_PRODUCTION_RESULT`; transfer SLOC ke `TT_GOODS_MOVEMENT_H` dan `_L`.
Keduanya menunggu balasan flag SAP setelah berhasil ditulis ke staging.
Jika keduanya diaktifkan, transfer SAP ditahan sampai hasil produksi dari scan
yang sama berstatus `CONFIRMED`; kalau produksi ditolak, transfer tidak maju.
Movement type transfer wajib diisi pada rute dan diverifikasi tim SAP.

**Sebelum push produksi diaktifkan**, pastikan bersama tim SAP apakah baris
`TT_PRODUCTION_RESULT` memicu backflush BOM di SAP. Adapter ini hanya menulis
hasil produksi; baris konsumsi `CONSUMPTION_OUT` tercatat di ledger Avicenna,
tetapi tidak ditulis sebagai baris staging tersendiri. Movement type transfer,
arti `STAGING_FLAG_*`, dan namespace `INT_NUMBER` juga perlu dicocokkan dengan
proses SAP. Saklar global `STAGING_PUSH_ENABLED` tetap gerbang terakhir.

```
Supplier → [WH00] → [WP01] → [PP02] → [PP04] → Customer
        (+)     (−)(+)    (−)(+)   (−)(+)   (−)
         1        2         3        4       5,6
```

| SLOC | Isi | Langkah masuk | Langkah keluar |
|------|-----|---------------|----------------|
| WH00 | Komponen & raw material | 1 Good Receipt | 2 Good Movement |
| WP01 | Work in process | 2 Good Movement | 3 Production (backflush) |
| PP02 | Finish good | 3 Production | 4 Pulling |
| PP04 | Staging & shipping | 4 Pulling | 6 Loading to truck |

## Jarak ke diagram, per langkah

| # | Langkah | Keadaan |
|---|---------|---------|
| 1 | Good Receipt | Ada. Belum ada PO untuk dicocokkan. |
| 2 | Good Movement | Ada (`transfers`). |
| 3 | Production Result | **Ada dan ber-SLOC.** WP01 (−) lewat backflush, PP02 (+) lewat scan. |
| 4 | Pulling / Shopping | **Ada dan ber-SLOC.** PP02 (−) → PP04 (+) saat pulling ditutup. |
| 5 | Delivery Preparation | Dikerjakan lewat SAP GUI — di luar cakupan sistem ini. |
| 6 | Loading to Truck | Ada sebagai loading list; stok keluar dari PP04. RFID gate belum. |

## Yang sengaja berbeda dari diagram

Diagram itu memetakan **stok**. Sistem ini memetakan **stok DAN ketertelusuran**:
`bom_lines`, `genealogy`, `consumptions`, `lots`, `repairs`, `ng_dispositions`.
Tabel-tabel itu tidak punya padanan di diagram dan memang tidak perlu dikirim
ke SAP — SAP hanya butuh pergerakan stoknya.

Perbedaan ini disengaja. Menelusuri part NG sampai ke lot raw material adalah
alasan sistem ini dibangun; SAP tidak menyimpan jejak itu.

## Penamaan tabel dan kolom

Tabel memakai awalan **TM_** (master) dan **TT_** (transaksi), kolomnya HURUF
BESAR — mengikuti konvensi yang sudah dipakai di lingkungan PT. Aisin, supaya
skema ini bisa dibaca orang MIS tanpa kamus penerjemah.

Nama properti TypeScript TETAP camelCase. Drizzle memisahkan nama properti dari
nama kolom, jadi kode tetap menulis `parts.partNumber` sementara databasenya
menyimpan `TM_PARTS.PART_NUMBER`. Penggantian nama ini karena itu tidak
menyentuh satu baris pun kode query.

Nama dari diagram MIS dipakai APA ADANYA bila tabel kita memang benda yang
sama. Sisanya memakai awalan yang sama dengan aturan mereka.

| Diagram | Di sini |
|---------|---------|
| TM_PARTS | `TM_PARTS` |
| TM_CUST | `TM_CUST` |
| TM_VENDOR | `TM_VENDOR` |
| TM_SHIPPING_PARTS | `TM_SHIPPING_PARTS` |
| TM_KANBAN | `TM_KANBAN` + `TT_KANBAN_EVENT` |
| TT_PURCHASE_RECEIPT_H / _L | `TT_PURCHASE_RECEIPT_H` / `_L` |
| TT_GOODS_MOVEMENT_H / _L | `TT_GOODS_MOVEMENT_H` / `_L` |
| TT_DELIVERY / TT_DELIVERY_ITEM | `TT_DELIVERY` / `TT_DELIVERY_ITEM` |
| TT_HISTORY_IN_LINE_SCAN | `TT_HISTORY_SCAN` (kind = PRODUCTION) |
| TT_HISTORY_SCAN_KANBAN_SD | `TT_HISTORY_SCAN` (kind = DELIVERY) |
| TT_PRODUCTION_RESULT | `TT_HISTORY_SCAN` + `TT_STOCK_MUTATION` |
| TM_VENDOR_PARTS | *belum ada* |
| TT_PO_HEADER / TT_PO_LINE | *belum ada* |
| TT_ELINA_H / _L | *belum ada* |
| TT_SETUP_CHUTE, TT_DATA_TESTER, TT_ONE_WAY_KANBAN | *belum ada* |

Tabel yang tidak punya padanan di diagram memakai awalan yang sama:
`TM_PLANT`, `TM_LINE`, `TM_LOCATION`, `TM_NG`, `TM_BOM`, `TM_SCRAP_RULE`,
`TM_MACHINE`, `TM_TOOLING`, `TM_USER`, `TM_ROLE`, `TM_DEVICE`,
`TT_STOCK_MUTATION`, `TT_STOCK_BALANCE`, `TT_LOT`, `TT_CONSUMPTION`,
`TT_GENEALOGY`, `TT_INSPECTION_H` / `_L`, `TT_NG_DISPOSITION`,
`TT_REPAIR_H` / `_L`, `TT_PRODUCTION_PLAN`, `TT_MACHINE_EVENT`.

### Satu jebakan yang perlu diingat

Nama TABEL huruf besar berperilaku berbeda antar sistem operasi. Di macOS
`lower_case_table_names` bernilai 2 — nama disimpan apa adanya tetapi
dibandingkan tanpa peduli besar-kecil. Di Linux nilainya biasanya 0 —
dibandingkan PEKA besar-kecil. Akibatnya `SELECT * FROM tm_parts` jalan di
laptop tetapi gagal di server.

Drizzle selalu memakai nama persis seperti didefinisikan di skema, jadi kode
aplikasi aman. Yang perlu hati-hati adalah query yang diketik manual — untuk
laporan, perbaikan data, atau pemeriksaan cepat.

Nama KOLOM selalu tidak peka besar-kecil di MySQL, jadi bagian itu bebas
masalah.

## Urutan pengerjaan

1. ~~**SLOC pada produksi**~~ — selesai. Lokasi pada langkah rute part
   menentukan SLOC produksi; lokasi line menjadi bawaan bila rute belum diatur.
2. ~~**Pisahkan Pulling dari Loading**~~ — selesai. Dokumen kini melewati
   DRAFT → PICKING → PICKED → LOADING → SHIPPED, dan stok berpindah
   PP02 → PP04 → keluar.
3. ~~**Lapisan SAP**~~ — outbox, movement type, status posting, dan layar
   pemantauan selesai. Penulis ke MS SQL masih kerangka: menunggu bentuk tabel
   tujuan dan movement type dari tim SAP.
4. **PO** — supaya penerimaan bisa dicocokkan ke pesanan.
5. **RFID gate** — paling akhir; di diagram pun tidak terhubung ke SAP.

## Tahapan dokumen pengiriman

```
DRAFT ──scan pulling──> PICKING ──tutup pulling──> PICKED
                                   PP02 (-) PP04 (+)

PICKED ──scan muat──> LOADING ──nyatakan berangkat──> SHIPPED
                                      PP04 (-)
```

Urutannya **ditegakkan**, bukan sekadar disarankan. Memuat barang yang belum
pernah diambil dari gudang berarti memotong stok dari staging yang isinya nol:
saldo PP04 menjadi minus, dan selisihnya baru ketahuan berbulan-bulan kemudian
saat tidak ada lagi yang ingat dokumen mana penyebabnya.

Sasaran tiap tahap juga berbeda. Saat pulling, sasarannya RENCANA. Saat memuat,
sasarannya yang BENAR-BENAR terambil — memuat lebih banyak daripada isi staging
tidak mungkin benar, berapa pun rencananya.

## Cara kerja lapisan SAP

```
perpindahan barang  ──>  TT_STOCK_MUTATION  ──pengumpul──>  TT_SAP_OUTBOX
                                                                 │
                                                            pengirim
                                                                 v
                                                       MS SQL  ──>  SAP
```

### Mengumpulkan, bukan mencatat saat kejadian

Alternatifnya memanggil "catat ke outbox" di enam service berbeda —
penerimaan, transfer, pulling, pengiriman, scan produksi, backflush. Enam
tempat yang harus diingat, dan yang ketujuh pasti terlupa.

Pengumpul mencari dokumen yang belum punya baris outbox dengan `NOT EXISTS`,
bukan dengan penanda posisi terakhir. Penanda posisi punya lubang yang
terkenal: transaksi yang commit belakangan tetapi memperoleh id lebih kecil
akan terlewat, dan tidak ada yang memberitahu. `NOT EXISTS` ditambah unique
index pada (SOURCE_TABLE, SOURCE_ID, DOC_TYPE) membuat pengumpulan idempoten dan tidak
bisa bocor.

### Jeda mengendap

Dokumen baru dipertimbangkan bila mutasi terbarunya sudah lewat 60 detik.
Khusus hasil produksi, jeda saja tidak cukup: kolektor menunggu penanda
`backflushCompleted` pada scan sebelum membuat outbox. Ini mencegah konfirmasi
produksi dikirim ketika job konsumsi komponen masih tertunda.

### Tujuh status, dan SENT bukan garis akhir

| Status | Arti |
|--------|------|
| PENDING | belum didorong ke staging |
| SENT | sudah di staging, **menunggu** diproses SAP |
| CONFIRMED | SAP memproses dan berhasil — flag di staging bernilai OK |
| REJECTED | SAP menolak — flag bernilai gagal, perlu dilihat orang |
| FAILED | gagal teknis saat mendorong, akan dicoba lagi |
| HELD | movement type-nya belum diputuskan — sengaja ditahan |
| SKIPPED | memang tidak perlu dikirim |

`SENT` sengaja bukan status akhir. Yang menentukan dokumen selesai adalah flag
yang ditulis balik oleh SAP, bukan keberhasilan kita menulis barisnya.

`REJECTED` berdiri sendiri, terpisah dari `FAILED`: itu penolakan dari SAP,
bukan gangguan jaringan, dan mendorongnya ulang tanpa memperbaiki datanya hanya
akan ditolak lagi. Tombolnya pun berbeda — `/sap/retry` untuk kegagalan teknis,
`/sap/resend` untuk penolakan yang datanya sudah diperbaiki.

HELD dan SKIPPED juga dibedakan dari FAILED. Dokumen yang tertahan karena
menunggu keputusan bukan kegagalan teknis, dan mencampurnya membuat layar
pemantauan penuh "error" yang tidak ada yang bisa memperbaikinya.

Begitu movement type diisi, dokumen HELD dilepas sendiri pada putaran
berikutnya — tidak perlu disentuh satu per satu.

### Kunci idempoten diturunkan per BARIS

Outbox memberi satu kunci per dokumen (`TT_DELIVERY:1:DELIVERY`), sedangkan
staging menyimpan satu baris per perpindahan. Kunci baris dibentuk dengan
menambahkan id mutasinya di belakang, sehingga tetap sama setiap kali dokumen
yang sama didorong ulang.

Akibatnya pendorongan bisa diulang tanpa bahaya, termasuk ketika percobaan
sebelumnya berhasil separuh: baris yang sudah ada dilewati, yang belum ada
masuk. Tanpa kunci per baris, satu gangguan jaringan di tengah dokumen berarti
pilihannya hanya dua — menggandakan seluruh barisnya, atau membiarkan dokumen
itu tidak pernah lengkap.

### Preflight sebelum baris pertama ditulis

Struktur staging diperiksa terhadap `INFORMATION_SCHEMA` sebelum pendorongan
dimulai. Salah satu huruf pada nama kolom akan menggagalkan setiap dokumen satu
per satu, menghabiskan jatah percobaan, lalu menumpuk sebagai ratusan baris
FAILED — dan orang akan mengira datanya yang bermasalah, bukan konfigurasinya.

Preflight juga memeriksa apakah kolom kunci idempoten punya **unique index** di
sisi staging. Kalau tidak ada, pendorongan tetap jalan tetapi catatannya muncul
di `/staging/status`: tanpa indeks itu, satu pengiriman ulang akan menggandakan
dokumen di SAP, dan koreksinya harus dikerjakan manual oleh orang finance.

### TRANSFER_IN tidak dikirim

Perpindahan antar SLOC adalah SATU dokumen SAP yang memuat sisi keluar dan
sisi masuk sekaligus. Mengirim keduanya berarti stok berpindah dua kali.

### Koneksi staging terpisah dari MSSQL_*

`MSSQL_*` yang sudah ada menunjuk J922 dengan user `guest_ro`: baca-saja, untuk
MENARIK data mesin. Staging adalah sebaliknya — database lain, user yang boleh
MENULIS. Memakai satu set kredensial untuk dua arah berarti memberi hak tulis
pada koneksi yang seharusnya hanya membaca, dan itu hak yang tidak akan pernah
dicabut lagi setelah terlanjur diberikan.

`STAGING_*` karena itu berdiri sendiri. Lihat `.env.example`.

Koneksinya **lazy**: kolam dibangun saat pertama kali dibutuhkan, bukan saat
API start. API tidak boleh gagal start hanya karena SQL Server pabrik sedang
mati — dan di sistem lama, satu SQL Server yang tidak merespons membuat seluruh
request web ikut menggantung.

Karena alasan yang sama, `GET /staging/status` **melaporkan** keadaan terakhir
tanpa menyentuh jaringan. `?uji=true` yang benar-benar menyambung. Layar yang
gunanya memberitahu ada yang mati tidak boleh ikut mati.

## Mengisi nama tabel staging

Strukturnya sudah ada di sisi tim SAP, tetapi belum tertulis di repo ini. Nama
tabel dan kolom di `apps/api/src/staging/staging-tables.ts` **masih dugaan**.

Untuk mengisinya tanpa menunggu dokumen:

```bash
pnpm staging:introspect              # seluruh tabel di database staging
pnpm staging:introspect NAMA_TABEL   # kolom dan indeksnya
```

Perintah itu hanya membaca. Salin nama yang benar ke `staging-tables.ts`, atau
timpa lewat variabel `STAGING_COL_*` di `.env` supaya perbedaan penamaan antar
lingkungan tidak memaksa deploy ulang. Lalu periksa kecocokannya lewat
`GET /staging/status?uji=true`.

Nilai flag (`STAGING_FLAG_NEW` / `_OK` / `_ERROR`) harus **persis sama** dengan
yang dipakai program di sisi SAP. Kalau beda, dokumen yang sebenarnya sudah
diproses akan terlihat menggantung selamanya di layar pemantauan, dan tidak akan
ada yang menyadarinya.

## Tarik master belum bisa jalan

Kerangkanya sudah ada di `staging-pull.service.ts`, tetapi daftar
`SUMBER_MASTER` sengaja **kosong**. Menebak nama kolom master berarti diam-diam
menimpa data master yang benar dengan null.

Yang sudah dipastikan di kerangkanya:

- Tidak ada penghapusan. Baris yang hilang dari staging dibiarkan apa adanya —
  master yang dipakai transaksi lama tidak boleh lenyap hanya karena satu
  putaran tarik kebetulan mengembalikan hasil kosong, dan hasil kosong adalah
  bentuk paling umum dari query yang salah filter.
- Kolom yang tidak dipetakan tidak disentuh. Menyamakan "tidak dipetakan"
  dengan "kosongkan" berarti satu pemetaan yang belum lengkap menghapus data
  yang benar.
- `POST /staging/pull` bawaannya **uji coba** — melaporkan berapa baris yang
  akan berubah tanpa menulis apa pun. Menulis sungguhan harus diminta dengan
  `?uji=false`.
- BOM belum didukung: kuncinya majemuk (parent, child, tanggal berlaku) dan
  salah menimpanya mengubah hasil backflush ke belakang.

## Catatan dari pengerjaan

**Barcode produksi polos belum menambah stok.** `parseBarcode` memperlakukan
barcode tanpa pemisah `|` sebagai nomor seri saja, sehingga part-nya tidak
dikenali dan tidak ada mutasi yang ditulis. Barcode berformat
`PART|BACK|SERIAL|QTY` bekerja normal. Selama format sebenarnya di lapangan
belum dipastikan, sebagian scan produksi tidak akan pernah sampai ke SAP.

## Yang masih terbuka

- **Movement type SAP** untuk tiap jenis mutasi. Dugaan sementara sudah
  dituliskan di `packages/domain/src/sap-movement.ts` — 101 (GR), 311
  (transfer antar SLOC), 261 (pemakaian produksi), 601 (pengiriman), 551
  (scrap), 309 (penyesuaian). **Angka-angka itu BELUM dikonfirmasi tim SAP.**
  Salah movement type berarti salah akun GL: barangnya pindah dengan benar di
  gudang, tetapi jurnalnya masuk ke tempat yang keliru, dan itu baru ketahuan
  saat tutup buku.
- **Nama tabel dan kolom di staging.** Strukturnya sudah ada di sisi tim SAP;
  yang tertulis di `staging-tables.ts` masih dugaan. Jalankan
  `pnpm staging:introspect` untuk membacanya langsung dari sumbernya. Sisi
  staging juga perlu **unique index pada kolom kunci idempoten** — itulah yang
  menahan dokumen dobel saat jaringan tersendat, bukan logika di sisi kita.
- **Pemetaan kolom master** untuk `SUMBER_MASTER`, supaya arah tarik bisa
  dinyalakan.
- **Apakah `QTY` di staging tanpa tanda.** Sekarang kita mengirim nilai mutlak,
  dengan arah dibawa oleh movement type — itu kebiasaan SAP MM, tetapi perlu
  dipastikan cocok dengan program di sisi sana.
- **Apakah satu dokumen per scan produksi terlalu banyak.** Sekarang tiap scan
  menghasilkan satu dokumen SAP. Kalau volumenya memberatkan, pengelompokan per
  shift atau per jam bisa ditambahkan di pengumpul tanpa mengubah yang lain.
- Bagaimana kode SLOC di sini dipetakan ke plant + storage location SAP untuk
  dua pabrik yang berbeda.

---

## Struktur staging yang sebenarnya

Dibaca dari `aisinbisa_sap_stagging` pada 16 September 2026 lewat
`pnpm staging:introspect` — **32 tabel, 591 kolom**. Bagian di atas yang menyebut
"satu tabel movement generik" adalah dugaan awal dan sudah tidak berlaku.

### Tidak ada satu tabel tujuan

Staging memakai nama tabel yang SAMA dengan kita, jadi dorongan dilakukan per
jenis dokumen ke pasangan kepala + barisnya sendiri:

| Jenis dokumen | Tabel di staging | Status |
|---|---|---|
| Perpindahan SLOC | `TT_GOODS_MOVEMENT_H` / `_L` | **sudah dipetakan** |
| Penerimaan | `TT_PURCHASE_RECEIPT_H` / `_L` | belum |
| Pengiriman | `TT_DELIVERY` / `TT_DELIVERY_ITEM` | belum |
| Produksi | `TT_PRODUCTION_RESULT` | **sudah dipetakan**, menunggu validasi semantik SAP |
| Saldo per SLOC | `TT_PARTS_SLOC` | belum diputuskan |

Dokumen yang jenisnya belum dipetakan **DITAHAN**, bukan didorong ke tabel
perpindahan yang kebetulan ada. Penerimaan barang yang mendarat di
`TT_GOODS_MOVEMENT` akan diposting SAP sebagai perpindahan antar SLOC, dan
koreksinya manual oleh orang finance.

### Tidak ada kolom kunci idempoten

Kuncinya nomor dokumen: `INT_NUMBER` pada kepala, `INT_NUMBER` + `INT_NUMBER_ITEM`
pada baris. Id baris outbox dipakai apa adanya sebagai `INT_NUMBER` — nilainya
tidak pernah berubah, jadi dorongan ulang mengenai baris yang sama alih-alih
menggandakannya. Setiap INSERT dijaga `WHERE NOT EXISTS`.

Sisi staging masih perlu memberi **unique index pada (`INT_NUMBER`,
`INT_NUMBER_ITEM`)**. Preflight memeriksanya dan mencatat bila belum ada.

### Semuanya char(n) fixed-width

Nilai yang dibaca dari staging WAJIB di-trim — `CHR_PART_NO char(18)`
mengembalikan `"AV-12345-001      "`, dan membandingkannya dengan nomor part kita
tanpa trim akan selalu gagal, diam-diam. Helper `bersih()` di `staging-tables.ts`
dipakai untuk itu.

Tanggal disimpan sebagai `char(8)` YYYYMMDD dan jam sebagai `char(6)` HHMMSS di
kolom **terpisah**. Satu `DTM_OCCURRED_AT` kita mengisi dua kolom di sana.

### Prefiks tipe di staging tidak bisa dipercaya

`TT_PURCHASE_RECEIPT_L` punya `INT_RECQTY` bertipe **float** DAN `CHR_RECQTY`
bertipe **int** sekaligus; `CHR_RECEIPT_BOX` juga float, `CHR_MAN_MIN_PCS` varchar,
dan `FLT_QTY_BEFORE` memperkenalkan prefiks ketiga. Jangan pernah menyimpulkan
tipe dari prefiksnya — baca `INFORMATION_SCHEMA`.

Satu akibat yang perlu diingat: `INT_TOTAL_QTY` bertipe `int`, sedangkan
`FLT_QTY` kita `decimal`. Pemakaian material berkoma (kilogram) **dibulatkan**
saat didorong. Pembulatannya dilakukan di kode kita supaya terlihat, bukan
dibiarkan terjadi diam-diam di sisi SQL Server.

## Penamaan kolom Avicenna

Seluruh kolom kita mengikuti konvensi staging: **prefiks tipe + nama kolom
kapital**. 436 kolom di-rename pada 16 September 2026.

| Prefiks | Untuk |
|---|---|
| `CHR_` | varchar, char, text, enum, json |
| `INT_` | int, bigint, smallint, foreign key, primary key |
| `FLT_` | decimal, float, double |
| `DTM_` | timestamp, datetime, date, time |
| `FLG_` | boolean |

`DTM_` dan `FLG_` adalah tambahan kita: staging tidak punya tipe tanggal maupun
boolean sungguhan (keduanya `char`), jadi tidak ada prefiks yang bisa ditiru.
Prefiks di sini **mengikuti tipe yang sebenarnya** — berbeda dari staging, yang
prefiksnya sering salah.

Badan namanya mengikuti staging bila kolomnya benar-benar berisi hal yang sama:

| Avicenna | Staging |
|---|---|
| `TM_PARTS.CHR_PART_NO` | `CHR_PART_NO` |
| `TM_PARTS.CHR_PART_NAME` | `CHR_PART_NAME` |
| `TM_PARTS.CHR_PART_UOM` | `CHR_PART_UOM` |
| `TM_CUST.CHR_CUST_NO` | `CHR_CUST_NO` |
| `TM_VENDOR.CHR_SUPPLIER_ID` | `CHR_SUPPLIER_ID` |
| `TT_DELIVERY.CHR_DEL_NO` | `CHR_DEL_NO` |
| `TT_DELIVERY_ITEM.INT_ACTUAL_DEL` | `INT_ACTUAL_DEL` |
| `TT_LOT.CHR_BATCH_NO` | `CHR_BATCH_NO` |

Yang **tidak** disamakan adalah foreign key dan surrogate id. Staging tidak
punya id sama sekali — ia menyimpan kunci alami (`CHR_PART_NO char(18)`) di
tempat kita menyimpan `INT_PART_ID`. Menamainya `CHR_PART_NO` akan berbohong
soal isinya.

## Perintah

```bash
pnpm staging:introspect              # daftar tabel di staging
pnpm staging:introspect NAMA_TABEL   # kolom + indeksnya
pnpm staging:compare                 # peta field: kolom staging ← kolom kita
pnpm staging:compare --live          # + dibandingkan dengan staging sungguhan
```

`staging:compare --live` melaporkan kolom yang kita konfigurasikan tetapi tidak
ada, dan kolom `NOT NULL` di staging yang belum kita isi — dua hal yang masing-
masing akan menggagalkan setiap INSERT.
Perintah compare ini menampilkan peta transfer `TT_GOODS_MOVEMENT`; tabel
produksi diperiksa terpisah oleh preflight `TT_PRODUCTION_RESULT` saat pendorong
produksi dijalankan.

## Tarik master dari staging

Empat entitas dipetakan, dijalankan **berurutan** karena customer dan part harus
ada sebelum pemetaan nomor part customer bisa dicocokkan:

| Entitas | Sumber di staging | Kunci |
|---|---|---|
| CUSTOMER | `TM_CUST` | `CHR_CUST_NO` |
| VENDOR | `TM_VENDOR` | `CHR_SUPPLIER_ID` |
| PART | `TM_PROCESS_PARTS` ⨝ `TM_PARTS` | `CHR_PLANT` + `CHR_PART_NO` |
| CUSTOMER_PART | `TM_SHIPPING_PARTS` | `CHR_PART_NO` + `CHR_CUS_NO` |

```bash
# uji coba — tidak menulis apa pun, hanya melaporkan yang AKAN berubah
curl -X POST "$API/staging/pull"
# menulis sungguhan
curl -X POST "$API/staging/pull?uji=false"
```

### Kenapa PART digerakkan TM_PROCESS_PARTS, bukan TM_PARTS

`TM_PARTS` di staging **tidak punya kolom pabrik sama sekali**, sedangkan
`TM_PARTS` kita berkunci (pabrik, nomor part). Yang tahu sebuah part dibuat di
pabrik mana adalah `TM_PROCESS_PARTS` — jadi tabel itulah penggeraknya, dengan
`TM_PARTS` di-join untuk nama, satuan, dan back number.

Bila satu part dikerjakan di dua pabrik, ia memang menghasilkan dua baris di
sisi kita. Itu benar, bukan duplikat. Mengambil pabrik dengan `MIN()` akan
diam-diam menempatkan part di pabrik yang keliru, dan akibatnya baru terlihat
sebagai part yang muncul di layar scan lini yang salah.

### Empat kolom yang staging tidak sediakan

`PROCESS_TYPE`, `PART_TYPE`, `SOURCE_TYPE`, dan `TRACKING_MODE` tidak punya
padanan di staging, dan `CHR_PROCESS_TYPE` di sisi kita `NOT NULL` tanpa bawaan.
Nilai bawaan diisi dari `SUMBER_MASTER[].bawaan` dan **hanya dipakai saat part
baru dibuat** — part yang sudah ada tidak pernah ditimpa, sehingga koreksi manual
tidak hilang pada putaran berikutnya.

`TRACKING_MODE` khususnya perlu diperiksa orang: raw material yang dilebur
mustahil berseri, dan bawaan `SERIAL` akan salah untuknya.

### Baris yang dihapus di SAP dinonaktifkan, tidak dibuang

Flag `CHR_DEL_FLAG` / `CHR_FLAG_DELETE` yang tidak kosong berarti baris itu
dihapus di SAP. Di sisi kita `FLG_IS_ACTIVE` dimatikan, bukan barisnya dihapus —
transaksi lama masih menunjuk master ini, dan menghapusnya membuat riwayat
kehilangan nama part dan customer-nya.

## BOM tidak bisa ditarik

Dicari di seluruh 32 tabel staging: **tidak ada satu pun yang memuat struktur
induk-komponen.** `TM_PROCESS_PARTS` yang paling dekat, tetapi isinya routing
proses — work center, cycle time, lot size — bukan daftar material.

Selama itu belum disediakan, `TM_BOM` tetap dikelola di Avicenna. Backflush
lokal bergantung sepenuhnya padanya: tanpa BOM, scan produksi menambah barang
jadi tetapi tidak mengurangi komponennya di Avicenna. Perlakuan konsumsi pada
SAP perlu divalidasi tersendiri sebelum push produksi dinyalakan.

## Keadaan staging saat ini

Diperiksa 16 September 2026: **32 tabel, 591 kolom, 0 baris.** Strukturnya
lengkap, tetapi SAP belum mengisi apa pun — baik master maupun transaksi.

Dua akibat langsungnya:

1. Tarik master belum menarik apa pun. Kuerinya sudah diverifikasi jalan
   terhadap server sungguhan; yang belum ada datanya.
2. **Nilai flag masih tebakan.** Rencananya dibaca dari baris yang sudah pernah
   diproses SAP, tetapi tidak ada satu pun baris untuk dibaca. `N`/`S`/`E` di
   `STAGING_FLAG_*` harus dikonfirmasi tim SAP sebelum pendorongan dinyalakan.
