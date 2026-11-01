# Delivery Order AVICENNA

- Snapshot disiapkan saat seluruh loading list customer/PDS selesai pulling. Nomor dan cetak DO baru tersedia setelah GI AIIA dan GR AII dikonfirmasi beserta nomor dokumen SAP. PDS wajib tersedia; satu PDS customer memiliki satu DO. Lihat `delivery-intercompany-staging.md` untuk alur terkini.
- Nomor `SJA/YY/NNNNNN`, mengikuti contoh dokumen. Tahun Asia/Jakarta, counter bersama seluruh plant, mulai 000001 setiap tahun. Counter PostgreSQL di-upsert atomik; unique constraint menjaga customer/PDS, nomor dan tahun/serial. Retry tidak mengulang mutasi atau nomor.
- Header dan item disimpan sebagai snapshot saat penerbitan. Cetak ulang melalui `/delivery/[id]/delivery-order` membaca snapshot, tidak mengambil qty rencana/master terkini. Loading list baru yang datang setelah DO terbit untuk PDS tersebut ditolak saat Finish Pulling agar tidak hilang dari dokumen yang sudah dicetak; revisi/cancel DO belum tersedia.
- QR berisi manifest mentah jika seluruh loading list memakai satu manifest. Jika tidak ada manifest atau ada beberapa manifest, QR memakai PDS mentah. Leading zero dipertahankan. Resolver dokumen mendukung PDS dan mengembalikan seluruh kandidat jika ada lebih dari satu loading list.
- For D/N NO = nomor delivery SAP (`CHR_DEL_NO`); Customer/Code = master customer; PO = referensi staging; Delivery Location = kode tujuan staging (`CHR_CUS_DEST`), nama/alamat tujuan belum tersedia; Time = planTime, kosong bila sumber tidak menyediakan.
- PARTS No. = part customer (kurung) + internal, PCS/KBN = qtyPerKanban, TOTAL KBN/QTY = hasil aktual pulling. Item tidak digabung berdasarkan part. BOX CODE belum memiliki mapping sehingga kosong; RECEIVE/REMARK/NOTE disediakan untuk isi manual.
- Format A4 portrait, maksimum 15 item per halaman; deskripsi panjang dapat menghasilkan halaman tambahan. Logo merupakan reproduksi dari contoh pengguna; aset resmi dapat menggantikan `/public/images/aii-delivery-logo.png`.
- Alur GI AIIA → GR AII → DO → driver scan → GI AII sudah ditegakkan di AVICENNA. Request SAP masih HELD sampai kontrak adapter staging terkonfirmasi; tidak ada posting nyata otomatis. Scan driver dan scan surat jalan kembali terpisah. DO simulasi memakai penanda cetak khusus.

Verifikasi lokal: `DELIVERY_ORDER_CHECK=true pnpm --filter @avicenna/api test:delivery-order` (PowerShell: set env sebelum perintah). Fixture dan counter test di-rollback.

## Logo

Tool: built-in ImageGen, dari dokumen contoh pengguna. Aset tersimpan di `apps/web/public/images/aii-delivery-logo.png`. Reproduksi raster, bukan klaim file corporate asli.

Prompt final:

> Extract the small cyan PT AISIN INDONESIA AII symbol from the upper left of the input document. Only output the symbol. It has one angular A, curved i swoosh and two round dots. Match the exact silhouette in the reference. PRINT LOGO: solid uniform cyan #259fc1, HARD CRISP EDGES, NO glow, NO blur, NO gradient, NO lighting, NO shadow. Everything outside symbol is completely transparent alpha=0, including the holes. Do not output a black background. No text. Centered tightly cropped, minimal transparent margin. This is a flat ink corporate mark for a white paper invoice, NOT neon artwork.
