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

### 2. Kita MENDORONG, SAP mengonsumsi

Arahnya bukan SAP menarik dari MySQL kita, melainkan kita menulis ke tabel di
**MS SQL Server**, lalu SAP membacanya dari sana.

Konsekuensi yang menentukan rancangan:

- Perlu **outbox**: baris yang siap dikirim, beserta statusnya. Menulis
  langsung ke MS SQL di dalam transaksi produksi tidak bisa dilakukan — dua
  database berbeda, dan kalau MS SQL sedang mati, scan di lantai produksi tidak
  boleh ikut gagal.
- Perlu **kunci idempoten lintas sistem**. Pengiriman ulang saat jaringan
  tersendat harus bisa dikenali di sisi MS SQL, bukan menghasilkan dokumen
  dobel.
- Perlu **status posting** per dokumen: belum dikirim, terkirim, ditolak SAP,
  beserta pesan penolakannya. Tanpa itu, dokumen yang ditolak SAP akan hilang
  diam-diam dan selisih stoknya baru ketahuan saat stock opname.

### 3. Model SLOC diadopsi seluruhnya

Setiap perpindahan barang adalah **sepasang** mutasi: (−) di SLOC asal dan (+)
di SLOC tujuan. Ini yang membuat angka per SLOC di sini bisa dicocokkan dengan
angka di SAP.

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

## Pemetaan tabel

| Diagram | Di sini |
|---------|---------|
| TM_PARTS, TM_CUST | `parts`, `customers` |
| TM_VENDOR | `suppliers` |
| TM_VENDOR_PARTS | *belum ada* |
| TM_SHIPPING_PARTS | `customer_parts` |
| TM_KANBAN | `kanbans` + `kanban_events` |
| TT_PO_HEADER / TT_PO_LINE | *belum ada* |
| TT_PURCHASE_RECEIPT_H / _L | `receipts` / `receipt_lines` |
| TT_ELINA_H / _L | *belum ada* |
| TT_GOODS_MOVEMENT_H / _L | `transfers` / `transfer_lines` + `mutations` |
| TT_PRODUCTION_RESULT | `scan_events` + `mutations` |
| TT_HISTORY_IN_LINE_SCAN | `scan_events` (kind = PRODUCTION) |
| TT_SETUP_CHUTE, TT_DATA_TESTER, TT_ONE_WAY_KANBAN | *belum ada* |
| TT_DELIVERY / TT_DELIVERY_ITEM | `deliveries` / `delivery_lines` |
| TT_HISTORY_SCAN_KANBAN_SD | `scan_events` (kind = DELIVERY) |

## Urutan pengerjaan

1. ~~**SLOC pada produksi**~~ — selesai. `lines.inputLocationId` / `outputLocationId`
   menentukan SLOC asal dan tujuan tiap line.
2. ~~**Pisahkan Pulling dari Loading**~~ — selesai. Dokumen kini melewati
   DRAFT → PICKING → PICKED → LOADING → SHIPPED, dan stok berpindah
   PP02 → PP04 → keluar.
3. **Lapisan SAP** — outbox, movement type, status posting, penulis ke MS SQL.
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

## Catatan dari pengerjaan

**Barcode produksi polos belum menambah stok.** `parseBarcode` memperlakukan
barcode tanpa pemisah `|` sebagai nomor seri saja, sehingga part-nya tidak
dikenali dan tidak ada mutasi yang ditulis. Barcode berformat
`PART|BACK|SERIAL|QTY` bekerja normal. Selama format sebenarnya di lapangan
belum dipastikan, sebagian scan produksi tidak akan pernah sampai ke SAP.

## Yang masih terbuka

- **Movement type SAP** untuk tiap jenis mutasi. Dugaan awal: 101 (GR),
  311 (transfer antar SLOC), 261 (pemakaian produksi), 601 (pengiriman).
  Perlu dikonfirmasi ke tim SAP, karena salah movement type berarti salah akun.
- Apakah nomor dokumen material hasil posting SAP dikembalikan ke sini. Kalau
  ya, perlu kolom penampungnya dan jalur baliknya.
- Bagaimana kode SLOC di sini dipetakan ke plant + storage location SAP untuk
  dua pabrik yang berbeda.
