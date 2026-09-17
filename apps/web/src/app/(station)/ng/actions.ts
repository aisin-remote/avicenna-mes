'use server';

import type { NgResult, NgOnUnit, NgType, ProcessType } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

/*
 * Server Action, bukan fetch dari browser: token sesi tersimpan di cookie
 * httpOnly yang sengaja tidak bisa dibaca skrip halaman.
 *
 * Tidak ada revalidatePath di mana pun di berkas ini — layar NG memperbarui
 * dirinya dari jawaban yang dikembalikan. Memuat ulang halaman di antara dua
 * scan membuat fokus lepas dari kotak input, dan scan berikutnya hilang tanpa
 * jejak.
 */

function pesan(err: unknown): { error: string } {
  if (err instanceof ApiRequestError) return { error: err.message };
  return { error: 'Tidak bisa menghubungi server. Periksa jaringan.' };
}

/** Jenis NG yang berlaku di sebuah grup proses — isi tombol di layar. */
export async function jenisNgAction(
  grup?: string,
): Promise<{ jenis: NgType[] } | { error: string }> {
  try {
    const q = grup ? `?grup=${encodeURIComponent(grup)}` : '';
    return await apiFetch<{ jenis: NgType[] }>(`/ng/jenis${q}`);
  } catch (err) {
    return pesan(err);
  }
}

export interface UnitDiperiksa {
  rawCode: string;
  partNumber: string;
  partName: string;
  serialNumber: string;
  adaScanProduksi: boolean;
  processType: ProcessType | null;
  ngAktif: NgOnUnit[];
}

/**
 * Memeriksa barang sebelum jenis NG-nya dipilih.
 *
 * Mengembalikan juga apakah barangnya pernah tercatat sebagai hasil BAIK,
 * supaya operator tahu lebih dulu bahwa mencapnya NG akan mengurangi stok —
 * bukan mengetahuinya setelah angka produksinya turun.
 */
export async function periksaUnitAction(
  rawCode: string,
  lineCode?: string,
): Promise<UnitDiperiksa | { error: string }> {
  try {
    const q = new URLSearchParams({ code: rawCode });
    if (lineCode) q.set('line', lineCode);
    return await apiFetch<UnitDiperiksa>(`/ng/unit?${q.toString()}`);
  } catch (err) {
    return pesan(err);
  }
}

/** NG inline — ketemu di lini, barangnya di tangan operator. */
export async function ngInlineAction(input: {
  rawCode: string;
  lineCode: string;
  ngMasterId: number;
  qty?: number;
}): Promise<NgResult | { error: string }> {
  try {
    return await apiFetch<NgResult>('/ng/inline', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return pesan(err);
  }
}

/** NG outline — ketemu di luar lini, lewat part code atau lewat kanban. */
export async function ngOutlineAction(input: {
  rawCode: string;
  via: 'PART_CODE' | 'KANBAN';
  ngMasterId: number;
  lineCode?: string;
  qty?: number;
}): Promise<NgResult | { error: string }> {
  try {
    return await apiFetch<NgResult>('/ng/outline', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  } catch (err) {
    return pesan(err);
  }
}

/**
 * Membatalkan catatan NG.
 *
 * Di layar lama, menekan tombol jenis NG yang sama dua kali MENGHAPUS barisnya.
 * Di sini barisnya tetap ada dan hanya ditandai batal — salah tekan tidak boleh
 * membuat angka NG kemarin berubah tanpa jejak.
 */
export async function batalNgAction(
  id: number,
  reason?: string,
): Promise<{ id: number; ngAktif: NgOnUnit[] } | { error: string }> {
  try {
    return await apiFetch<{ id: number; ngAktif: NgOnUnit[] }>('/ng/batal', {
      method: 'POST',
      body: JSON.stringify({ id, reason }),
    });
  } catch (err) {
    return pesan(err);
  }
}
