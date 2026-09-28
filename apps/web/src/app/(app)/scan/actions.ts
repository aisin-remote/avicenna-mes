'use server';

import type { SampleCheck, StationResult } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/**
 * Mengirim satu scan dari layar stasiun.
 *
 * Server Action, bukan fetch dari browser: token sesi tersimpan di cookie
 * httpOnly yang sengaja tidak bisa dibaca skrip halaman. Perantaraan di server
 * membuat token tidak perlu diturunkan ke klien sama sekali.
 *
 * Sengaja tidak memakai revalidatePath: layar ini memperbarui dirinya sendiri
 * dari hasil yang dikembalikan. Memuat ulang seluruh halaman di antara dua
 * scan yang datang beruntun justru membuat operator menunggu.
 */
export async function submitScanAction(input: {
  rawCode: string;
  lineCode: string;
  clientRef: string;
  /** Lini per-kanban: barcode kartu, dikirim bersama nomor part sample sebagai rawCode. */
  kanbanCode?: string;
}): Promise<StationResult | { error: string }> {
  try {
    return await apiFetch<StationResult>('/scan/station', {
      method: 'POST',
      body: JSON.stringify({
        kind: 'PRODUCTION',
        rawCode: input.rawCode,
        lineCode: input.lineCode,
        clientRef: input.clientRef,
        ...(input.kanbanCode ? { kanbanCode: input.kanbanCode } : {}),
      }),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
  }
}

/**
 * Memeriksa satu scan tanpa menulis — bentuk jawabannya sama dengan submit.
 *
 * Lini FG per barang menahan part sampai box penuh, baru men-scan kartu.
 * Part yang ditahan diperiksa di sini dulu supaya yang duplikat atau salah
 * lini ketahuan saat dipegang, bukan setelah satu box dan kartunya discan.
 */
export async function periksaScanAction(input: {
  rawCode: string;
  lineCode: string;
}): Promise<StationResult | { error: string }> {
  try {
    return await apiFetch<StationResult>('/scan/station/periksa', {
      method: 'POST',
      body: JSON.stringify({ kind: 'PRODUCTION', rawCode: input.rawCode, lineCode: input.lineCode }),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
  }
}

/**
 * Memeriksa master sample yang discan di awal shift pada lini per-kanban.
 *
 * Hanya membaca. Yang lolos disimpan layar dan dipakai untuk semua scan kanban
 * berikutnya; yang ditolak ditampilkan besar supaya operator mengambil sample
 * yang benar sebelum satu pun kanban tercatat.
 */
export async function periksaSampleAction(input: {
  code: string;
  lineCode: string;
}): Promise<SampleCheck | { error: string }> {
  try {
    const q = new URLSearchParams({ code: input.code, line: input.lineCode });
    return await apiFetch<SampleCheck>(`/scan/sample?${q.toString()}`);
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
  }
}
