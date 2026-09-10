import { mysqlTable, varchar, boolean, uniqueIndex, index, mysqlEnum } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';

/**
 * Pabrik / unit bisnis.
 * Dua sistem lama menjadi dua baris di sini: AVICENNA (die casting) & BELLA (injection).
 * Semua tabel operasional membawa plant_id supaya data dua pabrik tidak saling tercampur.
 */
export const plants = mysqlTable(
  'plants',
  {
    id: pk(),
    code: varchar('code', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('plants_code_unique').on(t.code)],
);

export const roles = mysqlTable(
  'roles',
  {
    id: pk(),
    name: varchar('name', { length: 64 }).notNull(),
    label: varchar('label', { length: 128 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('roles_name_unique').on(t.name)],
);

export const users = mysqlTable(
  'users',
  {
    id: pk(),
    /** NPK = nomor pokok karyawan. Dipakai sebagai identitas login & jejak scan. */
    npk: varchar('npk', { length: 32 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    email: varchar('email', { length: 191 }),
    passwordHash: varchar('password_hash', { length: 255 }),
    roleId: fk('role_id').references(() => roles.id),
    plantId: fk('plant_id').references(() => plants.id),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_npk_unique').on(t.npk),
    uniqueIndex('users_email_unique').on(t.email),
    index('users_plant_idx').on(t.plantId),
  ],
);

/**
 * Device/terminal scanner di lapangan (barcode gun, RFID reader, panel mesin).
 * Punya kredensial sendiri terpisah dari user — pola ini diambil dari
 * MachineAuthorizationService milik bella dan dipertahankan.
 */
export const devices = mysqlTable(
  'devices',
  {
    id: pk(),
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    plantId: fk('plant_id').references(() => plants.id),
    kind: mysqlEnum('kind', ['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']).notNull(),
    tokenHash: varchar('token_hash', { length: 255 }),
    lastSeenAt: varchar('last_seen_at', { length: 32 }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('devices_code_unique').on(t.code), index('devices_plant_idx').on(t.plantId)],
);

export const plantsRelations = relations(plants, ({ many }) => ({
  users: many(users),
  devices: many(devices),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, { fields: [users.roleId], references: [roles.id] }),
  plant: one(plants, { fields: [users.plantId], references: [plants.id] }),
}));

export const devicesRelations = relations(devices, ({ one }) => ({
  plant: one(plants, { fields: [devices.plantId], references: [plants.id] }),
}));
