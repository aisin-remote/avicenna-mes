# Loading List — Pengiriman ke Customer

Modul ini mengambil alih pekerjaan yang di bella dilakukan oleh
`LoadingListController`. Perbedaan pokoknya satu, dan menentukan hampir semua
keputusan di bawah:

> **Di bella dokumen loading list didorong masuk dari J922.** Sistem hanya
> menerima, menampilkan, lalu mencocokkan scan. Di sini dokumennya **dikelola
> sendiri** — dibuat, diubah, dan ditutup di dalam Avicenna.

Akibatnya nomor dokumen sekarang dihasilkan sistem (`LL-YYYYMMDD-NNNN`), dan
nomor dari customer disimpan terpisah sebagai `pdsNumber` — rujukan, bukan
identitas.

## Alur

```
buat dokumen  →  truk datang  →  scan kanban  →  nyatakan berangkat
  (rencana)      (status truk)    (aktual)         (stok berkurang)
```

1. **Buat** — `/delivery/new`. Pilih pabrik, customer, tanggal, rit, lokasi
   asal barang, lalu susun rencana per part dalam satuan **kanban**.
2. **Muat** — `/loading/<id>`. Layar penuh tanpa menu, seperti stasiun scan
   produksi. Tiap kanban discan satu kali.
3. **Berangkat** — dari halaman detail. Barulah `mutations` bertambah.

## Kenapa satuannya kanban, bukan pcs

Karena itu satuan yang dipegang orang di lapangan: satu kartu sama dengan satu
kemasan. Petugas menghitung kanban, bukan menghitung isi. Jumlah pcs diturunkan
(`kanban × qtyPerKanban`) dan ditampilkan, tapi tidak pernah diketik saat muat.

`qtyPerKanban` **disalin** ke `delivery_lines` saat dokumen dibuat, tidak
dibaca ulang dari master ketika menghitung. Master bisa berubah sewaktu-waktu,
dan dokumen yang sudah dikirim tidak boleh ikut berubah angkanya di belakang
hari.

## Konversi nomor part customer

Barcode kanban memuat nomor part versi **customer**, master menyimpan versi
**internal**. `convertCustomerPartNumber` (di `@avicenna/domain`) menjembatani
keduanya — diambil dari `App\Support\ConvertsCustomerPartNumber` milik bella.

Bedanya: bella menentukan format dari **id customer yang ditulis langsung di
kode** (14 dan 22 dianggap SUZUKI, 6/23/24/28 dianggap MMKI). Id itu tidak akan
bertahan melewati migrasi. Di sini format menjadi **atribut master customer**
(`customers.partNumberFormat`), bisa diubah lewat layar master tanpa menyentuh
kode.

> **PERLU DIKONFIRMASI.** Untuk kode 13 karakter, bella membandingkan
> `substr($customerPart, -2)` (2 karakter) dengan `'000'` (3 karakter).
> Perbandingan itu tidak akan pernah benar, sehingga satu cabangnya adalah kode
> mati. Perilakunya **dipertahankan apa adanya** supaya hasil konversi sama
> persis dengan sistem lama. Kalau ternyata itu memang bug di bella, perbaikan
> harus dilakukan sadar, dengan tahu berapa data lama yang ikut berubah.

## Tiga hal yang sengaja tidak menghalangi

Ketiganya berangkat dari kenyataan yang sama: **barang sudah naik ke truk.**
Menolak mencatat tidak membuat barangnya turun lagi; yang terjadi hanya catatan
sistem jadi berbeda dari isi truk.

| Keadaan | Yang dilakukan |
|---|---|
| Scan melebihi rencana | Dicatat, ditandai `OVER` di layar |
| Stok tercatat tidak cukup | Tetap dikirim, kekurangan dilaporkan setelah berangkat |
| Part belum punya nomor customer | Tetap boleh dimuat, diperingatkan saat menyusun rencana |

Yang **memang** ditolak hanya: barcode yang tidak ada di dokumen ini, dan
dokumen yang sudah berangkat atau dibatalkan.

## Yang dicatat saat berangkat

Satu baris `mutations` bertipe `DELIVERY_OUT` per baris muatan, bertanda
negatif, sebesar **jumlah aktual** hasil scan — bukan rencana.

- `locationId` diisi dari lokasi asal dokumen. Tanpa itu saldo total tetap
  benar tetapi saldo per lokasi diam-diam melenceng.
- Untuk part ber-`trackingMode = LOT`, jumlahnya dibagi ke lot secara FIFO
  (`allocateFifo`). Mutasi keluar tanpa `lotId` membuat saldo tiap lot terlihat
  penuh selamanya, dan alokasi FIFO berikutnya ikut salah.
- Sisa yang tidak tertampung lot mana pun tetap dicatat tanpa lot, dengan
  catatan yang menyebutkannya.

## Ketahanan di lapangan

Dua masalah yang khas terjadi di jaringan pabrik, dan cara menanganinya:

**Scan beruntun.** Pemindai mengetik lalu menekan Enter jauh lebih cepat
daripada satu perjalanan ke server. Layar muat **mengantrekan** scan, tidak
membuangnya. Membuang scan yang datang saat permintaan sebelumnya masih terbang
berarti kanban itu naik truk tanpa pernah tercatat — dan tidak ada yang
menyadarinya sampai customer menghitung ulang.

**Kiriman ulang.** Device menyertakan `clientRef`; kunci itu menjadi
`dedupeKey` pada `scan_events`. Kalau permintaan yang sama datang dua kali,
transaksinya dibatalkan dan sistem membalas dengan keadaan saat ini
("sudah tercatat sebelumnya"), **bukan** error. Membalas 500 di sini adalah
kesalahan yang mahal: operator melihat "Gagal", lalu men-scan ulang kanban yang
sebenarnya sudah terhitung — dan baru saat itulah muncul hitungan ganda yang
sesungguhnya.

**Dua orang sekaligus.** Penambahan `actual_kanban` dilakukan di dalam SQL
(`SET actual_kanban = actual_kanban + 1`), bukan dibaca lalu ditulis kembali
dari aplikasi. Dengan baca-ubah-tulis, dua scan bersamaan sama-sama membaca 5
dan sama-sama menulis 6 — satu kanban hilang tanpa jejak.

## Status

Status **dokumen** dan status **truk** sengaja dipisah, karena truk bisa datang
sebelum barangnya siap dimuat.

- Dokumen: `DRAFT → LOADING → SHIPPED`, atau `CANCELLED`.
  Berpindah ke `LOADING` otomatis pada scan pertama.
- Truk: `PENDING → ARRIVED → LOADING → DEPARTED`, diatur manual dari halaman
  detail.

## Yang masih terbuka

- **Manifest.** Bella punya `manifests` + `manifest_details` (beberapa loading
  list dalam satu perjalanan truk). Belum dibuat karena belum jelas apakah
  masih dipakai setelah dokumen dikelola sendiri.
- **Serial per kanban.** `loadingScanSchema` sudah menyediakan `serialNumber`
  dan nilainya disimpan di `scan_events`, tapi belum ditautkan ke `genealogy`.
  Begitu ditautkan, telusur mundur dari customer sampai ke lot raw material
  menjadi utuh.
- **Impor rencana.** Penerimaan barang sudah bisa tempel dari Excel
  (`parseImportRows`). Loading list belum — mekanismenya sama dan bisa dipakai
  ulang.
