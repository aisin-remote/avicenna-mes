import { mysqlTable, varchar, boolean, uniqueIndex, index, mysqlEnum } from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { pk, fk, timestamps } from './_shared';

/**
 * Pabrik / unit bisnis.
 * Dua sistem lama menjadi dua baris di sini: AVICENNA (die casting) & BELLA (injection).
 * Semua tabel operasional membawa plant_id supaya data dua pabrik tidak saling tercampur.
 */
export const plants = mysqlTable(
  'TM_PLANT',
  {
    id: pk(),
    code: varchar('CODE', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_PLANT_CODE_UNIQUE').on(t.code)],
);

export const roles = mysqlTable(
  'TM_ROLE',
  {
    id: pk(),
    name: varchar('NAME', { length: 64 }).notNull(),
    label: varchar('LABEL', { length: 128 }),
    ...timestamps,
  },
  (t) => [uniqueIndex('TM_ROLE_NAME_UNIQUE').on(t.name)],
);

export const users = mysqlTable(
  'TM_USER',
  {
    id: pk(),
    /** NPK = nomor pokok karyawan. Dipakai sebagai identitas login & jejak scan. */
    npk: varchar('NPK', { length: 32 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    email: varchar('EMAIL', { length: 191 }),
    passwordHash: varchar('PASSWORD_HASH', { length: 255 }),
    roleId: fk('ROLE_ID').references(() => roles.id),
    plantId: fk('PLANT_ID').references(() => plants.id),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
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
    code: varchar('CODE', { length: 64 }).notNull(),
    name: varchar('NAME', { length: 128 }).notNull(),
    plantId: fk('PLANT_ID').references(() => plants.id),
    kind: mysqlEnum('KIND', ['SCANNER', 'RFID', 'MACHINE_PANEL', 'PRINTER']).notNull(),
    tokenHash: varchar('TOKEN_HASH', { length: 255 }),
    lastSeenAt: varchar('LAST_SEEN_AT', { length: 32 }),
    isActive: boolean('IS_ACTIVE').notNull().default(true),
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

export const devicesRelations = relations(devices, ({ one }) => ({
  plant: one(plants, { fields: [devices.plantId], references: [plants.id] }),
}));
