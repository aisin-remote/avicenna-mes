import { BadRequestException, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { type Database } from '@avicenna/db';
import { settings } from '@avicenna/db';
import {
  PENGATURAN,
  definisiPengaturan,
  tafsirSaklar,
  type NilaiPengaturan,
  type SumberPengaturan,
} from '@avicenna/contracts';
import { InjectDb } from '../db/db.module';

/** Seberapa lama snapshot dianggap masih segar sebelum dibaca ulang. */
const UMUR_SNAPSHOT_MS = 15_000;

type Baris = { value: string; by: string | null; at: Date };

/**
 * Pengaturan sistem: nilai yang berlaku, dan tempat mengubahnya.
 *
 * ── Kenapa ada pembacaan yang TIDAK async ───────────────────────────────────
 *
 * `StagingDbService.dorongAktif` ditanyakan sekali per dokumen yang didorong,
 * dan satu putaran bisa ratusan dokumen. Kalau pembacaannya menyentuh database
 * tiap kali, satu saklar boolean menambah ratusan kueri per putaran; kalau
 * getter-nya dijadikan async, tujuh pemanggil di jalur dorong, tarik, dan
 * worker harus ikut berubah tanpa ada yang bertambah benar.
 *
 * Jadi nilainya disimpan sebagai snapshot di memori: dimuat saat modul start,
 * DIPERBARUI LANGSUNG saat ada yang menulis lewat layar, dan dibaca ulang
 * sendiri setelah beberapa belas detik.
 *
 * Yang terakhir itu bukan kemewahan. Menulis lewat layar memperbarui snapshot
 * di proses yang sama, tetapi perubahan yang dilakukan orang langsung di
 * database — atau oleh proses worker terpisah nanti — tidak melewati jalur
 * ini. Tanpa pembacaan ulang berkala, perubahan seperti itu baru terlihat
 * setelah API di-restart, dan "sudah saya ubah kok tidak jalan" adalah
 * kebingungan yang layar ini justru dibuat untuk menghilangkan.
 */
@Injectable()
export class SettingService implements OnModuleInit {
  private readonly logger = new Logger(SettingService.name);
  private snapshot = new Map<string, Baris>();
  private segarSampai = 0;
  private sedangMuat: Promise<void> | null = null;

  constructor(@InjectDb() private readonly db: Database) {}

  /**
   * Memuat snapshot saat start.
   *
   * Kegagalannya DICATAT, bukan dilempar: API tidak boleh gagal start hanya
   * karena tabel pengaturan belum ada migrasinya. Tanpa snapshot, setiap
   * saklar jatuh ke .env — persis perilaku sebelum layar ini ada.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.muat();
    } catch (err) {
      this.logger.warn(
        `snapshot pengaturan gagal dimuat saat start, seluruh saklar memakai .env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async muat(): Promise<void> {
    const rows = await this.db
      .select({
        key: settings.key,
        value: settings.value,
        updatedBy: settings.updatedBy,
        updatedAt: settings.updatedAt,
      })
      .from(settings);
    this.snapshot = new Map(
      rows.map((r) => [r.key, { value: r.value, by: r.updatedBy, at: r.updatedAt }]),
    );
    this.segarSampai = Date.now() + UMUR_SNAPSHOT_MS;
  }

  /** Membaca ulang bila snapshot sudah lewat umurnya. Satu pembacaan dibagi bersama. */
  private async segarkan(): Promise<void> {
    if (Date.now() < this.segarSampai) return;
    this.sedangMuat ??= this.muat().finally(() => {
      this.sedangMuat = null;
    });
    await this.sedangMuat;
  }

  private hitung(key: string, baris: Baris | undefined): boolean {
    const def = definisiPengaturan(key);
    if (!def) throw new BadRequestException(`Pengaturan "${key}" tidak dikenal`);
    if (baris) return tafsirSaklar(baris.value, def.bawaan);
    return tafsirSaklar(process.env[def.env], def.bawaan);
  }

  /**
   * Nilai yang BERLAKU, dari snapshot — tanpa menyentuh database.
   *
   * Dipakai jalur panas. Urutan menang: baris di tabel, lalu environment
   * variable, lalu bawaan di registry. Lihat catatan di
   * @avicenna/contracts/setting soal kenapa tabel yang menang, bukan .env.
   *
   * Pembacaan ulang berkala dipicu di sini tanpa ditunggu: pemanggil ini tidak
   * boleh menunggu I/O, dan nilai yang terlambat belasan detik jauh lebih baik
   * daripada jalur dorong yang menggantung menunggu kueri.
   */
  aktifSekarang(key: string): boolean {
    if (Date.now() >= this.segarSampai) {
      void this.segarkan().catch(() => {
        /* Sudah dicatat di muat(); gagal menyegarkan berarti snapshot lama
           tetap dipakai, dan itu memang perilaku yang diinginkan. */
      });
    }
    return this.hitung(key, this.snapshot.get(key));
  }

  /** Seperti `aktifSekarang`, tetapi menunggu snapshot segar lebih dulu. */
  async aktif(key: string): Promise<boolean> {
    await this.segarkan();
    return this.hitung(key, this.snapshot.get(key));
  }

  /** Seluruh pengaturan beserta nilai yang berlaku dan asalnya. */
  async daftar(): Promise<NilaiPengaturan[]> {
    await this.segarkan();
    return PENGATURAN.map((def) => {
      const baris = this.snapshot.get(def.key);
      const dariEnv = process.env[def.env];
      let sumber: SumberPengaturan;
      if (baris) sumber = 'tabel';
      else if (dariEnv !== undefined && dariEnv.trim() !== '') sumber = 'env';
      else sumber = 'bawaan';
      return {
        key: def.key,
        nilai: this.hitung(def.key, baris),
        sumber,
        diubahOleh: baris?.by ?? null,
        diubahPada: baris?.at ? baris.at.toISOString() : null,
      };
    });
  }

  /**
   * Mengubah satu saklar.
   *
   * Nama pengaturan diperiksa terhadap registry, bukan diterima apa adanya:
   * tanpa itu, kunci karangan akan membuat baris yang tidak pernah dibaca
   * siapa pun dan tabelnya perlahan berisi sampah yang tampak bermakna.
   */
  async ubah(key: string, nilai: boolean, olehNpk: string | null): Promise<NilaiPengaturan[]> {
    if (!definisiPengaturan(key)) {
      throw new BadRequestException(`Pengaturan "${key}" tidak dikenal`);
    }

    const teks = nilai ? 'true' : 'false';
    const sekarang = new Date();
    await this.db
      .insert(settings)
      .values({ key, value: teks, updatedBy: olehNpk })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: teks, updatedBy: olehNpk, updatedAt: sekarang },
      });

    /*
     * Snapshot diperbarui LANGSUNG, bukan sekadar dibuang.
     *
     * Jalur panas membacanya tanpa await; kalau di sini hanya dibuang, ada
     * jendela di mana saklar sudah tertulis di database tetapi pembacaan
     * berikutnya masih mengembalikan nilai lama — dan jendela itu tepat saat
     * orang baru menggeser saklarnya lalu langsung memeriksa hasilnya.
     */
    this.snapshot.set(key, { value: teks, by: olehNpk, at: sekarang });

    this.logger.log(`pengaturan ${key} diubah menjadi ${teks} oleh ${olehNpk ?? '(tanpa npk)'}`);
    return this.daftar();
  }
}
