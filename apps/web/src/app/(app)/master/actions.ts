'use server';

import { revalidatePath } from 'next/cache';
import {
  isMasterEntity,
  getEntityDef,
  MAKS_UKURAN_IMPOR,
  type MasterEntity,
  type HasilImpor, MAKS_UKURAN_FOTO} from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export interface FormState {
  ok?: boolean;
  error?: string;
  /** Galat per kolom, ditampilkan tepat di bawah input yang bersangkutan. */
  fieldErrors?: Record<string, string>;
}

interface ApiValidationBody {
  message?: string;
  details?: Array<{ field: string; message: string }>;
}

/**
 * Menyimpan data master (buat baru atau ubah).
 *
 * Semua penulisan lewat API, tidak langsung ke database — aturan bisnis,
 * penerjemahan galat, dan (nanti) audit hanya ada di satu tempat.
 *
 * Server Action ini sengaja tipis: memformat masukan, memanggil API, lalu
 * menerjemahkan hasilnya. Pekerjaan berat tidak boleh dikerjakan di sini
 * karena akan menahan request Next.js.
 */
export async function saveMasterAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const entity = String(formData.get('__entity') ?? '');
  const idRaw = String(formData.get('__id') ?? '');

  if (!isMasterEntity(entity)) {
    return { error: `Entitas "${entity}" tidak dikenal` };
  }

  const def = getEntityDef(entity);
  const payload: Record<string, unknown> = {};

  for (const field of def.fields) {
    const raw = formData.get(field.name);
    if (field.kind === 'boolean') {
      // Checkbox tidak mengirim apa pun saat tidak dicentang, jadi nilainya
      // diturunkan dari keberadaan — bukan dari isi.
      payload[field.name] = raw !== null;
      continue;
    }
    if (raw === null) continue;
    payload[field.name] = String(raw);
  }

  const isEdit = idRaw !== '';

  try {
    await apiFetch(isEdit ? `/master/${entity}/${idRaw}` : `/master/${entity}`, {
      method: isEdit ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) {
      const body = err.body as ApiValidationBody | undefined;
      if (body?.details?.length) {
        const fieldErrors: Record<string, string> = {};
        for (const d of body.details) fieldErrors[d.field] = d.message;
        return { error: body.message ?? 'Data tidak valid', fieldErrors };
      }
      return { error: err.message };
    }
    return { error: 'Tidak bisa menghubungi server API' };
  }

  revalidatePath(`/master/${entity}`);
  return { ok: true };
}

/** Menghapus permanen. Ditolak API bila datanya masih dirujuk data lain. */
export async function deleteMasterAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const entity = String(formData.get('__entity') ?? '');
  const id = String(formData.get('__id') ?? '');
  if (!isMasterEntity(entity) || !id) return { error: 'Permintaan tidak lengkap' };

  try {
    await apiFetch(`/master/${entity}/${id}`, { method: 'DELETE' });
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : 'Gagal menghapus' };
  }

  revalidatePath(`/master/${entity}`);
  return { ok: true };
}

/** Mengaktifkan atau menonaktifkan — jalur aman untuk data yang sudah dipakai. */
export async function toggleActiveAction(
  entity: MasterEntity,
  id: number,
  isActive: boolean,
): Promise<FormState> {
  try {
    await apiFetch(`/master/${entity}/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  } catch (err) {
    return { error: err instanceof ApiRequestError ? err.message : 'Gagal mengubah status' };
  }
  revalidatePath(`/master/${entity}`);
  return { ok: true };
}

/**
 * Mengunggah berkas Excel ke sebuah master.
 *
 * Dua tahap, dan tahap pertama tidak menulis apa pun: layar memanggil dengan
 * `ujiSaja` untuk menampilkan pratinjau, lalu memanggil lagi saat orang
 * menekan simpan. Unggahan master tanpa pratinjau berarti kesalahan baru
 * ketahuan setelah ratusan baris masuk — dan membatalkannya berarti menghapus
 * baris satu per satu.
 */
export async function imporMasterAction(
  entity: string,
  formData: FormData,
  ujiSaja: boolean,
): Promise<HasilImpor | { error: string }> {
  if (!isMasterEntity(entity)) return { error: `Entitas "${entity}" tidak dikenal` };

  const berkas = formData.get('berkas');
  if (!(berkas instanceof File) || berkas.size === 0) {
    return { error: 'Berkas belum dipilih.' };
  }
  if (berkas.size > MAKS_UKURAN_IMPOR) {
    return {
      error: `Berkas ${(berkas.size / 1024 / 1024).toFixed(1)} MB melebihi batas ${
        MAKS_UKURAN_IMPOR / 1024 / 1024
      } MB.`,
    };
  }

  const b64 = Buffer.from(await berkas.arrayBuffer()).toString('base64');

  try {
    const hasil = await apiFetch<HasilImpor>(`/master/${entity}/import`, {
      method: 'POST',
      body: JSON.stringify({ fileBase64: b64, ujiSaja }),
    });
    // Hanya menyegarkan saat benar-benar menulis; pratinjau tidak mengubah apa pun.
    if (!ujiSaja && hasil.ditulis > 0) revalidatePath(`/master/${entity}`);
    return hasil;
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }
}

/**
 * Mengunggah satu gambar ke penyimpanan aplikasi.
 *
 * Dipanggil formulir master saat orang memilih berkas, sebelum barisnya
 * disimpan. Dilakukan lewat Server Action karena token sesi ada di cookie
 * httpOnly yang sengaja tidak bisa dibaca skrip halaman.
 */
export async function unggahFotoAction(
  formData: FormData,
): Promise<{ nama: string } | { error: string }> {
  const berkas = formData.get('file');
  if (!(berkas instanceof File) || berkas.size === 0) {
    return { error: 'Berkas tidak terbaca. Pilih ulang gambarnya.' };
  }
  if (berkas.size > MAKS_UKURAN_FOTO) {
    const mb = (MAKS_UKURAN_FOTO / 1024 / 1024).toFixed(1);
    return { error: `Gambar lebih dari ${mb} MB. Perkecil dulu.` };
  }

  try {
    const fileBase64 = Buffer.from(await berkas.arrayBuffer()).toString('base64');
    return await apiFetch<{ nama: string }>('/master/foto', {
      method: 'POST',
      body: JSON.stringify({ fileBase64, mimeType: berkas.type }),
    });
  } catch (err) {
    if (err instanceof ApiRequestError) return { error: err.message };
    return { error: 'Tidak bisa menghubungi server API' };
  }
}
