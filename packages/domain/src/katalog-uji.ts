import { katalogProses, type JenisProses } from '@avicenna/contracts';

/**
 * Katalog jenis proses untuk UJI.
 *
 * Isinya sama dengan yang dimasukkan migrasi 0006 — kosakata yang sampai
 * Oktober 2026 hidup sebagai enum di kode. Ditulis di sini supaya uji domain
 * tetap murni: tidak ada database, tetapi juga tidak ada daftar karangan yang
 * diam-diam berbeda dari yang dipakai pabrik.
 *
 * Kalau master berubah dan uji ini ikut diubah, pertanyaannya satu: apakah
 * aturannya yang berubah, atau cuma datanya? Yang berubah datanya tidak perlu
 * menyentuh berkas ini — yang diuji adalah ATURAN atas data, bukan datanya.
 */
export const BARIS_UJI: JenisProses[] = [
  {
    code: 'MELTING',
    label: 'Melting',
    processGroup: 'MELTING',
    sapClass: 'NONE',
    scanMode: 'PART_SAJA',
    sortOrder: 10,
    isActive: true,
  },
  {
    code: 'CASTING_WIP',
    label: 'Casting WIP',
    processGroup: 'CASTING',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 20,
    isActive: true,
  },
  {
    code: 'CASTING_FG',
    label: 'Casting FG',
    processGroup: 'CASTING',
    sapClass: 'FG',
    scanMode: 'PART_KANBAN',
    sortOrder: 30,
    isActive: true,
  },
  {
    code: 'MACHINING_WIP',
    label: 'Machining WIP',
    processGroup: 'MACHINING',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 40,
    isActive: true,
  },
  {
    code: 'MACHINING_FG',
    label: 'Machining FG',
    processGroup: 'MACHINING',
    sapClass: 'FG',
    scanMode: 'PART_KANBAN',
    sortOrder: 50,
    isActive: true,
  },
  {
    code: 'ASSEMBLING_UNIT_FG',
    label: 'Assembling Unit FG',
    processGroup: 'ASSEMBLING',
    sapClass: 'FG',
    scanMode: 'PART_KANBAN',
    sortOrder: 60,
    isActive: true,
  },
  {
    code: 'INJECTION_WIP',
    label: 'Injection WIP',
    processGroup: 'INJECTION',
    sapClass: 'SFG',
    scanMode: 'KANBAN_BOX',
    sortOrder: 70,
    isActive: true,
  },
  {
    code: 'INJECTION_FG',
    label: 'Injection FG',
    processGroup: 'INJECTION',
    sapClass: 'FG',
    scanMode: 'KANBAN_BOX',
    sortOrder: 80,
    isActive: true,
  },
  {
    code: 'PAINTING_WIP',
    label: 'Painting WIP',
    processGroup: 'PAINTING',
    sapClass: 'SFG',
    scanMode: 'KANBAN_BOX',
    sortOrder: 90,
    isActive: true,
  },
  {
    code: 'PAINTING_FG',
    label: 'Painting FG',
    processGroup: 'PAINTING',
    sapClass: 'FG',
    scanMode: 'KANBAN_BOX',
    sortOrder: 100,
    isActive: true,
  },
  {
    code: 'ASSEMBLING_BODY_FG',
    label: 'Assembling Body FG',
    processGroup: 'ASSEMBLING',
    sapClass: 'FG',
    scanMode: 'KANBAN_BOX',
    sortOrder: 110,
    isActive: true,
  },
  {
    code: 'MOUNTING',
    label: 'Mounting',
    processGroup: 'MOUNTING',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 120,
    isActive: true,
  },
  {
    code: 'INSPECTION_WIP',
    label: 'Inspection WIP',
    processGroup: 'INSPECTION',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 130,
    isActive: true,
  },
  {
    code: 'INSPECTION_FG',
    label: 'Inspection FG',
    processGroup: 'INSPECTION',
    sapClass: 'FG',
    scanMode: 'PART_KANBAN',
    sortOrder: 140,
    isActive: true,
  },
  {
    code: 'VACUUM_WIP',
    label: 'Vacuum WIP',
    processGroup: 'VACUUM',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 150,
    isActive: true,
  },
  {
    code: 'VACUUM_FG',
    label: 'Vacuum FG',
    processGroup: 'VACUUM',
    sapClass: 'FG',
    scanMode: 'PART_KANBAN',
    sortOrder: 160,
    isActive: true,
  },
  {
    code: 'ANTENNA',
    label: 'Antena',
    processGroup: 'ANTENNA',
    sapClass: 'SFG',
    scanMode: 'PART_SAJA',
    sortOrder: 170,
    isActive: true,
  },
  {
    code: 'DELIVERY',
    label: 'Delivery',
    processGroup: 'DELIVERY',
    sapClass: 'NONE',
    scanMode: 'PART_SAJA',
    sortOrder: 180,
    isActive: true,
  },
];

export const KATALOG_UJI = katalogProses(BARIS_UJI);
