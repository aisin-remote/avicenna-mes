import {
  MENU_ITEMS,
  MENU_GROUPS,
  MENU_GROUP_COLLAPSIBLE,
  type MenuRow,
  type MenuGroup,
} from '@avicenna/contracts';

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
 * Menyusun menu menjadi grup untuk sidebar.
 *
 * Isinya datang dari server — daftar menu yang BOLEH dilihat orang yang sedang
 * masuk, bukan seluruh katalog. Menyaringnya di browser berarti nama setiap
 * layar tetap terkirim ke semua orang, dan daftar itu sendiri sudah memberi
 * tahu apa saja yang ada di sistem.
 *
 * Grup yang menjadi kosong setelah disaring tidak ditampilkan: judul grup
 * tanpa isi membuat orang mengira menunya gagal dimuat.
 */
export function susunNav(menus: readonly MenuRow[]): NavGroup[] {
  return MENU_GROUPS.map((title) => ({
    title,
    collapsible: MENU_GROUP_COLLAPSIBLE[title],
    items: menus
      .filter((m) => m.group === title)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((m) => ({ href: m.href, label: m.label, icon: m.icon })),
  })).filter((g) => g.items.length > 0);
}

/**
 * Seluruh katalog sebagai grup — cadangan saat daftar dari server tidak bisa
 * diambil.
 *
 * Dipakai HANYA ketika API tidak menjawab. Menampilkan menu yang mungkin tidak
 * berhak dibuka memang tidak ideal, tetapi halamannya sendiri tetap dijaga di
 * server; sidebar kosong total akan terlihat seperti aplikasi yang rusak dan
 * membuat orang tidak bisa berpindah ke mana pun, termasuk keluar.
 */
export const NAV_GROUPS: NavGroup[] = susunNav(
  MENU_ITEMS.filter((m) => !m.adminOnly).map((m) => ({
    key: m.key,
    label: m.label,
    href: m.href,
    icon: m.icon,
    group: m.group as MenuGroup,
    sortOrder: m.sortOrder,
    adminOnly: false,
  })),
);
