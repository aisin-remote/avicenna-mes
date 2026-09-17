import { mysqlTable, varchar, int, boolean, uniqueIndex, index, mysqlEnum } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';
import { ROLE_KINDS, PROCESS_GROUPS, MENU_GROUPS } from '@avicenna/contracts';

/**
 * Pabrik / unit bisnis.
 * Dua sistem lama menjadi dua baris di sini: AVICENNA (die casting) & BELLA (injection).
 * Semua tabel operasional membawa plant_id supaya data dua pabrik tidak saling tercampur.
 */
export const plants = mysqlTable(
  'TM_PLANT',
  {
    id: pk(),
    /** Kode yang dipakai orang lapangan: UNIT, BODY. */
    code: varchar('CHR_CODE', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    /**
     * Kode pabrik menurut SAP — BERBEDA dari CHR_CODE, dan sengaja dipisah.
     *
     * Kolom CHR_PLANT di database jembatan hanya char(3), sedangkan kode kita
     * "UNIT" dan "BODY" masing-masing empat karakter. Memakai CHR_CODE apa
     * adanya berarti yang sampai di SAP adalah "UNI" dan "BOD" — terpotong
     * diam-diam, dan baru ketahuan sebagai dokumen yang ditolak SAP dengan
     * alasan pabrik tidak dikenal.
     *
     * Kosong berarti belum disepakati. Pendorongan MENOLAK dokumen dari pabrik
     * yang kode SAP-nya belum diisi, bukan mengirim tebakan.
     */
    sapCode: varchar('CHR_SAP_CODE', { length: 4 }),
    /**
     * Di pabrik ini, customer direct kanban TETAP men-scan kanban customer saat
     * muat ke truk.
     *
     * Kebiasaannya berbeda antar pabrik: satu tidak men-scan apa pun per box
     * dan mengandalkan hasil pulling, satunya tetap men-scan. Disimpan sebagai
     * sifat pabrik, BUKAN diperiksa dari kode pabriknya — kode pabrik pernah
     * diganti, dan perilaku yang bergantung pada nama akan patah diam-diam.
     *
     * Tidak berpengaruh pada customer biasa: mereka selalu dicocokkan tiga arah.
     */
    scanDirectKanbanSaatMuat: boolean('FLG_SCAN_DIRECT_KANBAN').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_PLANT_CODE_UNIQUE').on(t.code)],
);

export const roles = mysqlTable(
  'TM_ROLE',
  {
    id: pk(),
    name: varchar('CHR_NAME', { length: 64 }).notNull(),
    label: varchar('CHR_LABEL', { length: 128 }),
    /**
     * Apa yang dikerjakan pemegang role: SCANNING (lasman), VIEW (jp, leader),
     * atau ADMIN.
     */
    kind: mysqlEnum('CHR_KIND', ROLE_KINDS).notNull().default('VIEW'),
    /**
     * Grup proses yang menjadi lingkupnya. Kosong berarti seluruh proses.
     *
     * GRUP, bukan jenis proses: "casting lasman" mengurus lini Casting WIP
     * maupun Casting FG. Memakai jenis proses akan menuntut dua role terpisah
     * untuk satu jabatan yang di lapangan memang satu orang.
     */
    processGroup: mysqlEnum('CHR_PROCESS_GROUP', PROCESS_GROUPS),
    /**
     * Role yang tidak dipakai lagi.
     *
     * Dinonaktifkan, bukan dihapus: baris role yang hilang akan memutus
     * TM_USER.INT_ROLE_ID milik orang-orang yang pernah memegangnya, dan
     * jejak siapa dulu berwenang apa ikut hilang.
     */
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_ROLE_NAME_UNIQUE').on(t.name)],
);

/**
 * ─── KATALOG MENU ───────────────────────────────────────────────────────────
 *
 * Salinan MENU_ITEMS (@avicenna/contracts) di database, disalin ulang tiap
 * kali API menyala. Yang menjadikannya tabel — bukan cukup daftar di kode —
 * adalah TM_ROLE_MENU: pemberian hak butuh baris yang bisa ditunjuk foreign
 * key, supaya menu yang dihapus tidak meninggalkan hak menggantung.
 *
 * ── Menu yang hilang dari kode DINONAKTIFKAN, bukan dihapus ─────────────────
 *
 * Menghapusnya akan ikut menghapus pemberian haknya (ON DELETE CASCADE), dan
 * halaman yang sempat dipindah lalu dikembalikan akan kehilangan seluruh
 * daftar role yang dulu boleh membukanya — tanpa jejak, dan tanpa ada yang
 * ingat siapa saja mereka.
 */
export const menus = mysqlTable(
  'TM_MENU',
  {
    id: pk(),
    /** Kunci tetap dari katalog di kode. Bukan alamat halaman — alamat berubah. */
    key: varchar('CHR_KEY', { length: 64 }).notNull(),
    label: varchar('CHR_LABEL', { length: 128 }).notNull(),
    href: varchar('CHR_HREF', { length: 191 }).notNull(),
    icon: varchar('CHR_ICON', { length: 64 }).notNull(),
    menuGroup: mysqlEnum('CHR_MENU_GROUP', MENU_GROUPS).notNull(),
    sortOrder: int('INT_SORT_ORDER').notNull().default(0),
    /** Hanya untuk ADMIN, apa pun isi TM_ROLE_MENU. */
    adminOnly: boolean('FLG_ADMIN_ONLY').notNull().default(false),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_MENU_KEY_UNIQUE').on(t.key),
    index('TM_MENU_GROUP_IDX').on(t.menuGroup, t.sortOrder),
  ],
);

/**
 * Menu yang boleh dilihat pemegang sebuah role.
 *
 * Padanan `role_has_apps` di sistem lama. Tidak ada barisnya berarti TIDAK
 * BOLEH — bawaan yang aman: role baru yang belum diatur tidak diam-diam
 * mendapat seluruh menu.
 */
export const roleMenus = mysqlTable(
  'TM_ROLE_MENU',
  {
    id: pk(),
    roleId: fk('INT_ROLE_ID')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    menuId: fk('INT_MENU_ID')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_ROLE_MENU_UNIQUE').on(t.roleId, t.menuId),
    index('TM_ROLE_MENU_ROLE_IDX').on(t.roleId),
  ],
);

export const users = mysqlTable(
  'TM_USER',
  {
    id: pk(),
    /** NPK = nomor pokok karyawan. Dipakai sebagai identitas login & jejak scan. */
    npk: varchar('CHR_NPK', { length: 32 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    email: varchar('CHR_EMAIL', { length: 191 }),
    passwordHash: varchar('CHR_PASSWORD_HASH', { length: 255 }),
    roleId: fk('INT_ROLE_ID').references(() => roles.id),
    plantId: fk('INT_PLANT_ID').references(() => plants.id),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('TM_USER_NPK_UNIQUE').on(t.npk),
    uniqueIndex('TM_USER_EMAIL_UNIQUE').on(t.email),
    index('TM_USER_PLANT_IDX').on(t.plantId),
  ],
);

/**
 * Device/terminal scanner di lapangan (barcode gun, RFID reader, panel mesin).
 * Punya kredensial sendiri terpisah dari user — pola ini diambil dari
 * MachineAuthorizationService milik bella dan dipertahankan.
 */
export const devices = mysqlTable(
  'TM_DEVICE',
  {
    id: pk(),
    code: varchar('CHR_CODE', { length: 64 }).notNull(),
    name: varchar('CHR_NAME', { length: 128 }).notNull(),
    plantId: fk('INT_PLANT_ID').references(() => plants.id),
    kind: mysqlEnum('CHR_KIND', ['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']).notNull(),
    tokenHash: varchar('CHR_TOKEN_HASH', { length: 255 }),
    lastSeenAt: varchar('CHR_LAST_SEEN_AT', { length: 32 }),
    isActive: boolean('FLG_IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_DEVICE_CODE_UNIQUE').on(t.code), index('TM_DEVICE_PLANT_IDX').on(t.plantId)],
);

export const plantsRelations = relations(plants, ({ many }) => ({
  users: many(users),
  devices: many(devices),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  plant: one(plants, { fields: [users.plantId], references: [plants.id] }),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
  menus: many(roleMenus),
}));

export const menusRelations = relations(menus, ({ many }) => ({
  roles: many(roleMenus),
}));

export const roleMenusRelations = relations(roleMenus, ({ one }) => ({
  role: one(roles, { fields: [roleMenus.roleId], references: [roles.id] }),
  menu: one(menus, { fields: [roleMenus.menuId], references: [menus.id] }),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  plant: one(plants, { fields: [devices.plantId], references: [plants.id] }),
}));
