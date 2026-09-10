import { LayoutDashboard, Activity, Package, type LucideIcon } from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Struktur menu.
 *
 * Sengaja hanya memuat rute yang benar-benar ada. Menu yang menjanjikan
 * halaman kosong lebih merugikan daripada menu pendek — operator akan berhenti
 * mempercayai navigasinya. Tambahkan entri baru di sini begitu halamannya siap.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Produksi',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/monitor', label: 'Monitor Line', icon: Activity },
    ],
  },
  {
    title: 'Master Data',
    items: [{ href: '/master/parts', label: 'Part', icon: Package }],
  },
];
