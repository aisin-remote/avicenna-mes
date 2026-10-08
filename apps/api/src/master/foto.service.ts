import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, extname, basename } from 'node:path';
import { JENIS_FOTO_DITERIMA, MAKS_UKURAN_FOTO } from '@avicenna/contracts';

/** Akhiran berkas yang sah per jenis gambar yang diterima. */
const AKHIRAN: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

/**
 * Penyimpanan berkas gambar milik aplikasi.
 *
 * ── Kenapa di API, bukan di folder publik web ───────────────────────────────
 *
 * Folder publik Next ikut dibungkus ke dalam image saat build; berkas yang
 * ditulis saat aplikasi berjalan akan HILANG pada penerapan berikutnya, dan
 * hilangnya tidak terlihat sampai operator membuka layar scan dan gambarnya
 * kosong. Di sini berkas berada di satu folder yang bisa dipasangi volume,
 * sejajar dengan data lain yang dimiliki API.
 *
 * ── Kenapa base64, bukan multipart ──────────────────────────────────────────
 *
 * Mengikuti jalur yang sudah dipakai impor Excel di controller yang sama.
 * Menambah multipart berarti menambah pustaka dan satu cara kedua mengunggah
 * berkas di aplikasi yang sama.
 */
@Injectable()
export class FotoService {
  private readonly logger = new Logger(FotoService.name);

  /** Folder penyimpanan; bisa diarahkan ke volume lewat FOTO_DIR. */
  private readonly dir = resolve(
    (process.env.FOTO_DIR ?? '').trim() || join(process.cwd(), '..', '..', 'storage', 'foto'),
  );

  /**
   * Menyimpan satu gambar, mengembalikan nama berkasnya.
   *
   * Namanya DIBUAT SISTEM, bukan diambil dari nama berkas pengguna: nama asli
   * bisa memuat "../", spasi, atau huruf yang tidak sah di sistem berkas lain,
   * dan dua orang yang mengunggah "foto.jpg" akan saling menimpa.
   */
  async simpan(input: { fileBase64: string; mimeType?: string | null }): Promise<string> {
    const mime = (input.mimeType ?? '').trim().toLowerCase();
    if (!JENIS_FOTO_DITERIMA.includes(mime as (typeof JENIS_FOTO_DITERIMA)[number])) {
      throw new BadRequestException(
        `Jenis berkas "${mime || 'tidak dikenal'}" tidak diterima. Pakai JPG, PNG, atau WebP.`,
      );
    }

    let isi: Buffer;
    try {
      isi = Buffer.from(input.fileBase64, 'base64');
    } catch {
      throw new BadRequestException('Berkas gambar tidak terbaca.');
    }
    if (isi.length === 0) throw new BadRequestException('Berkas gambar kosong.');
    if (isi.length > MAKS_UKURAN_FOTO) {
      const mb = (MAKS_UKURAN_FOTO / 1024 / 1024).toFixed(1);
      throw new BadRequestException(`Gambar lebih dari ${mb} MB. Perkecil dulu.`);
    }

    /*
     * Isi berkas diperiksa, bukan hanya jenis yang DIAKUI pengirim.
     *
     * Jenis berkas datang dari browser dan bisa dikarang. Yang disajikan nanti
     * sebagai gambar harus benar-benar gambar — berkas lain yang menyamar akan
     * disajikan dengan tipe gambar dan itu lubang yang tidak perlu ada.
     */
    if (!this.terlihatGambar(isi, mime)) {
      throw new BadRequestException('Isi berkas bukan gambar JPG, PNG, atau WebP.');
    }

    await mkdir(this.dir, { recursive: true });
    const nama = `${randomUUID()}${AKHIRAN[mime]}`;
    await writeFile(join(this.dir, nama), isi);
    this.logger.log(`foto disimpan: ${nama} (${isi.length} byte)`);
    return nama;
  }

  /** Membaca satu gambar untuk disajikan. */
  async baca(nama: string): Promise<{ isi: Buffer; mimeType: string; etag: string }> {
    const aman = this.namaAman(nama);
    const berkas = join(this.dir, aman);
    /*
     * Dicek LAGI setelah digabung: `basename` sudah membuang "../", tetapi
     * yang menentukan aman atau tidak adalah berkas yang benar-benar dibuka,
     * bukan nama yang sudah dibersihkan beberapa baris sebelumnya.
     */
    if (!resolve(berkas).startsWith(this.dir) || !existsSync(berkas)) {
      throw new NotFoundException('Gambar tidak ditemukan.');
    }
    const isi = await readFile(berkas);
    const ext = extname(aman).toLowerCase();
    const mimeType =
      Object.entries(AKHIRAN).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    return { isi, mimeType, etag: createHash('sha256').update(isi).digest('hex').slice(0, 32) };
  }

  /**
   * Menghapus gambar yang sudah tidak dirujuk.
   *
   * Gagal menghapus TIDAK dianggap kesalahan: berkas yatim hanya memakan ruang,
   * sedangkan menggagalkan penyimpanan master karena berkas lama tidak bisa
   * dihapus akan menghalangi pekerjaan yang sebenarnya sudah benar.
   */
  async hapusDiam(nama: string | null | undefined): Promise<void> {
    const v = (nama ?? '').trim();
    if (!v || /^https?:\/\//i.test(v)) return;
    try {
      await unlink(join(this.dir, this.namaAman(v)));
    } catch (err) {
      this.logger.debug(`foto lama tidak terhapus (${v}): ${String(err)}`);
    }
  }

  /** Membuang segala bentuk jalur; hanya nama berkas yang boleh lewat. */
  private namaAman(nama: string): string {
    const bersih = basename((nama ?? '').trim());
    if (!bersih || bersih.startsWith('.')) throw new NotFoundException('Nama berkas tidak sah.');
    return bersih;
  }

  /** Tanda pengenal di awal berkas — pemeriksaan isi, bukan pengakuan pengirim. */
  private terlihatGambar(isi: Buffer, mime: string): boolean {
    if (isi.length < 12) return false;
    if (mime === 'image/jpeg') return isi[0] === 0xff && isi[1] === 0xd8 && isi[2] === 0xff;
    if (mime === 'image/png') {
      return isi.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    if (mime === 'image/webp') {
      return isi.subarray(0, 4).toString() === 'RIFF' && isi.subarray(8, 12).toString() === 'WEBP';
    }
    return false;
  }
}
