import { MASTER_ENTITIES, ENTITY_DEFS } from '@avicenna/contracts';

export interface NavItem {
  href: string;
  label: string;
  /** Nama ikon lucide; dipetakan ke komponen di sisi UI. */
  icon: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
  /** Grup panjang bisa dilipat agar sidebar tetap ringkas. */
  collapsible?: boolean;
}

/**
 * Struktur menu.
 *
 * Bagian Master Data diturunkan langsung dari registry entitas, sehingga
 * menambah entitas master otomatis memunculkan menunya — tidak ada daftar
 * kedua yang bisa ketinggalan.
 *
 * Modul operasional dari sistem lama (production plan, kanban, pulling,
 * delivery, quality, opname, andon) belum dicantumkan karena halamannya belum
 * ada. Menu yang menjanjikan halaman kosong membuat operator berhenti
 * mempercayai navigasi.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Produksi',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'LayoutDashboard' },
      { href: '/scan', label: 'Stasiun Scan', icon: 'ScanLine' },
      { href: '/monitor', label: 'Monitor Line', icon: 'Activity' },
    ],
  },
  {
    title: 'Master Data',
    collapsible: true,
    items: MASTER_ENTITIES.map((key) => ({
      href: `/master/${key}`,
      label: ENTITY_DEFS[key].label,
      icon: ENTITY_DEFS[key].icon,
    })),
  },
];
