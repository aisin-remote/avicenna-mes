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

`deliveries` + `delivery_lines` sudah ada. Ditambah tautan ke unit/lot yang
benar-benar dikirim, agar telusur tetap menyambung sampai ke customer.

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

## Perlu diputuskan bersama tim

1. **Apakah operator men-scan komponen saat assembly?**
   Ini menentukan silsilahnya nyata atau hanya perkiraan. Kalau tidak discan,
   sistem hanya bisa menebak "lot yang sedang dipakai di line saat itu" —
   cukup untuk kebanyakan kasus, tapi tidak cukup saat customer menuntut bukti.

2. **Backflush atau pencatatan eksplisit** untuk pemakaian material?
   Skema mendukung keduanya; yang perlu diputuskan adalah bebannya di lapangan.

3. **Satuan raw material.** D dilebur — satuannya kilogram, bukan pcs.
   `qtyPer` di BOM perlu desimal, dan part perlu satuan (UOM). Avicenna punya
   tabel `avi_uom` yang belum dipetakan.

4. **Apakah B dan C benar-benar lot, atau ada yang berseri?**
   Sebagian komponen beli kadang punya barcode sendiri dari supplier.

5. **Scrap dan rework.** Kalau A gagal di machining, D-nya sudah terpakai.
   Perlu disepakati bagaimana itu dicatat.
