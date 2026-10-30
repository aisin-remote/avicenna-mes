# Arsip dan cetak dokumen customer

Preparation Monitoring adalah titik cetak **Kanban Customer, Manifest, dan Skid Label**. Ketiganya berasal dari PDF portal customer. Cetak Kanban Internal tetap memakai master kartu terdaftar dan merupakan fungsi terpisah.

## Alur pengguna

1. Klik bar preparation/PDS atau truck pada timeline, lalu pilih loading list pada dialog.
2. Panel **Dokumen Customer** menampilkan tiga jenis dokumen, nama file, waktu upload, dan tombol **Cetak / Preview / Download**. Arsip kosong menampilkan **Upload PDF**.
3. Upload membuka menu Dokumen Customer (route `/kanban`) dengan loading list dan jenis dokumen sudah terpilih. Dari menu ini pengguna juga bisa mencari PDS/manifest/loading list secara manual dan memilih kandidat yang sesuai.
4. Kanban mentah dipotong memakai master customer yang tersimpan. Untuk hasil potong yang sudah siap, centang **PDF kanban ini sudah dipotong** agar tidak dipotong ulang. Manifest dan skid label dipertahankan seluruh halaman dan ukuran aslinya.
5. **Potong & simpan arsip** atau **Upload & simpan arsip** menyimpan PDF permanen. Kembali ke monitoring dan tekan **Perbarui arsip**; dialog juga memperbarui saat browser kembali mendapat fokus.
6. **Cetak** membuka semua halaman PDF dan dialog printer. Pengguna dapat memilih printer berbeda untuk tiap dokumen. **Preview** membuka halaman yang sama tanpa otomatis membuka dialog cetak.

Tautan **Dokumen Customer** di detail delivery dan tautan kembali setelah upload membuka dialog loading list pada tanggal yang sama. Format tautan langsung: `/preparation-monitoring?from=YYYY-MM-DD&to=YYYY-MM-DD&document=<deliveryId>`. Route manifest lama juga mengarahkan ke arsip ini.

Satu file ditujukan untuk referensi PDS yang dipilih. PDF campuran beberapa PDS harus dipisahkan terlebih dulu; tidak ada tebakan asosiasi berdasarkan potongan nama file. Arsip tidak diganti dengan template manifest/kanban buatan MES ketika PDF portal belum diupload.

## Penyimpanan dan akses

- Metadata: `logistics.TT_DELIVERY_DOCUMENT`, migrasi `0009_powerful_freak.sql`.
- Scope: plant + customer + reference type + reference number. Referensi memakai PDS; jika kosong, manifest; jika keduanya kosong, nomor loading list. Beberapa loading list untuk customer/PDS/pabrik yang sama dapat melihat arsip yang sama.
- Jenis: `CUSTOMER_KANBAN`, `MANIFEST`, `SKID_LABEL`. Upload isi PDF identik pada scope/jenis yang sama idempoten, termasuk retry bersamaan. File berbeda tetap menjadi arsip terpisah dengan timestamp dan uploader.
- File: `<repo>/storage/delivery-documents/<uuid>.pdf`, dapat dipindah ke volume persisten melalui `DELIVERY_DOCUMENT_DIR`. Backup folder ini bersama database; file bukan aset publik Next.js.
- API menerima PDF maksimal 20 MB, memeriksa base64 kanonik, signature/header dan EOF PDF, ukuran, jenis dokumen, dan scope pengguna manusia. Klien juga membaca PDF sebelum upload. API menyimpan byte PDF hasil upload tanpa menulis staging/SAP, stok, atau progress pulling.
- File hanya dibuka melalui API terautentikasi dan proxy web yang membawa cookie sesi sebagai bearer di sisi server. Nama/path penyimpanan tidak diserahkan ke browser. Response PDF private/no-store dan nosniff.

## Referensi dan pengujian

Referensi legacy: `stagging-body/resources/views/pages/dashboard_delivery.blade.php`, `openKanbanSourcePopup` dan `buildDocumentSourceTableHtml`; `DashboardController::kanbanSourceFiles/manifestSourceFiles`. AVICENNA mengikat file dengan key referensi eksplisit, bukan substring nama file.

`pnpm --filter @avicenna/api test:delivery-documents` memeriksa tiga jenis dokumen, upload concurrent/idempoten, round-trip bytes, isolasi customer/PDS/pabrik, validasi, dan tidak berubahnya status delivery. Database fixture di-rollback dan file QA dibersihkan. Pengujian crop memakai satu PDF berisi dua kartu → dua halaman hasil potong dengan ukuran yang benar.

Print memakai dialog browser dan ukuran tiap halaman PDF. Render cetak aplikasi dibatasi 500 halaman per file; file yang lebih besar tetap dapat didownload untuk dicetak lewat pembaca PDF. Silent print QZ Tray dan routing printer otomatis belum dipasang; printer fisik tidak dikirim job selama pengujian.
