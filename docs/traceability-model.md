# Model Ketertelusuran: Supply → Process → Delivery

> **Status: RANCANGAN untuk direview.** Bagian "Perlu diputuskan" di bawah
> berisi hal-hal yang tidak boleh saya tebak sendiri.

## Yang ingin dicapai

Mencatat perpindahan setiap komponen dan part, dari dibeli sampai dikirim:

```
SUPPLIER ──beli──> [D] raw material
                     │
                   lebur
                     ▼
                   [A] ──┐
SUPPLIER ──beli──> [B] ──┼──rakit──> [ABC] ──kirim──> CUSTOMER
SUPPLIER ──beli──> [C] ──┘
```

Plus perpindahan antar line di dalam pabrik, dan saldo stok seluruh part.

## Keputusan paling menentukan: butir vs lot

Ini muncul dari contoh Anda sendiri — **"melebur raw material part D"**.

Barang yang dilebur tidak mungkin diberi nomor seri satu per satu. Sementara
part hasil casting justru sudah punya barcode dan discan satu per satu. Jadi
sistem ini WAJIB mendukung dua cara pelacakan sekaligus:

| Cara | Untuk apa | Contoh | Yang dicatat |
|---|---|---|---|
| **SERIAL** | Satu barcode = satu barang | A, ABC | Nomor seri tiap butir |
| **LOT** | Sekelompok barang satu batch | D, B, C | Nomor lot + jumlah |
| **QUANTITY** | Hanya jumlah, tanpa identitas | consumable | Jumlah saja |

Kalau sistem dipaksa serial semua, raw material tidak bisa masuk. Kalau
dipaksa lot semua, ketertelusuran per butir yang sudah berjalan di casting dan
machining justru hilang. Karena itu setiap part membawa kolom `trackingMode`
sendiri, dan cara pencatatannya mengikuti kolom itu.

Ini bukan pilihan gaya. Untuk customer seperti TMMIN, kemampuan menjawab
"lot D mana yang masuk ke unit ABC nomor seri berapa" adalah syarat, bukan
tambahan.

## Struktur data

### 1. Part diberi tipe

Tabel `parts` yang ada sekarang belum membedakan raw material, komponen beli,
dan barang jadi. Ditambahkan:

- `partType` — `RAW_MATERIAL` | `COMPONENT` | `WIP` | `FINISHED_GOOD`
- `sourceType` — `PURCHASED` (beli) | `MANUFACTURED` (produksi sendiri)
- `trackingMode` — `SERIAL` | `LOT` | `QUANTITY`

Contoh Anda menjadi:

| Part | partType | sourceType | trackingMode |
|---|---|---|---|
| D | RAW_MATERIAL | PURCHASED | LOT |
| B, C | COMPONENT | PURCHASED | LOT |
| A | WIP | MANUFACTURED | SERIAL |
| ABC | FINISHED_GOOD | MANUFACTURED | SERIAL |

### 2. BOM — apa butuh apa

`bom_lines`: part induk, part komponen, qty per satu induk.

```
ABC → A ×1, B ×2, C ×4
A   → D ×0.8 kg
```

Bersarang, jadi ABC bisa diurai sampai ke raw material tanpa tabel terpisah.

Dibuat **berversi** (`effectiveFrom` / `effectiveTo`) karena komposisi berubah
seiring engineering change. Tanpa ini, mengubah BOM hari ini akan membuat
telusur produksi bulan lalu ikut berubah — dan jawaban atas pertanyaan audit
jadi salah.

### 3. Lot untuk barang yang tidak berseri

`lots`: part, nomor lot, supplier asal, tanggal terima, jumlah awal.

Nomor lot dari supplier disimpan apa adanya. Saat audit, itulah yang dipakai
customer dan supplier untuk saling merujuk.

### 4. Penerimaan dari supplier

`receipts` + `receipt_lines`: apa yang datang, dari siapa, kapan, masuk lokasi
mana, dengan lot berapa.

### 5. Pemakaian material saat produksi

`consumptions`: saat line memproduksi A, material D berkurang.

Dua cara mengisinya, keduanya didukung:
- **Backflush** — otomatis mengurangi sesuai BOM setiap kali ada scan produksi.
  Praktis, tapi angkanya hanya seakurat BOM-nya.
- **Eksplisit** — operator mencatat lot yang benar-benar dipakai. Lebih akurat
  dan itulah yang memberi ketertelusuran sesungguhnya, tapi menambah pekerjaan
  di lapangan.

### 6. Silsilah — inti ketertelusuran

`genealogy_links`: unit jadi ini terbuat dari komponen/lot mana saja.

Ini yang menjawab dua pertanyaan yang selalu ditanya saat ada masalah kualitas:
- **Maju**: lot D-2026-11 cacat — unit ABC mana saja yang memakainya?
- **Mundur**: unit ABC nomor seri X bermasalah — komponen dan lot apa isinya?

Tanpa tabel ini, sistem hanya menghitung stok, bukan menelusuri.

