/**
 * Alamat gambar part untuk layar scan.
 *
 * Nilai di master boleh dua bentuk, dan keduanya memang dipakai:
 *
 *   https://…/abc.jpg   alamat penuh — foto yang sudah ada di server lain
 *                       (mis. kumpulan foto PIS yang dipakai sistem lama)
 *   abc.jpg             nama berkas di penyimpanan aplikasi, hasil unggahan
 *                       dari formulir master
 *
 * Dibuat menerima keduanya supaya foto yang sudah ada di server lain tidak
 * perlu diunggah ulang hanya untuk bisa tampil.
 */
export function urlFotoPart(nilai: string | null | undefined): string | null {
  const v = (nilai ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v) || v.startsWith('/')) return v;
  return `/foto-part/${v.replace(/^\.?\/+/, '')}`;
}
