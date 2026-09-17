import { BadRequestException } from '@nestjs/common';
import { ZodError, type ZodTypeAny, type infer as ZodInfer } from 'zod';

/**
 * Bentuk tunggal galat validasi yang keluar dari API.
 *
 * `details` per kolom BUKAN hiasan: formulir menampilkan pesannya tepat di
 * bawah input yang bersangkutan. Satu pesan di atas formulir memaksa orang
 * menebak kolom mana yang dimaksud — pada formulir pengguna ada tujuh kolom
 * untuk ditebak.
 *
 * Ditulis sekali di sini karena bentuk ini dibaca sisi web. Salinan yang
 * berbeda-beda per modul pernah membuat sebagian formulir menampilkan galat per
 * kolom dan sebagian lagi hanya "Terjadi kesalahan pada server".
 */
export function validationError(error: ZodError): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'ValidationError',
    message: 'Data yang dikirim tidak valid',
    details: error.issues.map((i) => ({
      field: i.path.join('.'),
      message: i.message,
    })),
  });
}

/**
 * Memvalidasi di dalam service, dengan galat yang berbentuk sama seperti dari
 * pipe.
 *
 * Dipakai ketika schema-nya baru diketahui saat berjalan (mis. entitas master)
 * atau ketika service memang perlu memeriksa sendiri. Memanggil `.parse()`
 * langsung di service membuat ZodError lolos ke filter dan berubah menjadi 500
 * "Terjadi kesalahan pada server" — padahal yang salah adalah isian orangnya,
 * dan ia tidak diberi tahu kolom mana.
 */
export function parseOrThrow<S extends ZodTypeAny>(schema: S, body: unknown): ZodInfer<S> {
  /*
   * Tipenya disimpulkan DARI schema-nya (ZodInfer<S>), bukan lewat parameter
   * tipe terpisah. Dengan `ZodSchema<T>`, schema yang memakai z.preprocess —
   * dan hampir semua schema formulir memakainya, karena nilai dari HTML selalu
   * string — menyimpulkan T sebagai `{}`, dan setiap field yang dibaca
   * sesudahnya kehilangan tipenya tanpa satu pun galat yang menunjuk sebabnya.
   */
  const hasil = schema.safeParse(body);
  if (!hasil.success) throw validationError(hasil.error);
  return hasil.data as ZodInfer<S>;
}

export { ZodError };
