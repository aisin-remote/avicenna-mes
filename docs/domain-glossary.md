# Kamus Istilah — avicenna ↔ bella ↔ model terpadu

> **Status: DRAFT. Belum divalidasi tim.**
>
> Dokumen ini adalah pekerjaan Fase 0. Isinya disusun dari pembacaan kode dan
> migration kedua sistem lama, **bukan** dari konfirmasi tim produksi. Setiap
> baris di bawah perlu dibaca bersama orang yang memahami prosesnya sebelum
> dijadikan dasar implementasi.
>
> Kolom "Perlu dikonfirmasi" adalah bagian terpenting dari dokumen ini.

## Kenapa dokumen ini ada

Dua sistem menjalankan proses yang secara garis besar sama dengan penamaan
berbeda. Kalau penyatuan dilakukan sambil menulis kode, perbedaan istilah baru
ketahuan setelah tabelnya terlanjur dipakai — dan saat itu mengubahnya sudah
mahal. Menyepakati nama lebih dulu jauh lebih murah daripada mengubah skema
di bulan keempat.

## Prinsip penamaan

1. **Bahasa Inggris, snake_case** untuk nama tabel dan kolom; camelCase untuk
   variabel TypeScript.
2. **Tanpa awalan `avi_`** — pemisahan antarpabrik dilakukan kolom `plant_id`,
   bukan nama tabel.
3. **Satu tabel per konsep, dibedakan kolom tipe** — bukan satu tabel per
   proses. Ini generalisasi terbesarnya.
4. **Nama tabel maksimal ~25 karakter.** MySQL membatasi identifier 64 karakter,
   dan Drizzle menyusun nama constraint FK dari gabungan nama tabel + kolom.
   Jalankan `pnpm db:check-names` setelah menambah tabel.

## Generalisasi utama: proses produksi

Ini keputusan yang membuat penyatuan mungkin.

| Sistem lama | Representasi lama | Model terpadu |
|---|---|---|
| bella | model `Injection`, tabel `injections` | `process_type = 'INJECTION'` |
| avicenna | tabel `avi_trace_casting` | `process_type = 'CASTING'` |
| avicenna | tabel `avi_trace_machining` | `process_type = 'MACHINING'` |
| avicenna | tabel `avi_trace_assembling` | `process_type = 'ASSEMBLING'` |

Empat tabel dengan struktur berulang menjadi satu kolom enum. Menambah proses
baru cukup menambah nilai enum, bukan membuat tabel dan controller baru.

## Master data

| Konsep | avicenna | bella | Terpadu | Perlu dikonfirmasi |
|---|---|---|---|---|
| Pabrik | (tidak ada) | (tidak ada) | `plants` | Apakah AVICENNA & BELLA memang dua plant terpisah, atau dua line dalam satu plant? |
| Line | `avi_trace_line_master` | `lines`, `line_static_sequences` | `lines` | Apakah `line_static_sequences` masih dipakai? |
| Part | `avi_parts` | `internal_parts` | `parts` | avicenna punya `avi_part_production`, `avi_part_dashboard` — masih dipakai? |
| Part customer | `avi_part_pis` (?) | `customer_parts` | `customer_parts` | Apakah satu part bisa punya >1 nomor customer? |
| Customer | `avi_customers` | `customers` | `customers` | Kode customer bentrok antar dua sistem? |
| Supplier | `avi_part_supplier` | `suppliers` | `suppliers` | |
| Mesin | `avi_machining`, `avi_machining_master`, `avi_machine_cek` | `machines`, `machine_events` | `machines` + `machine_events` | Tiga tabel avicenna itu perannya apa masing-masing? |
| Tooling | (dies?) | `molds`, `mold_has_parts` | `toolings` + `tooling_parts` | Apakah avicenna melacak dies sama sekali? |
| Lokasi | `avi_location` | `master_alamat_chutes` | `locations` | Apakah "chute" = lokasi, atau konsep terpisah? |
| UOM | `avi_uom` | (tidak ada) | **belum dibuat** | Apakah masih dipakai, atau semua dalam pcs? |

## Operasional

