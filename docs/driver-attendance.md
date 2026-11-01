# Absensi Driver

Referensi: `aisin-remote/delivery`, commit `e80332dd05893cedfac308b0398f9aa763bf5d00`, terutama `app/Livewire/Delivery.php`, `resources/views/livewire/delivery.blade.php`, controller riwayat, dan `DeliveryExport`.

## Alur

1. Buka **Logistik → Absensi Driver** (`/delivery-return`). Posisi **TRUCK 01 Depan** dan **TRUCK 02 Belakang** disediakan per pabrik. Sesi aktif tersimpan di database dan tetap muncul setelah refresh.
2. **Mulai → Checksheet Safety**: helm, rompi, dan sepatu wajib Ya. Validasi juga dilakukan di API.
3. **Foto Driver**: webcam, kamera perangkat, atau pilih foto. Foto diperkecil di browser; berkas tersimpan mengikuti batas foto aplikasi (2 MB), pada subfolder privat `FOTO_DIR/driver-attendance`.
4. Pilih tujuan pickup (customer/dock/logistik), cycle C1–C10, lalu scan satu atau beberapa DO. QR manifest yang menaungi beberapa PDS menampilkan pilihan DO; tidak memilih otomatis. DO harus berasal dari customer, cycle, dan pabrik yang dipilih, sudah terbit, serta GI AIIA dan GR AII sudah berhasil.
5. **Mulai Pickup** menyimpan sesi, foto, daftar DO, dan waktu mulai; truk ditandai LOADING. Langkah ini belum meminta GI AII.
6. **Selesai Pickup** menyimpan waktu akhir dan meminta GI AII seluruh DO dalam satu transaksi. Ini mengikuti pilihan pengguna pada 28 Oktober 2026. Kegagalan salah satu DO membatalkan seluruh transaksi. Retry / klik bersamaan tidak menggandakan GI atau stok keluar. Slot dapat dipakai pickup berikutnya setelah sesi selesai.
7. Status berangkat/stok keluar tetap menunggu konfirmasi SAP sesuai alur intercompany yang ada. Selesai pickup bukan bukti SAP telah berhasil. Rincian riwayat menyediakan status SAP per DO.

Tab **Riwayat Absensi** menyediakan filter tanggal, durasi, daftar DO, foto/checklist, dan export Excel. Tab **Dokumen Kembali** mempertahankan pencatatan surat jalan kembali dari customer setelah pengiriman berhasil.

## Master dan penyimpanan

Master **Tujuan Pickup** (`/master/driver-destinations`) memakai CRUD master yang ada: pabrik, customer, kode, nama tujuan, route/dock, penyedia logistik, dan status aktif. LP diisi sesuai konfigurasi operasional; tidak ditebak dari kolom staging SAP yang belum dipastikan artinya. Snapshot tujuan disimpan pada sesi agar perubahan master tidak mengubah riwayat.

Migrasi `0010_luxuriant_killmonger.sql` menambah `logistics.TM_DRIVER_DESTINATION`, `TT_DRIVER_ATTENDANCE`, dan `TT_DRIVER_ATTENDANCE_DO`. Unique index parsial mengunci satu pickup aktif per pabrik/slot, dan unique DO mencegah satu DO terdaftar pada dua pickup.

Foto hanya disajikan melalui endpoint terautentikasi yang memeriksa pabrik. URL foto master publik tidak dapat membaca subfolder foto driver. Foto upload yang gagal disimpan dibersihkan. Backup folder foto bersama database.

Endpoint scan driver lama `/loading/driver-scan` dihapus agar GI AII tidak dipicu sebelum Selesai Pickup. Antrean SAP AVICENNA tetap dipakai; endpoint HTTP produksi milik aplikasi referensi tidak dipanggil.

## Verifikasi

`pnpm --filter @avicenna/api test:driver-attendance` menggunakan fixture lokal tersendiri yang dibersihkan setelah uji. Cakupan: safety/foto wajib, beberapa DO, scan/start tanpa GI, rollback akhir pickup, retry finish bersamaan, rebutan slot, isolasi pabrik, foto privat, riwayat/export, dan stok tidak dianggap keluar sebelum konfirmasi SAP.

Kamera browser pada alamat HTTP LAN bergantung kebijakan perangkat; gunakan HTTPS untuk webcam atau tombol kamera/pilih foto bawaan perangkat. Pengujian otomatis memakai foto dummy, tanpa mengambil foto pengguna. Integrasi SAP nyata tetap mengikuti kontrak staging yang sudah dikonfigurasi; pengujian tidak mengirim transaksi ke SAP.
