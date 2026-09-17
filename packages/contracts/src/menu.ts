import { MASTER_ENTITIES, ENTITY_DEFS } from './master/registry';

/**
 * ─── KATALOG MENU ───────────────────────────────────────────────────────────
 *
 * Satu daftar menu, dipakai tiga pihak: sidebar menggambarnya, API menyalinnya
 * ke TM_MENU supaya bisa ditautkan ke role, dan layar "menu per role"
 * menampilkannya sebagai daftar centang.
 *
 * ── Kenapa katalognya di KODE, bukan tabel yang bisa ditambah admin ─────────
 *
 * Sistem lama menyimpan menu sepenuhnya sebagai data (ais_apps: tcode, route,
 * ikon, induk). Akibatnya rutenya diketik manusia, dan satu salah ketik
 * menghasilkan menu yang mengantar setiap pemegang role ke halaman yang tidak
 * ada — tanpa satu pun pesan, karena tidak ada yang memeriksa bahwa rutenya
 * benar-benar ada.
 *
 * Di sini menu hanya boleh menunjuk halaman yang memang dibuat. Yang menjadi
 * data adalah SIAPA BOLEH MELIHAT APA (TM_ROLE_MENU) — itu yang memang berubah
 * tanpa deploy. Menu baru datang bersama halamannya.
 */

export const MENU_GROUPS = [
  'Produksi',
  'Logistik',
  'Integrasi',
  'Master Data',
  'Administrasi',
] as const;
export type MenuGroup = (typeof MENU_GROUPS)[number];

/** Grup panjang dilipat agar sidebar tetap terbaca. */
export const MENU_GROUP_COLLAPSIBLE: Record<MenuGroup, boolean> = {
  Produksi: false,
  Logistik: false,
  Integrasi: false,
  'Master Data': true,
  Administrasi: false,
};

export interface MenuDef {
  /**
   * Kunci tetap, dipakai TM_MENU dan TM_ROLE_MENU.
   *
   * Sengaja BUKAN alamat halaman: alamat berubah saat halaman dipindah, dan
   * pemberian hak yang menempel pada alamat akan ikut hilang tanpa jejak.
   */
  key: string;
  label: string;
  href: string;
  /** Nama ikon lucide; dipetakan ke komponen di sisi UI. */
  icon: string;
  group: MenuGroup;
  sortOrder: number;
  /**
   * Hanya untuk ADMIN, apa pun isi TM_ROLE_MENU.
   *
   * Layar yang bisa mengubah hak akses tidak boleh bisa diberikan lewat layar
   * hak akses itu sendiri — sekali salah centang, siapa pun bisa menaikkan
   * haknya sendiri dan tidak ada jalan mundur selain menyunting database.
   */
  adminOnly?: boolean;
}

const MENU_TETAP: MenuDef[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: 'LayoutDashboard', group: 'Produksi', sortOrder: 10 },
  { key: 'scan', label: 'Stasiun Scan', href: '/scan', icon: 'ScanLine', group: 'Produksi', sortOrder: 20 },
  { key: 'monitor', label: 'Monitor Line', href: '/monitor', icon: 'Activity', group: 'Produksi', sortOrder: 30 },
  { key: 'ng-outline', label: 'Input NG Outline', href: '/ng', icon: 'TriangleAlert', group: 'Produksi', sortOrder: 40 },

  { key: 'receiving', label: 'Penerimaan Barang', href: '/receiving', icon: 'Truck', group: 'Logistik', sortOrder: 10 },
  { key: 'transfer', label: 'Transfer Antar Line', href: '/transfer', icon: 'MoveRight', group: 'Logistik', sortOrder: 20 },
  { key: 'delivery', label: 'Pengiriman', href: '/delivery', icon: 'PackageCheck', group: 'Logistik', sortOrder: 30 },
  { key: 'trace', label: 'Telusur Silsilah', href: '/trace', icon: 'GitBranch', group: 'Logistik', sortOrder: 40 },

  { key: 'sap', label: 'Integrasi SAP', href: '/sap', icon: 'Share2', group: 'Integrasi', sortOrder: 10 },

  { key: 'admin.users', label: 'Pengguna', href: '/admin/users', icon: 'Users', group: 'Administrasi', sortOrder: 10, adminOnly: true },
  { key: 'admin.roles', label: 'Role & Hak Menu', href: '/admin/roles', icon: 'ShieldCheck', group: 'Administrasi', sortOrder: 20, adminOnly: true },
];

/*
 * Menu master diturunkan dari registry entitas, bukan ditulis lagi.
 *
 * Menambah entitas master otomatis memunculkan menunya DAN membuatnya bisa
 * diberikan ke role. Daftar kedua yang ditulis tangan akan ketinggalan, dan
 * entitas baru menjadi halaman yang tidak pernah terlihat siapa pun.
 */
const MENU_MASTER: MenuDef[] = MASTER_ENTITIES.map((key, i) => ({
  key: `master.${key}`,
  label: ENTITY_DEFS[key].label,
  href: `/master/${key}`,
  icon: ENTITY_DEFS[key].icon,
  group: 'Master Data' as const,
  sortOrder: (i + 1) * 10,
}));

/** Layar matriks rute — halaman tersendiri, bukan CRUD entitas biasa. */
const MENU_KHUSUS: MenuDef[] = [
  {
    key: 'master.part-processes-matrix',
    label: 'Matriks Rute Part',
    href: '/master/part-processes',
    icon: 'Route',
    group: 'Master Data',
    sortOrder: 5,
  },
];

export const MENU_ITEMS: readonly MenuDef[] = [
  ...MENU_TETAP,
  ...MENU_KHUSUS,
  ...MENU_MASTER,
].sort((a, b) =>
  a.group === b.group
    ? a.sortOrder - b.sortOrder
    : MENU_GROUPS.indexOf(a.group) - MENU_GROUPS.indexOf(b.group),
);

const PETA_MENU = new Map(MENU_ITEMS.map((m) => [m.key, m]));

export function menuByKey(key: string): MenuDef | undefined {
  return PETA_MENU.get(key);
}

export function isMenuKey(key: string): boolean {
  return PETA_MENU.has(key);
}

/**
 * Kunci menu yang boleh diberikan lewat layar hak akses.
 *
 * Menu adminOnly tidak ikut: memberikannya sebagai centang berarti hak admin
 * bisa diberikan oleh siapa pun yang sudah punya layar itu terbuka.
 */
export const MENU_KEYS_DAPAT_DIBERIKAN: readonly string[] = MENU_ITEMS.filter(
  (m) => !m.adminOnly,
).map((m) => m.key);
