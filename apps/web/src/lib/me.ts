import 'server-only';
import type { RoleKind, ProcessGroup } from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from './api';

export interface ProfilSaatIni {
  id: number;
  npk: string;
  name: string;
  role: string | null;
  roleLabel: string | null;
  roleKind: RoleKind | null;
  roleProcessGroup: ProcessGroup | null;
  plantId: number | null;
  plantCode: string | null;
  landing: string;
}

/**
 * Hasil pembacaan profil.
 *
 * Tiga keadaan, bukan dua, dan pembedanya penting:
 *
 *   ada          jabatannya diketahui
 *   sesi-habis   token tidak berlaku lagi -> masuk kembali memang jalan keluarnya
 *   tak-terbaca  API tidak menjawab -> masuk kembali TIDAK menolong sama sekali
 *
 * Menggabungkan dua yang terakhir menjadi "tidak berhak" membuat orang dilempar
 * ke halaman masuk berulang kali saat API sedang mati: ia berhasil masuk, dibawa
 * ke halaman yang dituju, lalu dilempar kembali — tanpa pernah tahu bahwa yang
 * bermasalah bukan dirinya.
 */
export type HasilProfil =
  | { keadaan: 'ada'; profil: ProfilSaatIni }
  | { keadaan: 'sesi-habis' }
  | { keadaan: 'tak-terbaca'; sebab: string };

/**
 * Jabatan orang yang sedang masuk, dibaca dari DATABASE lewat API.
 *
 * Berbeda dari getSessionUser() yang membaca isi token tanpa verifikasi. Isi
 * token adalah salinan pada saat login dan berlaku delapan jam — basi begitu
 * role orangnya diubah, dan kosong sama sekali pada token yang diterbitkan API
 * versi lama.
 *
 * Dipakai untuk apa pun yang MENENTUKAN boleh atau tidak. getSessionUser()
 * hanya untuk menggambar nama di layar.
 */
export async function getProfilSaatIni(): Promise<HasilProfil> {
  try {
    return { keadaan: 'ada', profil: await apiFetch<ProfilSaatIni>('/me') };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 401) {
      return { keadaan: 'sesi-habis' };
    }
    /*
     * 404 ikut di sini, bukan dianggap sesi habis.
     *
     * API yang belum dinyalakan ulang setelah endpoint /me ditambahkan akan
     * menjawab 404 — dan melempar orangnya ke halaman masuk pada keadaan itu
     * membuat seluruh layar admin terlihat rusak permanen, padahal cukup
     * menyalakan ulang API.
     */
    return {
      keadaan: 'tak-terbaca',
      sebab: err instanceof ApiRequestError ? err.message : 'API tidak bisa dihubungi',
    };
  }
}