### 7. Perpindahan antar line

`transfers` + `transfer_lines`: dari lokasi/line mana ke mana, part apa,
berapa, siapa yang memindahkan.

### 8. Pengiriman ke customer

`deliveries` + `delivery_lines` — dokumen loading list, dihitung dalam kanban.
Rencana dan aktual disimpan berdampingan; yang mengurangi stok adalah aktual.
Selengkapnya di [loading-list.md](loading-list.md).

Tautan ke unit/lot yang benar-benar dikirim belum dibuat: part ber-lot sudah
dibagi FIFO saat berangkat, tetapi serial per kanban belum ditautkan ke
`genealogy`. Itu potongan terakhir yang membuat telusur menyambung dari
customer sampai ke lot raw material.

## Semua bermuara ke satu buku besar

Setiap kejadian di atas tetap menulis baris di `mutations` — buku besar stok
yang sudah ada. Tabel-tabel baru itu adalah **dokumen** yang menjelaskan
sebuah pergerakan; angkanya tetap satu tempat.

```
penerimaan  → mutations RECEIVING_IN
produksi    → mutations PRODUCTION_IN
pemakaian   → mutations CONSUMPTION_OUT
transfer    → mutations TRANSFER_OUT + TRANSFER_IN
pengiriman  → mutations DELIVERY_OUT
NG          → mutations NG_OUT
opname      → mutations STOCK_TAKE
```

Saldo tetap turunan yang bisa dibangun ulang, tidak pernah jadi sumber
kebenaran. Ini yang membedakannya dari `avi_trace_component_stock_balances`
dan `production_stocks` bella, yang menyimpan saldo langsung sehingga ketika
angkanya melenceng tidak ada cara menelusuri sebabnya.

## Keputusan yang sudah diambil

Kelima pertanyaan di bawah sudah dijawab tim pada 10 September 2026.

### 1. Komponen TIDAK discan saat produksi

Yang discan hanya hasil barang jadinya. Komponen berkurang otomatis mengikuti
BOM.

**Konsekuensi yang harus disadari:** silsilah menjadi `INFERRED`, bukan
`SCANNED`. Sistem menyimpulkan komponen mana yang terpakai dari lot yang
sedang aktif di line saat itu — bukan dari bukti langsung.

Ini cukup untuk menelusuri dan menarik barang saat ada masalah, tapi TIDAK
cukup bila suatu saat customer menuntut bukti per unit. Kolom `evidence`
sengaja dibuat agar perbedaan itu tetap terlihat, sehingga kalau kelak
sebagian proses mulai men-scan komponen, keduanya bisa hidup berdampingan
tanpa mengubah skema.

### 2. Backflush

Pemakaian material dihitung otomatis dari BOM setiap ada scan produksi.
Akurasinya sepenuhnya bergantung pada ketepatan BOM — BOM yang salah berarti
stok yang salah, dan tidak ada yang akan menyadarinya sampai stock opname.

Dijalankan lewat antrean, bukan di dalam request scan. Dua alasannya: layar
operator tidak boleh ikut menunggu perhitungan material, dan kegagalan
perhitungan tidak boleh menggagalkan pencatatan produksi yang sudah terjadi.
Perhitungannya deterministik, jadi selalu bisa dijalankan ulang dari catatan
produksi bila ada yang gagal.

### 3. Satuan raw material

Kebanyakan pcs. Yang dilebur — aluminium dan plastik — memakai kilogram.
Sudah ditampung kolom `uom` pada part dan `qtyPer` desimal pada BOM.

### 4. B dan C punya part number dan barcode sendiri

Discan saat kedatangan untuk menambah stok, bukan saat produksi. Jadi jalur
scan-nya ada di penerimaan barang, terpisah dari scan produksi.

### 5. Perlakuan barang NG — ada dua, dan berbeda mendasar

**a. Lebur ulang.** Part A yang NG dianggap kembali menjadi D karena akan
dilebur lagi. Ini bukan sekadar pengurangan stok, melainkan **perubahan
identitas**: stok A berkurang, stok D bertambah. Sisa material tetap bernilai,
dan kalau hanya dicatat sebagai "hilang", stok D akan terus terlihat kurang
dari kenyataan.

**b. Repair.** Part ABC yang NG diperbaiki dengan mengganti komponen tertentu
— misalnya hanya B. Ini mengubah silsilah unit tersebut: B yang lama keluar,
B yang baru masuk. Silsilah karena itu harus bisa mencatat penggantian, bukan
sekadar ditimpa — riwayat "unit ini pernah memakai B lot lama" tetap harus
bisa dibaca saat investigasi.

## Yang masih terbuka

- Rasio konversi lebur ulang: 1 pcs A menjadi berapa kg D? Kemungkinan sama
  dengan `qtyPer` di BOM, tapi biasanya ada susut pembakaran yang membuatnya
  lebih kecil. Perlu angka dari lapangan.
- Apakah komponen yang dilepas saat repair (B lama) bisa dipakai ulang, atau
  langsung dibuang.
