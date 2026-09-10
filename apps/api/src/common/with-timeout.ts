/**
 * Menolak setelah `ms` milidetik kalau promise-nya belum selesai.
 *
 * Dibutuhkan di beberapa tempat karena klien Redis yang dipakai BullMQ harus
 * dikonfigurasi `maxRetriesPerRequest: null`. Konsekuensinya, saat Redis mati
 * perintah tidak gagal — ia mengantre tanpa batas. Tanpa pembungkus ini,
 * pemeriksaan kesehatan dan pemasukan job akan menggantung persis pada saat
 * keduanya paling dibutuhkan.
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} melewati batas ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
