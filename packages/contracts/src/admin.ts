import { z } from 'zod';
import { ROLE_KINDS, PROCESS_GROUPS } from './common';
import { MENU_GROUPS } from './menu';

/**
 * ─── PENGGUNA DAN ROLE ──────────────────────────────────────────────────────
 *
 * ── Satu role per pengguna ──────────────────────────────────────────────────
 *
 * Sistem lama memakai tabel sambung `user_has_roles`, sehingga satu orang bisa
 * memegang beberapa role sekaligus. Di sini sengaja satu.
 *
 * Alasannya bukan penyederhanaan demi rapi, melainkan karena role di sini
 * MENENTUKAN TINDAKAN, bukan sekadar mengumpulkan hak: jabatan (SCANNING /
 * VIEW / ADMIN) menentukan halaman awal sesudah login dan lini mana yang boleh
 * discan. Dengan dua role, "halaman awal" tidak punya jawaban, dan "boleh
 * scan di lini ini?" dijawab oleh role yang mana — pertanyaan yang tidak akan
 * pernah dijawab konsisten oleh kode mana pun.
 *
 * Kalau nanti satu orang benar-benar merangkap dua jabatan, jawabannya adalah
 * role ketiga yang menyebut rangkapan itu, bukan dua baris di tabel sambung.
 */

export const roleKindSchema = z.enum(ROLE_KINDS);
export const processGroupSchema = z.enum(PROCESS_GROUPS);

/** Kosong dari formulir HTML berarti "tidak diisi", bukan string kosong. */
const opsionalTeks = (max: number) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().max(max).optional());

/* ── Role ─────────────────────────────────────────────────────────────────── */

export const roleCreateSchema = z.object({
  /**
   * Nama teknis, dipakai di kode dan token. Huruf kecil dan garis bawah supaya
   * tidak berubah bentuk saat ditulis ulang di tempat lain.
   */
  name: z
    .string()
    .trim()
    .min(2, 'Nama role wajib diisi')
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, 'Nama role hanya huruf kecil, angka, dan garis bawah'),
  /** Nama yang dibaca orang, mis. "Casting Lasman". */
  label: opsionalTeks(128),
  kind: roleKindSchema,
  /** Kosong berarti seluruh proses. */
  processGroup: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    processGroupSchema.optional(),
  ),
  isActive: z.preprocess(
    (v) => (v === undefined || v === null ? true : v === 'on' || v === 'true' || v === true),
    z.boolean(),
  ),
  /**
   * Menu yang boleh dilihat pemegang role ini.
   *
   * Ikut dalam pembuatan role, bukan langkah kedua terpisah: role tanpa satu
   * menu pun adalah akun yang bisa masuk lalu menatap halaman kosong, dan itu
   * keadaan yang paling sering terjadi kalau langkahnya bisa dilewati.
   */
  menuKeys: z.array(z.string()).default([]),
});
export type RoleCreateInput = z.infer<typeof roleCreateSchema>;

export const roleUpdateSchema = roleCreateSchema.partial().extend({
  // Nama role dipakai di token yang sudah beredar; mengubahnya diperbolehkan,
  // tapi tetap harus berbentuk sah.
  name: roleCreateSchema.shape.name.optional(),
});
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;

export const roleMenusSchema = z.object({
  menuKeys: z.array(z.string()),
});
export type RoleMenusInput = z.infer<typeof roleMenusSchema>;

export interface RoleRow {
  id: number;
  name: string;
  label: string | null;
  kind: (typeof ROLE_KINDS)[number];
  processGroup: (typeof PROCESS_GROUPS)[number] | null;
  isActive: boolean;
  /** Jumlah pengguna yang memegang role ini — dibaca sebelum menghapus. */
  userCount: number;
  menuKeys: string[];
  landing: string;
}

/* ── Pengguna ─────────────────────────────────────────────────────────────── */

/**
 * Kata sandi.
 *
 * Panjang minimalnya 6, mengikuti kartu QR login yang sudah dicetak dan berisi
 * `NPK|password` dengan sandi enam angka. Menaikkannya sekarang akan membuat
 * seluruh kartu yang beredar tidak bisa dipakai pada hari pemasangan.
 */
const passwordSchema = z
  .string()
  .min(6, 'Kata sandi minimal 6 karakter')
  .max(128, 'Kata sandi maksimal 128 karakter');

export const userCreateSchema = z.object({
  npk: z
    .string()
    .trim()
    .min(1, 'NPK wajib diisi')
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'NPK hanya huruf, angka, titik, garis bawah, dan strip'),
  name: z.string().trim().min(1, 'Nama wajib diisi').max(128),
  email: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.string().trim().email('Email tidak valid').max(191).optional(),
  ),
  password: passwordSchema,
  roleId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number({ required_error: 'Role wajib dipilih' }).int().positive('Role wajib dipilih'),
  ),
  plantId: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.number().int().positive().optional(),
  ),
  isActive: z.preprocess(
    (v) => (v === undefined || v === null ? true : v === 'on' || v === 'true' || v === true),
    z.boolean(),
  ),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

/**
 * Perubahan pengguna TANPA kata sandi.
 *
 * Sandi diganti lewat endpoint tersendiri, bukan sebagai kolom di formulir ini.
 * Kolom sandi yang ikut di formulir sunting berarti setiap penyimpanan biasa
 * berpeluang menulis ulang sandi — dan yang paling sering terjadi adalah
 * mengosongkannya tanpa sengaja.
 */
export const userUpdateSchema = userCreateSchema.omit({ password: true }).partial();
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export interface UserRow {
  id: number;
  npk: string;
  name: string;
  email: string | null;
  roleId: number | null;
  roleName: string | null;
  roleLabel: string | null;
  roleKind: (typeof ROLE_KINDS)[number] | null;
  plantId: number | null;
  plantCode: string | null;
  isActive: boolean;
  /**
   * Akun tanpa kata sandi sama sekali.
   *
   * Ditampilkan karena akun begitu TIDAK bisa dipakai masuk, dan tanpa
   * penanda ini keadaannya terlihat persis sama dengan akun normal di daftar.
   */
  tanpaSandi: boolean;
}

/* ── Menu ─────────────────────────────────────────────────────────────────── */

export const menuRowSchema = z.object({
  key: z.string(),
  label: z.string(),
  href: z.string(),
  icon: z.string(),
  group: z.enum(MENU_GROUPS),
  sortOrder: z.number(),
  adminOnly: z.boolean(),
});
export type MenuRow = z.infer<typeof menuRowSchema>;
