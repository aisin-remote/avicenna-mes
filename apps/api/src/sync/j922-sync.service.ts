import { Injectable, Logger } from '@nestjs/common';

/**
 * Sinkronisasi data mesin dari SQL Server J922.
 *
 * BELUM DIIMPLEMENTASIKAN — ini kerangka, bukan kode yang berjalan.
 *
 * Kedua sistem lama menarik dari sumber ini dengan cara berbeda:
 *   avicenna -> database ALColla_J922, tabel TT_DATA_*
 *   bella    -> database J922, tabel Agstar Ia01/Ia31
 *
 * Host, instance, dan kredensial masing-masing ada di file .env sistem lama;
 * sengaja tidak ditulis di sini agar alamat jaringan internal pabrik tidak
 * ikut tersimpan di dalam repo. Isikan lewat MSSQL_* di .env.
 *
 * Sebelum diisi, tiga hal harus diputuskan bersama tim:
 *   1. Apakah dua instance itu sumber yang sama atau berbeda.
 *   2. Kolom mana yang dipakai sebagai penanda "baris baru" (watermark),
 *      supaya sync inkremental — bukan SELECT seluruh tabel tiap kali.
 *   3. Kunci idempoten, dipetakan ke machine_events.dedupe_key.
 *
 * Yang perlu dipegang saat mengisinya: koneksi ke J922 hanya boleh READ-ONLY,
 * dan hanya dari worker ini. Web app tidak pernah menyentuh SQL Server
 * langsung — itu penyebab request web ikut lambat di sistem lama ketika
 * jaringan ke mesin sedang bermasalah.
 *
 * Saat mengerjakan: tambahkan paket `mssql`, baca kredensial dari MSSQL_*,
 * lalu daftarkan sebagai repeatable job di QUEUES.SYNC.
 */
@Injectable()
export class J922SyncService {
  private readonly logger = new Logger(J922SyncService.name);

  async sync(): Promise<{ pulled: number }> {
    if (process.env.MSSQL_SYNC_ENABLED !== 'true') {
      return { pulled: 0 };
    }
    this.logger.warn('J922SyncService.sync() belum diimplementasikan');
    return { pulled: 0 };
  }
}
