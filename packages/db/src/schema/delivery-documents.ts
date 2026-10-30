import { integer, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { daftarNilai, enumCol, fk, logisticsSchema, pk } from './_shared';
import { customers } from './master';
import { plants, users } from './org';
import { DELIVERY_DOCUMENT_KINDS } from '@avicenna/contracts';

export const deliveryDocuments = logisticsSchema.table(
  'TT_DELIVERY_DOCUMENT',
  {
    id: pk(),
    plantId: fk('INT_PLANT_ID')
      .notNull()
      .references(() => plants.id),
    customerId: fk('INT_CUSTOMER_ID')
      .notNull()
      .references(() => customers.id),
    referenceType: enumCol('CHR_REFERENCE_TYPE', [
      'PDS',
      'MANIFEST',
      'LOADING_LIST',
    ] as const).notNull(),
    referenceNumber: varchar('CHR_REFERENCE_NO', { length: 64 }).notNull(),
    kind: enumCol('CHR_KIND', DELIVERY_DOCUMENT_KINDS).notNull(),
    filename: varchar('CHR_FILENAME', { length: 255 }).notNull(),
    storageKey: varchar('CHR_STORAGE_KEY', { length: 64 }).notNull(),
    sha256: varchar('CHR_SHA256', { length: 64 }).notNull(),
    byteSize: integer('INT_BYTE_SIZE').notNull(),
    uploadedById: fk('INT_UPLOADED_BY_ID').references(() => users.id),
    createdAt: timestamp('DTM_CREATED_AT', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('TT_DELIVERY_DOCUMENT_CONTENT_UNIQUE').on(
      t.plantId,
      t.customerId,
      t.referenceType,
      t.referenceNumber,
      t.kind,
      t.sha256,
    ),
    daftarNilai('TT_DELIVERY_DOCUMENT_KIND_CHK', t.kind, DELIVERY_DOCUMENT_KINDS),
    daftarNilai('TT_DELIVERY_DOCUMENT_REF_CHK', t.referenceType, [
      'PDS',
      'MANIFEST',
      'LOADING_LIST',
    ]),
  ],
);
