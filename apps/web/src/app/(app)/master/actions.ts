'use server';

import { revalidatePath } from 'next/cache';
import { isMasterEntity, getEntityDef, type MasterEntity } from '@avicenna/contracts';
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
