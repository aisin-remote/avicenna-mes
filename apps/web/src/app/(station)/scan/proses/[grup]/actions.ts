'use server';

import { redirect } from 'next/navigation';
import { apiFetch, ApiRequestError } from '@/lib/api';
import { clearToken } from '@/lib/session';
import type { StationSummary } from '@avicenna/contracts';

/**
 * Membuka lini dari barcode yang discan operator.
 *
 * Kewenangan role diperiksa SERVER, bukan di sini — endpoint scan bisa
 * dipanggil langsung, dan pembatasan yang hanya ada di browser bukan
 * pembatasan. Aksi ini hanya meneruskan jawabannya ke layar.
 */
export async function bukaLiniAction(
  grup: string,
  code: string,
): Promise<{ summary: StationSummary } | { error: string }> {
  try {
    const summary = await apiFetch<StationSummary>(
      `/scan/proses/${encodeURIComponent(grup)}/open`,
      { method: 'POST', body: JSON.stringify({ code }) },
    );
    return { summary };
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server.' };
  }
}

/**
 * Keluar dari layar stasiun karena ada yang men-scan kartu login.
 *
 * ── Kenapa keluar, bukan langsung berganti orang ────────────────────────────
 *
 * Kartu tidak diperiksa di sini, dan memang tidak perlu: yang dilakukan hanya
 * mengakhiri sesi yang sedang berjalan. Orang berikutnya masuk di halaman
 * login, tempat kartunya dibaca dan diperiksa seperti biasa — satu tempat untuk
 * memeriksa kredensial, bukan dua.
 *
 * Akibatnya yang harus diterima: kartu yang salah atau milik orang yang sudah
 * tidak aktif tetap mengeluarkan operator yang sedang bekerja, dan ia harus
 * masuk lagi. Itu disengaja — memeriksa kartu lebih dulu berarti layar stasiun
 * ikut memegang urusan kredensial, dan sesi yang "kadang keluar kadang tidak"
 * jauh lebih membingungkan di lantai produksi daripada yang selalu keluar.
 */
export async function keluarStasiunAction(): Promise<void> {
  await clearToken();
  redirect('/login');
}