| Konsep | avicenna | bella | Terpadu | Perlu dikonfirmasi |
|---|---|---|---|---|
| Kanban | `avi_trace_kanban`, `avi_trace_kanban_master` | `kanbans` | `kanbans` | Apa isi `kanban_master` yang tidak ada di `kanbans`? |
| Riwayat kanban | (tersebar) | `kanban_after_prods`, `kanban_after_pulls`, `body_kanban_pairings` | `kanban_events` | Apakah PAIRED hanya untuk body↔part, atau ada pasangan lain? |
| Rencana produksi | `avi_running_model`, `avi_part_production` | `production_plans` | `production_plans` | bella menyimpan line/customer sebagai string; apakah aman dinormalisasi ke FK? |
| Scan | `TraceScanController` (4.484 baris) | `pis_scans`, `pis_scan_details`, `scanned_parts` | `scan_events` | **Prioritas tertinggi.** Format barcode tiap customer belum terdokumentasi. |
| Stok | `avi_mutations`, `avi_opname`, `avi_mutation_type` | `mutations`, `production_stocks` | `mutations` + `stock_balances` | `avi_mutation_type` isinya apa saja? |
| NG / Quality | `avi_trace_ng`, `avi_trace_ng_master`, `avi_trace_rekap_ng` | `quality_inspections`, `quality_inspection_details`, `master_item_checks` | `quality_inspections` + `inspection_details` + `ng_masters` | Apakah `rekap_ng` turunan, atau data yang diinput terpisah? |
| Pengiriman | `avi_trace_delivery` | `external_deliveries`, `loading_lists`, `loading_list_details`, `manifests`, `manifest_details` | `deliveries` + `delivery_lines` | Lima tabel bella → dua. Apakah manifest & loading list memang tahapan berbeda? |
| Pulling | (tidak ada?) | `pullings`, `DirectPullingSSEController` | `kanban_events` type PULLED | Apakah avicenna punya konsep pulling? |
| Andon | `avi_andon` + 8 tabel lain | (tidak ada) | **belum dibuat** | Modul terbesar yang belum dipetakan. Fase 4. |
| Data mesin | `Iot/TT_DATA_*` (SQL Server ALColla_J922) | `Agstar/Ia01`, `Ia31` (SQL Server J922) | `machine_events` | **Apakah dua instance SQL Server itu sumber yang sama?** |

## Yang sengaja belum dibuat

Tabel-tabel ini ada di sistem lama tapi belum masuk skema terpadu, karena
perannya belum jelas atau termasuk fase berikutnya:

- **Andon** (`avi_andon`, `avi_andon_actual`, `avi_andon_charts`, `avi_andon_color`,
  `avi_andon_dandori`, `avi_andon_detail`, `avi_andon_status`,
  `avi_andon_status_history`, `avi_andon_target`) — Fase 4.
- **PIS** (`avi_part_pis`, `pis_scans`, `pis_mutations`, `pis_scan_logs`) —
  perlu dipahami dulu PIS itu proses apa. Kemungkinan besar muat sebagai
  `scan_events.kind`, tapi jangan diputuskan sebelum dikonfirmasi.
- **Furnace, strainer, torimetron, dandori** — khas avicenna, belum dipetakan.
- **RFID** (`rfid_cards`, `machine_access_logs`) — kemungkinan masuk `devices`.
- **Nidec, Dowa, TMMIN** — integrasi eksternal, dipetakan di fase integrasi.

## Pertanyaan yang harus dijawab sebelum Fase 1 selesai

1. **Format barcode.** Apa isi barcode di tiap titik scan, untuk tiap customer?
   Ini terkunci di `TraceScanController` dan `PisController`, dan tidak
   terdokumentasi di mana pun. Kalau orang yang menulisnya tidak tersedia,
   ini risiko terbesar keseluruhan proyek.
2. **Jam shift.** `packages/domain/src/shift.ts` memakai 07:00 / 15:00 / 23:00
   sebagai asumsi. Kalau salah, seluruh report harian ikut salah.
3. **Batas hari produksi.** Apakah shift 3 yang mulai 23:00 dihitung sebagai
   produksi tanggal berjalan? Implementasi sekarang mengasumsikan ya.
4. **Dua instance SQL Server J922** — sumber sama atau berbeda?
5. **Migrasi data historis.** Berapa tahun ke belakang yang wajib dipindahkan?
   Ini menentukan apakah `scan_events` perlu partisi sejak awal.
