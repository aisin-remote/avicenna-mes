import { Injectable, Logger } from '@nestjs/common';
import { eq, and, lt, asc, type Database } from '@avicenna/db';
import { sapOutbox } from '@avicenna/db';
import { InjectDb } from '../db/db.module';

/** Berhenti mencoba setelah sekian kali; sisanya perlu dilihat orang. */
const MAX_ATTEMPTS = 8;

/**
 * Mengirim dokumen dari outbox ke tabel MS SQL yang dibaca SAP.
 *
 * BELUM TERSAMBUNG KE SERVER SUNGGUHAN — lihat catatan di kirimKeMsSql().
 *
 * ── Kenapa koneksinya terpisah dari MSSQL_* ───────────────────────────────
 *
 * MSSQL_* yang sudah ada menunjuk J922 dengan user `guest_ro`: baca-saja,
 * untuk MENARIK data mesin. Tujuan SAP adalah sebaliknya — database lain,
 * user yang boleh MENULIS. Memakai satu set kredensial untuk dua arah berarti
 * memberi hak tulis pada koneksi yang seharusnya hanya membaca, dan itu hak
 * yang tidak akan pernah dicabut lagi setelah terlanjur diberikan.
 *
 * Karena itu SAP_MSSQL_* berdiri sendiri. Lihat .env.example.
 */
@Injectable()
export class SapWriterService {
  private readonly logger = new Logger(SapWriterService.name);

  constructor(@InjectDb() private readonly db: Database) {}

  get aktif(): boolean {
    return process.env.SAP_MSSQL_ENABLED === 'true';
  }

  async flush(): Promise<{ terkirim: number; gagal: number; dilewati: number }> {
    const antre = await this.db
      .select()
      .from(sapOutbox)
      .where(and(eq(sapOutbox.status, 'PENDING'), lt(sapOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(asc(sapOutbox.occurredAt))
      .limit(100);

    if (antre.length === 0) return { terkirim: 0, gagal: 0, dilewati: 0 };

    if (!this.aktif) {
      /*
       * Dokumennya TIDAK ditandai apa pun saat pengiriman mati.
       *
       * Menandainya SENT akan berbohong; menandainya FAILED akan menghabiskan
       * jatah percobaan sebelum servernya bahkan tersedia. Dibiarkan PENDING,
       * sehingga begitu SAP_MSSQL_ENABLED dinyalakan seluruh tunggakan
       * terkirim apa adanya.
       */
      this.logger.debug(`${antre.length} dokumen menunggu; pengiriman ke SAP belum dinyalakan`);
      return { terkirim: 0, gagal: 0, dilewati: antre.length };
    }

    let terkirim = 0;
    let gagal = 0;

    for (const row of antre) {
      try {
        const sapDocNumber = await this.kirimKeMsSql(row);
        await this.db
          .update(sapOutbox)
          .set({
            status: 'SENT',
            sentAt: new Date(),
            sapDocNumber,
            lastError: null,
            attempts: row.attempts + 1,
          })
          .where(eq(sapOutbox.id, row.id));
        terkirim++;
      } catch (err) {
        const pesan = err instanceof Error ? err.message : String(err);
        await this.db
          .update(sapOutbox)
          .set({
            status: 'FAILED',
            attempts: row.attempts + 1,
            lastError: pesan.slice(0, 1000),
          })
          .where(eq(sapOutbox.id, row.id));
        gagal++;
        this.logger.warn(`dokumen outbox ${row.id} gagal dikirim: ${pesan}`);
      }
    }

    this.logger.log(`kirim ke SAP: ${terkirim} berhasil, ${gagal} gagal`);
    return { terkirim, gagal, dilewati: 0 };
  }

  /**
   * BELUM DIIMPLEMENTASIKAN — kerangka, bukan kode yang berjalan.
   *
   * Yang harus dikerjakan saat menyambungkannya:
   *
   *  1. Tambahkan paket `mssql`, baca kredensial dari SAP_MSSQL_*.
   *  2. Sepakati BENTUK TABEL di sisi MS SQL bersama tim SAP. Dugaan awal:
   *     satu tabel kepala + satu tabel baris, mengikuti penamaan mereka
   *     (mis. TT_MES_MOVEMENT_H / _L).
   *  3. Kirim `IDEMPOTENCY_KEY` ikut serta, dan minta sisi MS SQL memberinya
   *     unique index. Itulah yang menahan dokumen dobel saat jaringan
   *     tersendat — bukan logika di sini.
   *  4. Sepakati apakah nomor dokumen material dari SAP dikembalikan. Kalau
   *     ya, kembalikan dari fungsi ini supaya tersimpan di SAP_DOC_NUMBER dan
   *     jejaknya bisa ditelusuri dua arah.
   *
   * Yang perlu dipegang: koneksi ini hanya dipakai worker. Web app tidak
   * pernah menyentuh MS SQL langsung — itu penyebab request web ikut lambat
   * di sistem lama ketika jaringan ke server sedang bermasalah.
   */
  private async kirimKeMsSql(row: typeof sapOutbox.$inferSelect): Promise<string | null> {
    void row;
    throw new Error(
      'Pengiriman ke MS SQL belum diimplementasikan. ' +
        'Bentuk tabel tujuan dan movement type harus disepakati tim SAP lebih dulu.',
    );
  }
}
