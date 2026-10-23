# Integrasi SAP dan Model SLOC

Keputusan di halaman ini diambil setelah membandingkan sistem ini dengan
_Inventory Flow & Mapping Integration Table_ milik MIS Dept PT. Aisin Indonesia
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
  `STAGING_PULL_ENABLED` berdiri sendiri. Tarik menyinkronkan master serta
  loading list hari aktif dari staging; status pulling/loading dan hasil scan
  tetap dimiliki MES.

### Pengiriman berasal dari staging

`TT_DELIVERY` dan `TT_DELIVERY_ITEM` adalah sumber kepala dan rencana item.
AVICENNA tidak menyediakan pembuatan atau pembatalan loading list manual.
Worker menyegarkan periode operasional aktif setiap lima menit; satu hari
pengiriman berlangsung pukul 06:00 sampai 06:00 hari berikutnya.

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

> **Kode SLOC di bawah sudah tidak dipakai.** Rantai ini apa adanya dari diagram
> MIS, dan ditinggalkan sebagai catatan asal-usul. Kode yang berlaku sekarang
> datang dari Tabel 6 blueprint dan berbeda tiap pabrik —
> `WH70/WP70/FG70/RE70` dan seterusnya; lihat
> [Storage location](#storage-location) di bawah.

```
Supplier → [WH00] → [WP01] → [PP02] → [PP04] → Customer
        (+)     (−)(+)    (−)(+)   (−)(+)   (−)
         1        2         3        4       5,6
```

| SLOC | Isi                     | Langkah masuk   | Langkah keluar           |
| ---- | ----------------------- | --------------- | ------------------------ |
| WH00 | Komponen & raw material | 1 Good Receipt  | 2 Good Movement          |
| WP01 | Work in process         | 2 Good Movement | 3 Production (backflush) |
| PP02 | Finish good             | 3 Production    | 4 Pulling                |
| PP04 | Staging & shipping      | 4 Pulling       | 6 Loading to truck       |

## Jarak ke diagram, per langkah

| #   | Langkah              | Keadaan                                                              |
| --- | -------------------- | -------------------------------------------------------------------- |
| 1   | Good Receipt         | Ada. Belum ada PO untuk dicocokkan.                                  |
| 2   | Good Movement        | Ada (`transfers`).                                                   |
| 3   | Production Result    | **Ada dan ber-SLOC.** WP01 (−) lewat backflush, PP02 (+) lewat scan. |
| 4   | Pulling / Shopping   | **Ada dan ber-SLOC.** PP02 (−) → PP04 (+) saat pulling ditutup.      |
| 5   | Delivery Preparation | Dikerjakan lewat SAP GUI — di luar cakupan sistem ini.               |
| 6   | Loading to Truck     | Ada sebagai loading list; stok keluar dari PP04. RFID gate belum.    |

## Yang sengaja berbeda dari diagram

Diagram itu memetakan **stok**. Sistem ini memetakan **stok DAN ketertelusuran**:
`bom_lines`, `genealogy`, `consumptions`, `lots`, `repairs`, `ng_dispositions`.
Tabel-tabel itu tidak punya padanan di diagram dan memang tidak perlu dikirim
ke SAP — SAP hanya butuh pergerakan stoknya.

Perbedaan ini disengaja. Menelusuri part NG sampai ke lot raw material adalah
alasan sistem ini dibangun; SAP tidak menyimpan jejak itu.

## Penamaan tabel dan kolom

Tabel memakai awalan **TM\_** (master) dan **TT\_** (transaksi), kolomnya HURUF
BESAR — mengikuti konvensi yang sudah dipakai di lingkungan PT. Aisin, supaya
skema ini bisa dibaca orang MIS tanpa kamus penerjemah.

Nama properti TypeScript TETAP camelCase. Drizzle memisahkan nama properti dari
nama kolom, jadi kode tetap menulis `parts.partNumber` sementara databasenya
menyimpan `TM_PARTS.PART_NUMBER`. Penggantian nama ini karena itu tidak
menyentuh satu baris pun kode query.

Nama dari diagram MIS dipakai APA ADANYA bila tabel kita memang benda yang
sama. Sisanya memakai awalan yang sama dengan aturan mereka.

| Diagram                                           | Di sini                                 |
| ------------------------------------------------- | --------------------------------------- |
| TM_PARTS                                          | `TM_PARTS`                              |
| TM_CUST                                           | `TM_CUST`                               |
| TM_VENDOR                                         | `TM_VENDOR`                             |
| TM_SHIPPING_PARTS                                 | `TM_SHIPPING_PARTS`                     |
| TM_KANBAN                                         | `TM_KANBAN` + `TT_KANBAN_EVENT`         |
| TT_PURCHASE_RECEIPT_H / \_L                       | `TT_PURCHASE_RECEIPT_H` / `_L`          |
| TT_GOODS_MOVEMENT_H / \_L                         | `TT_GOODS_MOVEMENT_H` / `_L`            |
| TT_DELIVERY / TT_DELIVERY_ITEM                    | `TT_DELIVERY` / `TT_DELIVERY_ITEM`      |
| TT_HISTORY_IN_LINE_SCAN                           | `TT_HISTORY_SCAN` (kind = PRODUCTION)   |
| TT_HISTORY_SCAN_KANBAN_SD                         | `TT_HISTORY_SCAN` (kind = DELIVERY)     |
| TT_PRODUCTION_RESULT                              | `TT_HISTORY_SCAN` + `TT_STOCK_MUTATION` |
| TM_VENDOR_PARTS                                   | _belum ada_                             |
| TT_PO_HEADER / TT_PO_LINE                         | _belum ada_                             |
| TT_ELINA_H / \_L                                  | _belum ada_                             |
| TT_SETUP_CHUTE, TT_DATA_TESTER, TT_ONE_WAY_KANBAN | _belum ada_                             |

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

| Status    | Arti                                                     |
| --------- | -------------------------------------------------------- |
| PENDING   | belum didorong ke staging                                |
| SENT      | sudah di staging, **menunggu** diproses SAP              |
| CONFIRMED | SAP memproses dan berhasil — flag di staging bernilai OK |
| REJECTED  | SAP menolak — flag bernilai gagal, perlu dilihat orang   |
| FAILED    | gagal teknis saat mendorong, akan dicoba lagi            |
| HELD      | movement type-nya belum diputuskan — sengaja ditahan     |
| SKIPPED   | memang tidak perlu dikirim                               |

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

### Koneksi staging terpisah dari MSSQL\_\*

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

## Dibaca dari Blueprint SAP PP AIIA, 6 Oktober 2026

Dokumen *Business Blueprint — Production Planning, Repetitive Manufacturing*
(NTT Data, versi 1.0 final) menjawab sebagian pertanyaan yang sebelumnya
tertulis sebagai dugaan di bawah. Yang berikut ini **bukan lagi tebakan**.

### Struktur organisasi

Company code **J922** (PT Aisin Indonesia Automotive). Tiga plant:

| plant | deskripsi | di sistem ini |
|---|---|---|
| 700 | AIIA Body | `TM_PLANT.CHR_SAP_CODE` pabrik BODY |
| 800 | AIIA Unit | pabrik UNIT |
| 900 | AIIA Electric | pabrik ELEC — belum punya lini maupun part |

**Plant 600 adalah AII**, perusahaan induk yang berbeda. Database staging
dipakai bersama, jadi angka itu MUNCUL di sana — dan mengisinya ke master
pabrik kita akan menarik seluruh master mereka ke dalam sistem ini.

### Storage location

| fungsi | Body | Unit | Electric |
|---|---|---|---|
| komponen | WH70 | WH80 | WH90 |
| SFG / WIP | WP70 | WP80 | WP90 |
| barang jadi | FG70 | FG80 | FG90 |
| reject / scrap | RE70 | RE80 | RE90 |

Area staging sebelum naik truk tidak ada di blueprint — menurut SAP barang
keluar langsung dari SLOC FG. Di sini ia tetap ada sebagai `ST70`/`ST80`/`ST90`
dengan awalan yang jelas bukan kode SAP.

### Tiga transaksi, itu saja

Modul PP di blueprint punya enam proses, dan hanya tiga yang menuntut kita
menulis ke staging:

| Proses blueprint | Pemicu | Yang kita dorong | Yang SAP lakukan |
| --- | --- | --- | --- |
| **PP-PE-01** Component Stock Transfer | scan kanban komponen | transfer **WH → WP** | transfer posting |
| **PP-PE-02** Semifinished Goods Production | scan kanban hasil | production confirmation | backflush + **GR ke WP** |
| **PP-PE-03** Finished Goods Production | scan kanban hasil | production confirmation | backflush + **GR ke FG** |
| **PP-PE-06** Cancel Production Booking | koreksi di sistem ini | tambah qty (defisit) / batalkan material document (surplus) | sesuai yang dikirim |
| PP-PE-04 / PP-PE-05 | — | **tidak ada** | SAP mengirim error COGI / transfer **ke kita** |

Konsekuensinya menentukan: **SAP hanya mengenal dua jenis posting produksi,
SFG dan FG.** Tidak ada tingkatan lain, dan Tabel 6 menegaskannya dengan hanya
empat SLOC per pabrik. Perhatikan `WP70` di sana dinamai **"SFG Body"**, bukan
"WIP" — satu SLOC itu menampung komponen yang di-stage DAN hasil setengah jadi.

### Peta lengkap: sembilan proses kita, lima bagian Electric

Tabel 16 *Person Responsible* menyebut bagian produksi tiap pabrik secara
lengkap — inilah daftar proses yang SAP kenal:

| Plant | Kode | Bagian |
| --- | --- | --- |
| 700 Body | INJ / PTG / ASY | Injection, Painting, Assembly |
| 800 Unit | DCT / MAC / ASY | Die Casting, Machining, Assembly |
| 900 Electric | MNT / INS / VAC / ANT | Mounting, Inspection, Vacuum, Antena |

Dipetakan ke jenis proses di sistem ini:

| Jenis proses di sini | Pabrik | Bagian SAP | Kelas hasil | GR mendarat di |
| --- | --- | --- | --- | --- |
| `MELTING` | 800 | — _tidak ada_ | — | tidak didorong |
| `CASTING_WIP` | 800 | DCT Die Casting | SFG | WP80 |
| `CASTING_FG` | 800 | DCT Die Casting | FG | FG80 |
| `MACHINING_WIP` | 800 | MAC Machining | SFG | WP80 |
| `MACHINING_FG` | 800 | MAC Machining | FG | FG80 |
| `ASSEMBLING_UNIT_FG` | 800 | ASY Assembly | FG | FG80 |
| `INJECTION_WIP` | 700 | INJ Injection | SFG | WP70 |
| `INJECTION_FG` | 700 | INJ Injection | FG | FG70 |
| `PAINTING_WIP` | 700 | PTG Painting | SFG | WP70 |
| `PAINTING_FG` | 700 | PTG Painting | FG | FG70 |
| `ASSEMBLING_BODY_FG` | 700 | ASY Assembly | FG | FG70 |
| `MOUNTING` | 900 | MNT Mounting | SFG | WP90 |
| `INSPECTION_WIP` | 900 | INS Inspection + ASY Assembly | SFG | WP90 |
| `INSPECTION_FG` | 900 | INS Inspection + ASY Assembly | FG | FG90 |
| `VACUUM_WIP` | 900 | VAC Vacuum | SFG | WP90 |
| `VACUUM_FG` | 900 | VAC Vacuum | FG | FG90 |
| `ANTENNA` | 900 | ANT Antena | SFG² | WP90 |
| `DELIVERY` | semua | — _modul SD_ | — | tidak didorong |

² **Antena tidak menutup rute**: part yang selesai di sana lanjut dirakit di
Assembling Body — pabrik yang berbeda. Inspection dan Vacuum sebaliknya, punya
lini FG masing-masing yang memang menutup rute.

Jadi yang menentukan kelas hasil di pabrik ini bukan pabriknya, melainkan LINI
tempat barang terakhir dikerjakan — persis seperti Casting dan Machining di
pabrik Unit. Mounting dan Antena tidak dipecah WIP/FG karena sepanjang yang
diketahui keduanya tidak punya pasangan lini FG; begitu ternyata punya, yang
bertambah dua nilai enum, bukan rancangan yang dibongkar.

**ASY Assembly ada di Tabel 16 blueprint tetapi TIDAK menjadi jenis proses
sendiri di sini**: di lapangan assembly Electric dikerjakan di lini yang sama
dengan Inspection. Dibuatkan jenis sendiri, ia akan menjadi kolom yang tidak
pernah dipakai di matriks rute dan nilai enum yang tidak pernah muncul di data
— lalu suatu hari ada yang mengisinya karena "ada di blueprint". Kalau SAP
membuat work center di bawah ASY untuk plant 900, pasangannya di sini
Inspection.

Keenam jenis proses Electric **sudah ada di enum** beserta rute prosesnya, tapi
pabrik 900 baru punya dua lini contoh — kode work center yang sebenarnya belum
kita ketahui, dan menebaknya berarti membuat master yang harus dibongkar lagi.

### Rute boleh melintasi pabrik — modelnya yang belum ada

Ada part yang setelah selesai di **Antena (plant 900)** lanjut dirakit di
**Assembling Body (plant 700)**. Urutan langkah sendiri memang disusun manual:
`PUT /routing/part/:id` menerima daftar proses **terurut sesuai jalannya
barang** dan membangkitkan `INT_SEQ_NO` 10, 20, 30, … dari urutan itu.

Yang belum ada adalah tempat menyimpan **pabrik per langkah**. `simpanRute()`
mencap setiap langkah dengan `part.plantId`, jadi rute di atas tersimpan dengan
langkah Assembling Body tercatat milik pabrik Electric — beserta SLOC pabrik
itu, `FG90` alih-alih `FG70`. Barang jadinya diterima di pabrik yang salah, dan
di SAP itu **plant** yang salah.

Karena itu keadaan ini **dilaporkan sebagai peringatan** pada hasil simpan rute
(bukan ditolak — rute yang belum bisa dinyatakan utuh tetap perlu disimpan):

```
ASSEMBLING_BODY tidak punya lini di pabrik part ini — lininya ada di BODY.
Rute lintas pabrik belum didukung: langkah ini akan tercatat milik pabrik part,
beserta SLOC pabrik itu
```

Dan di sisi SAP, perpindahan `WP90 → WP70` **bukan** transfer antar storage
location: plant adalah unit organisasi tersendiri, dan perpindahan antar plant
butuh stock transport order atau movement 301/303/305. `periksaTransferSloc()`
karena itu memeriksa pabrik LEBIH DULU daripada pola SLOC-nya — tanpa itu,
`WP90 → WP70` jatuh ke aturan "WIP → WIP" dan dilewati sebagai serah-terima
internal, padahal justru inilah satu-satunya perpindahan di rute itu yang HARUS
sampai ke SAP.

Dua model yang mungkin, dan pilihannya belum diambil:

| | Satu baris part, langkah lintas pabrik | Dua baris part + transfer antar plant |
| --- | --- | --- |
| Ketertelusuran | satu part id dari awal sampai akhir | genealogy harus menyambung dua part id |
| Padanan SAP | tidak ada — SAP tidak punya material lintas plant | **persis** seperti SAP: material di-extend ke dua plant, dipindahkan STO |
| Tarik master | bertentangan: `TM_PROCESS_PARTS` staging berkunci (part, plant) | sejalan — memang menghasilkan dua baris |
| Yang harus diubah | `plantId` per langkah, resolusi SLOC, validasi scan | dokumen perpindahan antar plant, penyambung genealogy |

### Satu pola penamaan untuk semua jenis proses

    NAMA_PROSES [_PABRIK] _VARIAN

| Bagian | Dipakai kapan | Contoh |
| --- | --- | --- |
| `_WIP` | lini yang hasilnya diteruskan ke langkah berikutnya | `CASTING_WIP` |
| `_FG` | lini yang menutup rute — di sinilah kanban ditempel | `PAINTING_FG` |
| `_PABRIK` | hanya pada Assembling, satu-satunya nama proses yang ada di lebih dari satu pabrik | `ASSEMBLING_UNIT_FG` |
| tanpa akhiran | proses yang memang hanya punya satu lini | `MELTING`, `MOUNTING`, `ANTENNA` |

Akhiran varian dipakai **hanya** bila prosesnya benar-benar punya dua lini yang
berbeda secara fisik. Menambahkannya pada yang tidak punya pasangan cuma
membuat nilai yang tidak pernah terpakai — dan nilai semacam itu cepat atau
lambat diisi seseorang.

Sempat ada tiga pola dalam satu daftar: Casting dan Machining memakai varian,
Injection dan Painting tanpa akhiran, Assembling memakai akhiran pabrik tanpa
varian. Orang jadi harus menghafal mana yang mana, padahal yang dibedakan selalu
hal yang sama: **lini mana**.

`db:selaraskan` ikut menegakkannya: untuk setiap proses `_WIP` yang terdaftar di
sebuah pabrik, pasangan `_FG`-nya didaftarkan juga. Tanpa itu kolomnya tidak
pernah muncul di matriks rute, dan rute yang berhenti di langkah itu tidak bisa
disusun sama sekali.

### Urutan jenis proses di enum TIDAK menentukan rute

Rute melekat pada part lewat `TM_PROCESS_PARTS.INT_SEQ_NO`, dan matriks rute
menyusunnya dari **urutan klik**. Yang diturunkan dari urutan `PROCESS_TYPES`
hanyalah urutan KOLOM di layar — pengelompokan per pabrik supaya enak dibaca.

Sempat tidak begitu: matriks dulu menyusun ulang rute dari urutan kolom, dan
akibatnya rute seperti Antena → Assembling Body mustahil dinyatakan. Setelah
urutan mengikuti klik, kolom bebas ditata menurut keterbacaan — karena itu
`ASSEMBLING_BODY` kembali berdampingan dengan Injection dan Painting, dan blok
Electric berdiri sendiri di belakangnya.

### SLOC hasil produksi datang dari material master, bukan dari kita

`TT_PRODUCTION_RESULT` tidak punya kolom storage location sama sekali — 24
kolom, tak satu pun SLOC. Sebabnya ada di blueprint: field **MRP 2 nomor 11,
_Production Storage Location_**, "menentukan default Storage Location untuk
proses penerimaan barang dari hasil produksi".

Artinya SLOC keluaran di rute kita bukan perintah, melainkan **janji**: kalau ia
berbeda dari isi material master, stok yang sama tercatat di dua tempat — FG80
di sini, WP80 di SAP — dan selisihnya tidak memunculkan galat apa pun. Yang bisa
diperiksa tanpa membaca SAP hanyalah kewajarannya, dan itu ditegakkan di master
(lihat `pastikanSlocSesuaiBlueprint`): hasil SFG mustahil benar bila mendarat di
SLOC barang jadi.

Daftar yang harus diminta ke tim SAP: **material ber-REM-profile Z001 per
plant, beserta Production Version dan Production Storage Location-nya.**

### Hanya satu perpindahan SLOC yang punya dokumen SAP

WH → WP, yaitu PP-PE-01. Sisanya tidak, masing-masing karena sebabnya sendiri —
dan ini ditegakkan `periksaTransferSloc()`:

| Perpindahan | Keputusan | Sebab |
| --- | --- | --- |
| WH → WP | **dikirim** | PP-PE-01 Component Stock Transfer |
| → FG | dilewati | barang jadi masuk lewat GR dari confirmation; 311 di atasnya membuat barang yang sama masuk dua kali |
| → RE | dilewati | SAP memposting sendiri dari qty NG pada baris hasil produksi |
| WP → WP | dilewati | serah-terima antar langkah internal terjadi di dalam satu SLOC WIP di SAP |
| FG → ST | dilewati | `ST70/ST80/ST90` tidak ada di SAP; menurut blueprint barang keluar langsung dari SLOC FG |
| pola lain | **ditahan** | pertanyaan untuk tim SAP, bukan keputusan kita |

Yang terakhir itu bukan kehati-hatian berlebihan: sebelum perbaikan ini, dokumen
pulling `FG80 → ST80` masuk antrean dengan movement 311 dan akan ditolak SAP
karena storage location-nya tidak dikenal — lalu menumpuk sebagai `REJECTED`
yang tidak ada yang bisa memperbaiki.

### NG: salurannya ada, isinya sengaja masih kosong

Blueprint PP-PE-02 dan PP-PE-03 langkah 6: *"Post to Storage Location
Scrapping — System | SAP (Background Job)"*. Jadi yang kita lakukan hanya
**melaporkan kuantitas NG**, dan salurannya sudah ada di staging berupa
`INT_NG_PRC` dan `INT_TOTAL_NG` pada baris hasil produksi yang sama.

Karena itu `NG_OUT` tidak lagi dikirim sebagai dokumen scrap tersendiri, dan
movement **551 dibuang** — bukan dipertahankan seperti 261. Dua hal pernah salah
sekaligus di sana: siapa yang memposting, dan arahnya. 551 adalah penghapusan
nilai, sedangkan blueprint menyebut barang NG **masuk** ke SLOC reject, dan
`RE70/RE80/RE90` ada di Tabel 6 sebagai SLOC sungguhan. Itu perpindahan, bukan
penghapusan.

Kedua kolom NG masih dikirim bernilai **0**, dan itu keputusan sadar. Dua
pertanyaan belum dijawab, dan salah menebaknya mengubah **angka goods receipt**
di SAP:

1. Pembagian keduanya — kalau SAP menjumlahkan `INT_NG_PRC` dan `INT_TOTAL_NG`,
   mengisi angka yang sama di dua kolom berarti scrap dua kali lipat.
2. Hubungannya dengan `INT_QTY_OK` dan `INT_TOTAL_QTY` — bila SAP meng-GR
   sebesar `TOTAL_QTY - TOTAL_NG`, mengisi NG tanpa menaikkan `TOTAL_QTY`
   membuat penerimaan barang jadi berkurang tanpa sebab.

Yang berbahaya bukan keadaan itu, melainkan diamnya. Karena itu
**`GET /sap/ng-perlu-koreksi`** mendaftar NG yang hasil produksinya sudah
dikonfirmasi SAP — stok di sana lebih banyak daripada yang ada di lantai, dan
koreksinya PP-PE-06 yang dikerjakan orang di SAP. Minimal angkanya terlihat,
bukan menjadi selisih yang baru ketemu saat stock opname.

### Backflush diposting SAP, bukan oleh kita

REM Profile **Z001** berparameter **"GI Backflush at GR Posting"**: begitu hasil
produksi diposting sebagai goods receipt, SAP sendiri mengurangi komponen
sesuai BOM. Karena itu `CONSUMPTION_OUT` di `sap-movement.ts` diberi
`kirim: false`. Mengirimnya berarti komponen terpotong DUA KALI, tanpa galat
apa pun yang muncul.

### Production Version sebagai syarat kanban

Blueprint PP-MD-05 langkah 1: Project Control memastikan dulu Production
Version material tersedia dan valid, **baru** kartunya dibuat. Di SAP sebuah
Production Version adalah pasangan BOM + Rate Routing untuk satu material di
satu plant, bernomor `0001`, `0002`, dan seterusnya.

Di sini ia tersimpan di DUA tempat, dan itu disengaja:

| Kolom | Isi | Kenapa |
| --- | --- | --- |
| `TM_PARTS.CHR_PRODUCTION_VERSION` | versi material sekarang | satu part punya ribuan kartu; mengetiknya satu per satu adalah cara paling pasti membuat sebagian kartu memakai versi berbeda tanpa ada yang menyadarinya |
| `TM_KANBAN.CHR_PRODUCTION_VERSION` | versi yang dipakai saat kartu ini dibuat | **disalin, bukan dirujuk** |

Salinan itu yang membuatnya berguna: begitu versi material diganti, kartu yang
sudah beredar tetap menyatakan versi yang BENAR-BENAR dipakai membuatnya.
Merujuk akan membuat seluruh riwayat ikut berubah secara surut — dan riwayat
yang berubah sendiri tidak bisa dipakai menjawab apa pun.

Kartu **internal** tidak bisa dibuat bila part-nya belum punya versi; pesannya
menunjuk master Part, bukan formulir kartu, sebab di situlah yang harus
dibetulkan. Kartu **customer** dikecualikan: label DN yang didaftarkan otomatis
saat scan adalah milik customer, bukan master kanban kita, dan mewajibkannya
akan menghentikan scan pengiriman.

**Yang belum:** versinya diketik orang. Blueprint menyebut SAP sebagai
pemiliknya dan akan mendorongnya ke sistem ini, tetapi spesifikasi antarmukanya
termasuk yang masih harus diminta.

### Satu singkatan yang berarti dua hal berbeda

`CHR_PV` di staging — pada `TM_PROCESS_PARTS` (kunci `CHR_PART_NO` + `CHR_PV`)
dan pada `TT_PRODUCTION_RESULT` — **belum dipastikan** apakah ia Production
Version atau nomor urut langkah.

Yang mendukung "nomor urut langkah": satu part yang melewati empat proses
menghasilkan empat baris, dan tiap baris punya work center serta SLOC tujuan
sendiri. Yang mendukung "Production Version": namanya, lebarnya char(4), dan
bentuk nilainya (`0001`, `0002`) — di SAP sebuah Production Version memang
bernomor begitu, dan ia memang membawa routing.

Keduanya menghasilkan nilai yang mirip, dan itulah yang membuat perbedaannya
mudah terlewat. Kita **tidak pernah mengisi** `CHR_PV` saat mendorong hasil
produksi — kolomnya dipetakan tetapi dibiarkan kosong — jadi sampai sekarang
tidak ada data salah yang terkirim. Yang perlu dipastikan tim SAP: kolom itu
menunggu yang mana, dan apakah membiarkannya kosong membuat SAP memilih versi
bawaan atau menolak barisnya.

### Cycle time ada di SAP

Standard Value Key **Z002** pada Rate Routing: `ZCT001` Cycle Time, `ZMT001`
Machine Time, `ZMAN01` Man Hour — seluruhnya dalam menit. Master cycle time di
sini nantinya disinkronkan dari sana, bukan diketik ulang.

### Yang diserahkan blueprint kepada sistem ini

Setiap kali dokumen itu menulis "Third-Party System", yang dimaksud adalah
Avicenna:

- pembuatan master kanban dan pencetakan kartunya (PP-MD-05), dengan
  **Production Version dari SAP sebagai syarat** — sudah ada, lihat bagian
  tersendiri di bawah;
- klasifikasi kanban **cyclic** (kartu berputar, kembali ke available) atau
  **one-way** (sekali pakai lewat procurement);
- scan kanban sebagai pemicu seluruh posting: stock transfer, confirmation,
  backflush;
- pencatatan NG, keputusan rework, dan posting scrap ke SLOC `RE*`;
- **menampilkan error COGI milik SAP di layar kita** (PP-PE-04, PP-PE-05) —
  interface arah MASUK yang belum ada sama sekali;
- **Cancel Production Booking** (PP-PE-06): koreksi dilakukan di sini, lalu
  dikirim ke SAP sebagai penambahan kuantitas (defisit) atau pembatalan
  material document (surplus).

### Yang masih harus diminta

Tabel *Interfaces* dan Appendix A di blueprint itu **kosong**, sedangkan tabel
gap analysis berulang kali menulis "copy dan penyesuaian development/interface
existing dari AII". Artinya spesifikasi antarmukanya sudah ada di AII dan harus
diminta, bukan dirancang ulang: pemetaan field, nilai flag status, isi
`CHR_TYPE_TRANS`, dan apakah program penjemput di sisi SAP menyaring per plant.

## Yang masih terbuka

- **Movement type SAP** untuk tiap jenis mutasi. **311 sudah TERBUKTI** dari
  data AII — lihat bagian 23 Oktober. Yang belum: 101 (GR), 601 (pengiriman),
  309 (penyesuaian). Angka-angka itu **BELUM dikonfirmasi tim SAP**, kecuali 261 yang disebut blueprint sebagai
  movement konsumsi komponen — dan itu pun diposting SAP sendiri lewat
  backflush, bukan oleh sistem ini. Angka 551 untuk scrap sudah DIBUANG, bukan
  sekadar belum dikonfirmasi: blueprint menyebut barang NG masuk ke SLOC reject,
  yang berarti perpindahan, bukan penghapusan nilai.
  Salah movement type berarti salah akun GL: barangnya pindah dengan benar di
  gudang, tetapi jurnalnya masuk ke tempat yang keliru, dan itu baru ketahuan
  saat tutup buku.
- **Kontrak Good Issue dan penerbitan DO.** Selesai loading saat ini membuat
  `DELIVERY_OUT` dan mengantrekannya sebagai dokumen `DELIVERY`/movement 601.
  Endpoint atau tabel staging yang benar untuk posting GI, flag suksesnya,
  serta nomor DO yang diterbitkan SAP belum dikonfirmasi. Nomor DO tidak boleh
  dibuat sendiri oleh MES; ia harus disimpan dari balasan SAP setelah kontrak
  integrasinya disepakati.
- **Nama tabel dan kolom di staging.** Strukturnya sudah ada di sisi tim SAP;
  yang tertulis di `staging-tables.ts` masih dugaan. Jalankan
  `pnpm staging:introspect` untuk membacanya langsung dari sumbernya. Sisi
  staging juga perlu **unique index pada kolom kunci idempoten** — itulah yang
  menahan dokumen dobel saat jaringan tersendat, bukan logika di sisi kita.
- **Pemetaan kolom master** untuk `SUMBER_MASTER`, supaya arah tarik bisa
  dinyalakan.
- ~~**Arti `CHR_PV`**~~ — TERJAWAB data AII: Production Version. Kini diisi dari
  `TM_PARTS.CHR_PRODUCTION_VERSION`.
- **Isi `CHR_TYPE_TRANS`.** AII memakai `SUBC` di kepala dan `FGDL` di baris;
  kita menulis jenis dokumen kita sendiri (`TRAN`, `PROD`). Nilai apa yang
  diharapkan program penjemput?
- **Nilai flag GAGAL.** Contoh dari AII tidak memuat satu pun baris yang
  ditolak SAP, jadi `STAGING_FLAG_ERROR` masih dugaan.
- **Lewat mana NG sampai ke SAP di AII?** Keenam kolom NG di
  `TT_PRODUCTION_RESULT` bernilai 0 pada seluruh contoh.
- **Menarik Production Storage Location** dari `TM_PROCESS_PARTS.CHR_SLOC_TO`,
  supaya SLOC keluaran rute kita tidak lagi perlu dicocokkan dengan tangan.
- **Sumber Production Version.** Blueprint menyebut SAP pemiliknya dan akan
  mendorongnya ke sistem ini; sampai antarmukanya ada, versinya diketik orang
  di master Part.
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

| Jenis dokumen    | Tabel di staging                   | Status                                              |
| ---------------- | ---------------------------------- | --------------------------------------------------- |
| Perpindahan SLOC | `TT_GOODS_MOVEMENT_H` / `_L`       | **sudah dipetakan**                                 |
| Penerimaan       | `TT_PURCHASE_RECEIPT_H` / `_L`     | belum                                               |
| Pengiriman       | `TT_DELIVERY` / `TT_DELIVERY_ITEM` | belum                                               |
| Produksi         | `TT_PRODUCTION_RESULT`             | **sudah dipetakan**, menunggu validasi semantik SAP |
| Saldo per SLOC   | `TT_PARTS_SLOC`                    | belum diputuskan                                    |

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

| Prefiks | Untuk                                           |
| ------- | ----------------------------------------------- |
| `CHR_`  | varchar, char, text, enum, json                 |
| `INT_`  | int, bigint, smallint, foreign key, primary key |
| `FLT_`  | decimal, float, double                          |
| `DTM_`  | timestamp, datetime, date, time                 |
| `FLG_`  | boolean                                         |

`DTM_` dan `FLG_` adalah tambahan kita: staging tidak punya tipe tanggal maupun
boolean sungguhan (keduanya `char`), jadi tidak ada prefiks yang bisa ditiru.
Prefiks di sini **mengikuti tipe yang sebenarnya** — berbeda dari staging, yang
prefiksnya sering salah.

Badan namanya mengikuti staging bila kolomnya benar-benar berisi hal yang sama:

| Avicenna                          | Staging           |
| --------------------------------- | ----------------- |
| `TM_PARTS.CHR_PART_NO`            | `CHR_PART_NO`     |
| `TM_PARTS.CHR_PART_NAME`          | `CHR_PART_NAME`   |
| `TM_PARTS.CHR_PART_UOM`           | `CHR_PART_UOM`    |
| `TM_CUST.CHR_CUST_NO`             | `CHR_CUST_NO`     |
| `TM_VENDOR.CHR_SUPPLIER_ID`       | `CHR_SUPPLIER_ID` |
| `TT_DELIVERY.CHR_DEL_NO`          | `CHR_DEL_NO`      |
| `TT_DELIVERY_ITEM.INT_ACTUAL_DEL` | `INT_ACTUAL_DEL`  |
| `TT_LOT.CHR_BATCH_NO`             | `CHR_BATCH_NO`    |

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

| Entitas       | Sumber di staging               | Kunci                        |
| ------------- | ------------------------------- | ---------------------------- |
| CUSTOMER      | `TM_CUST`                       | `CHR_CUST_NO`                |
| VENDOR        | `TM_VENDOR`                     | `CHR_SUPPLIER_ID`            |
| PART          | `TM_PROCESS_PARTS` ⨝ `TM_PARTS` | `CHR_PLANT` + `CHR_PART_NO`  |
| CUSTOMER_PART | `TM_SHIPPING_PARTS`             | `CHR_PART_NO` + `CHR_CUS_NO` |

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

---

## Data SAP AII sungguhan, 23 Oktober 2026

Handika mengirim isi lima tabel staging dari sistem AII yang berjalan — plant
600, transaksi 30 September 2026. Ini pertama kalinya kita melihat BARIS, bukan
hanya struktur. Yang berikut bukan lagi dugaan.

### Nilai flag, akhirnya pasti

| Kolom | Berhasil | Belum diproses |
| --- | --- | --- |
| `CHR_STATUS` | `S` | **NULL** |
| `CHR_MESSAGE` | `Success` (goods movement), kosong (produksi) | NULL |
| `CHR_MATDOC` | nomor dokumen material 10 digit | NULL |
| `CHR_UPLOAD` | `X` (produksi) · `1` (goods movement) | `-` |
| `CHR_PICK_STATUS` | `S` | — |

Tebakan `S` untuk berhasil **benar**. Tebakan `N` untuk baris baru **salah**:
baris yang belum diproses CHR_STATUS-nya NULL. Kita tidak lagi menulis `N` ke
sana — kalau penjemput di sisi SAP menyaring dengan `CHR_STATUS IS NULL`, baris
bernilai `N` tidak akan pernah terjemput, dan diamnya sempurna.

Nilai GAGAL masih tidak diketahui: contohnya hanya memuat baris yang berhasil.

### `CHR_VALIDATE` — yang paling menentukan, dan selama ini tidak kita tulis

Pada 52 baris `TT_PRODUCTION_RESULT`, korelasinya sempurna:

```
CHR_VALIDATE = X  →  CHR_UPLOAD = X, CHR_STATUS = S, CHR_MATDOC terisi
CHR_VALIDATE = Y  →  CHR_UPLOAD = -, CHR_STATUS NULL, tanpa dokumen material
```

Dan ini bukan soal waktu: baris `Y` yang masuk pukul 06:24:19 tetap kosong,
sementara baris `X` yang masuk pukul 06:24:41 terproses pada batch 06:30:07
yang sama. **Yang membedakan flag-nya, bukan urutannya.**

Seluruh baris `TT_GOODS_MOVEMENT_H` pun bernilai `X`.

Kita **tidak pernah menulis kolom ini**. Kalau ia memang penyaring penjemput,
setiap dokumen yang kita dorong akan duduk di staging tanpa pernah disentuh —
dan di layar pemantauan terlihat sebagai `SENT` selamanya, sebab `SENT` memang
berarti "sudah di staging, menunggu SAP". Sekarang ditulis `X`.

Masih mungkin ia sekadar keadaan internal aplikasi AII yang kebetulan selalu
sejalan. Tetapi kita tidak punya langkah validasi terpisah, jadi menulis `X`
benar dalam kedua tafsir.

### `CHR_PV` adalah Production Version, bukan urutan langkah

Catatan 5 Oktober menyebutnya "urutan langkah (0001, 0002, …)". Data
membantahnya: ada part yang baris SATU-SATUNYA bernilai `0002`
(`41133111050B0`) atau `0003` (`41134012260`). Nomor urut langkah mustahil
berperilaku begitu — sebuah part selalu punya langkah pertama.

Artinya `TM_PROCESS_PARTS` bukan tabel rute berisi satu baris per langkah,
melainkan **master Production Version**: satu baris per (part, versi), membawa
work center, SLOC keluaran, cycle time, dan lot size untuk versi itu. Persis
pengertian Production Version di SAP — pasangan BOM dan Rate Routing.

Dua akibat langsung:

- `TT_PRODUCTION_RESULT.CHR_PV` kini kita isi dari
  `TM_PARTS.CHR_PRODUCTION_VERSION`. Kosong bila part-nya belum punya versi —
  **tidak** diisi `0001`, sebab menebak versi berarti hasil produksi dibukukan
  terhadap pasangan BOM dan routing yang belum tentu dipakai.
- `TM_PROCESS_PARTS.CHR_SLOC_TO` adalah **Production Storage Location** per
  versi. Pertanyaan "SLOC mana yang dipakai SAP saat GR" — yang di blueprint
  hanya muncul sebagai field MRP 2 nomor 11 — ternyata bisa dibaca dari staging.
  Belum kita tarik; lihat daftar terbuka.

### Movement type dan jenis transaksi

| Nilai | Dipakai untuk |
| --- | --- |
| `311` | perpindahan antar SLOC — `PP02→PP04`, `PP03→PP04`, `WH00→PP04` |
| `541` | kirim ke subkontraktor |
| `542` | pembatalan kiriman subkontraktor |

Tebakan `311` untuk transfer antar SLOC **benar**. `CHR_TYPE_TRANS` berisi
`SUBC` di kepala dan `CHR_TYPE_TRANS_L` berisi `FGDL` di baris — keduanya
kosakata SAP/AII, sedangkan kita menulis jenis dokumen kita sendiri (`TRAN`,
`PROD`). Itu masuk daftar pertanyaan: nilai apa yang mereka harapkan.

`INT_TOTAL_QTY` selalu positif — arah dibawa movement type, seperti dugaan kita.

### Yang ternyata sudah benar

- **Qty produksi.** Pada SELURUH 52 baris, `INT_ACTUAL` = `INT_QTY_OK` =
  `INT_TOTAL_QTY`. Perilaku kita sama.
- **NG.** Keenam kolom NG (`INT_NG_PRC`, `INT_NG_BRKNTEST`, `INT_NG_SETUP`,
  `INT_NG_TRIAL`, `INT_NG_OTHERS`, `INT_TOTAL_NG`) bernilai 0 di semua baris.
  Jadi **AII pun tidak melaporkan NG lewat tabel ini**, dan nilai 0 kita bukan
  kekurangan melainkan sama dengan sistem yang berjalan. Pertanyaannya berubah:
  lewat mana NG sampai ke SAP di AII?
- **SLOC AII**: `WH00`, `PP01`, `PP02`, `PP03`, `PP04` — persis kode lama kita,
  yang memang disalin dari sana. Blueprint menggantinya untuk AIIA.

### Yang ternyata tidak terpakai

`INT_FLG_METHODS`, `INT_IS_SCAN_CUST_KANBAN`, `INT_CYCLE_TIME`, `INT_MP`
bernilai 0 di seluruh baris; `CHR_LOTSIZE`, `CHR_STDDAY`, `CHR_FLAG_ACTIVE`
seluruhnya NULL. Jadi legenda `INT_FLG_METHODS` yang kita tunggu kemungkinan
besar tidak pernah ada isinya — metode scan tidak bisa ditarik dari SAP, dan
master kita sendiri yang memegangnya.

### Work center

`TM_PROCESS` AII memakai `CHR_PERSON_RESPONSIBLE` berupa ANGKA (`011`–`014`),
sedangkan blueprint AIIA memakai huruf (`INJ`, `PTG`, `ASY`, `DCT`, `MAC`,
`MNT`, `INS`, `VAC`, `ANT`). Kode work center 6–7 karakter dengan awalan dua
huruf: `AS`/`SA` assembly, `WE` welding, `PR` press, `PK` packing, `MA`, `BD`,
`RF`. `CHR_AREA` berbentuk `CC-001`, `ASWE-002`, `STP-003`.

Dua baris cacat yang perlu diingat saat menarik: `ASSR01` punya `CHR_AREA`
berisi kode work center (`PK0002`), dan `ASPD01` area-nya kosong. Penarik tidak
boleh menganggap area selalu berbentuk `XX-999`.

### Satu hal yang perlu ditanyakan untuk AIIA

Di AII, `311` dipakai juga untuk **pulling barang jadi ke PP04** (staging
sebelum truk) dengan `CHR_TYPE_TRANS_L = FGDL`. Daftar SLOC AIIA di blueprint
tidak punya padanan PP04 — hanya WH/WP/FG/RE. Jadi entah langkah itu tidak ada
di AIIA, entah SLOC staging akan ditambahkan. Sampai jelas, dokumen pulling
`FG→ST` kita tetap dilewati dengan sebabnya tertulis.

## Pembacaan ulang struktur staging, 5 Oktober 2026

Dibaca lagi dari `172.18.3.19 / A_DB_STG` — **34 tabel** (sebelumnya 32). Yang
baru dan penting: `TM_PROCESS`. Data contoh dari server LIVE dikirim Handika
berupa tangkapan layar; strukturnya sama persis dengan server dev ini, hanya
dev-nya masih 0 baris.

### TM_PROCESS_PARTS bukan sekadar daftar part

Kuncinya **(CHR_PART_NO, CHR_PV)** — satu baris per LANGKAH proses, bukan per
part. Isinya jauh lebih kaya daripada yang kita duga:

| Kolom | Isi | Padanan di sini |
|---|---|---|
| `CHR_PV` char(4) | urutan langkah (0001, 0002, …) | `TM_PROCESS_PARTS.INT_SEQ_NO` |
| `CHR_WORK_CENTER` char(8) | work center langkah itu | `TM_LINE` — **pemetaannya belum ada** |
| `CHR_SLOC_TO` char(6) | SLOC tujuan langkah itu | SLOC keluar per proses |
| `INT_FLG_METHODS` int | metode scan langkah itu | `CHR_SCAN_MODE` — **artinya belum diketahui** |
| `INT_IS_SCAN_CUST_KANBAN` int | apakah kanban customer discan | belum dipakai |
| `INT_CYCLE_TIME`, `INT_MP`, `CHR_LOTSIZE`, `CHR_STDDAY` | data perencanaan | belum dipakai |

Dua akibat langsung, keduanya sudah diperbaiki:

1. **Tarik PART menghasilkan duplikat.** Part yang melewati empat proses
   menghasilkan empat baris identik; satu putaran `TOP (n)` habis oleh duplikat.
   Sekarang dikelompokkan per (pabrik, part), dan penanda hapus memakai MIN —
   part dianggap terhapus hanya bila SELURUH langkahnya terhapus.
2. **Pabrik dicocokkan ke kolom yang salah.** `CHR_PLANT` berisi kode SAP
   (`600` pada data nyata — itu milik AII), sedangkan kita mencocokkannya ke `TM_PLANT.CHR_CODE`
   yang berisi "UNIT"/"BODY". Dengan data nyata, SETIAP part akan dilewati dan
   tarik master melaporkan "berhasil, 0 baris". Sekarang dicocokkan ke
   `CHR_SAP_CODE` lebih dulu, dan yang tidak cocok dicatat sebagai peringatan.

`CHR_PART_UOM` char(40) juga dipotong ke 16 karakter saat dibaca, mengikuti
lebar kolom kita.

### TM_PROCESS = master work center

Enam kolom: `CHR_PLANT`, `CHR_WORK_CENTER` char(10), `CHR_PERSON_RESPONSIBLE`,
`CHR_FLAG_DELETE`, `CHR_DATE`, `CHR_AREA`. Kunci (work center, person
responsible). Inilah padanan `TM_LINE` kita — contoh isinya MADS05, PK0006,
ASCD01, SACD01, dengan area CC-001, CD-001, ASWE-002, DL-008.

Perhatikan lebarnya tidak konsisten di sisi SAP: `CHR_WORK_CENTER` char(8) di
`TM_PROCESS_PARTS` dan `TM_KANBAN`, tetapi char(10) di `TM_PROCESS` dan
`TT_PRODUCTION_RESULT`. Kode work center yang lebih dari 8 karakter tidak akan
pernah cocok dengan rutenya.

### Yang sudah terjawab

- **Unique index sudah ada** di kedua tabel dorongan: `PK_TT_GOODS_MOVEMENT_H_1`
  pada `INT_NUMBER`, `PK_TT_GOODS_MOVEMENT_L_1` pada `INT_NUMBER + INT_NUMBER_ITEM`,
  dan `INT_NO` pada `TT_PRODUCTION_RESULT.INT_NUMBER`. Permintaan ke tim SAP soal
  ini sudah tidak berlaku.
- **Kolom NOT NULL hanya kuncinya**, jadi INSERT kita tidak akan gagal karena
  kolom wajib yang tidak diisi.
- `TT_PRODUCTION_RESULT.CHR_DATE` memang char(10) — format `YYYY-MM-DD` yang
  sudah kita kirim benar. `CHR_PLANT` di tabel itu char(4), berbeda dari char(3)
  di `TT_GOODS_MOVEMENT_H`.

### Yang masih menunggu jawaban

1. **Arti `INT_FLG_METHODS`.** Angka berapa berarti metode apa. Pada contoh live
   semuanya 0. Tanpa legenda ini, metode scan tidak bisa ditarik dari SAP.
2. **Pemetaan work center → lini kita.** Kode SAP (MADS05, ASCD01) berbeda dari
   kode kita (DC-01, MC-01), dan jenis proses tidak ada di staging.
3. ~~**Kode SAP tiap pabrik.**~~ TERJAWAB blueprint: 700 Body, 800 Unit,
   900 Electric. (`600` milik AII.) Catatan lama: `TM_PLANT.CHR_SAP_CODE`
   untuk UNIT dan BODY harus diisi sebelum tarik maupun dorong bisa jalan.
