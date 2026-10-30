import { Injectable, Logger } from '@nestjs/common';
import { bacaKatalogProses, type Database } from '@avicenna/db';
import type { KatalogProses } from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/**
 * ─── KATALOG JENIS PROSES, DISIMPAN DI MEMORI ───────────────────────────────
 *
 * Kosakata jenis proses dibaca dari master `TM_PROCESS_TYPE`. Ia dibutuhkan di
 * jalur paling panas sistem ini — setiap scan menanyakan metode scan, grup
 * role, dan kelas hasil SAP — jadi membacanya ulang per permintaan berarti satu
 * kueri tambahan pada setiap barang yang lewat lini.
 *
 * ── Kenapa cache-nya dikosongkan, bukan kedaluwarsa sendiri ─────────────────
 *
 * Isi tabel ini hanya berubah ketika ada yang menyuntingnya di layar master,
 * dan layar itu melewati MasterService. Jadi yang membatalkan cache adalah
 * penyimpanan itu sendiri — bukan penghitung waktu yang membuat perubahan baru
 * terlihat "sebentar lagi". Leader yang menambah proses lalu membuka matriks
 * dan tidak melihatnya akan menambahnya lagi.
 *
 * Satu proses API memegang satu salinan. Beberapa wadah berarti beberapa
 * salinan, dan yang tidak menerima penyimpanan itu tetap memegang yang lama
 * sampai ia sendiri menulis sesuatu. Selama penyuntingnya satu layar, itu tidak
 * terlihat; begitu API dijalankan berlapis di belakang penyeimbang beban, ini
 * yang pertama harus diganti — mis. dengan memberi tahu lewat Valkey.
 */
@Injectable()
export class ProcessTypeService {
  private readonly logger = new Logger(ProcessTypeService.name);
  private cache?: Promise<KatalogProses>;

  constructor(@InjectDb() private readonly db: Database) {}

  /** Katalog yang aktif saja — untuk formulir, kolom matriks, dan validasi. */
  katalog(): Promise<KatalogProses> {
    const ada = this.cache;
    if (ada) return ada;
    // Gagal baca tidak boleh menjadi cache: percobaan berikutnya harus
    // benar-benar mencoba lagi, bukan mengulang galat yang sama.
    const baru = bacaKatalogProses(this.db, { termasukNonaktif: true }).catch((err: unknown) => {
      this.cache = undefined;
      throw err;
    });
    this.cache = baru;
    return baru;
  }

  /** Dipanggil setelah master jenis proses disunting. */
  segarkan(): void {
    this.cache = undefined;
    this.logger.log('katalog jenis proses disegarkan');
  }
}
