import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rmdir, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  getDb,
  closeDb,
  plants,
  customers,
  users,
  deliveries,
  deliveryDocuments,
  eq,
  type Database,
} from '@avicenna/db';
import {
  DELIVERY_DOCUMENT_KINDS,
  deliveryDocumentUploadSchema,
  MAX_DELIVERY_DOCUMENT_BYTES,
} from '@avicenna/contracts';
import { DeliveryDocumentsService } from './delivery-documents.service';
import type { Principal } from '../auth/auth.types';

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert(['localhost', '127.0.0.1'].includes(url.hostname), 'Test hanya untuk database lokal.');
  const base = resolve('D:/Temp'),
    dir = join(base, `avicenna-document-check-${randomUUID()}`);
  assert(dir.startsWith(base + '\\'));
  await mkdir(dir, { recursive: true });
  const previous = process.env.DELIVERY_DOCUMENT_DIR;
  process.env.DELIVERY_DOCUMENT_DIR = dir;
  const db = getDb(),
    rollback = Error('rollback document QA'),
    tag = randomUUID().slice(0, 8);
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        const [plant] = await tx
          .insert(plants)
          .values({ code: `DOC-${tag}`, name: 'Document QA' })
          .returning();
        const [customer] = await tx
          .insert(customers)
          .values({ code: `DOC-${tag}`, name: 'Document QA' })
          .returning();
        const [otherCustomer] = await tx
          .insert(customers)
          .values({ code: `DOC2-${tag}`, name: 'Other customer' })
          .returning();
        const [user] = await tx.select().from(users).limit(1);
        assert(user && plant && customer && otherCustomer);
        const admin: Principal = {
          kind: 'user',
          sub: user.id,
          npk: 'QA',
          name: 'QA',
          role: null,
          roleKind: 'ADMIN',
          roleProcessGroup: null,
          plantId: null,
        };
        const [doc, samePds, other] = await tx
          .insert(deliveries)
          .values([
            {
              plantId: plant.id,
              customerId: customer.id,
              documentNumber: `DOC-${tag}`,
              pdsNumber: `PDS-${tag}`,
              deliveryDate: '2026-10-28',
            },
            {
              plantId: plant.id,
              customerId: customer.id,
              documentNumber: `DOC-${tag}-2`,
              pdsNumber: `PDS-${tag}`,
              deliveryDate: '2026-10-28',
            },
            {
              plantId: plant.id,
              customerId: otherCustomer.id,
              documentNumber: `DOC-${tag}-3`,
              pdsNumber: `PDS-${tag}`,
              deliveryDate: '2026-10-28',
            },
          ])
          .returning();
        assert(doc && samePds && other);
        const service = new DeliveryDocumentsService(tx as unknown as Database);
        const bytes = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF\n');
        for (const kind of DELIVERY_DOCUMENT_KINDS) {
          const input = deliveryDocumentUploadSchema.parse({
            deliveryId: doc.id,
            kind,
            filename: `../${kind}.pdf`,
            fileBase64: bytes.toString('base64'),
          });
          const [one, two]: [{ id: number }, { id: number }] = await Promise.all([
            service.upload(input, admin),
            service.upload(input, admin),
          ]);
          assert.equal(one.id, two.id, 'Retry/concurrent upload tidak menggandakan arsip.');
          const file = await service.file(one.id, admin);
          assert.deepEqual(file.bytes, bytes, 'Seluruh bytes PDF dipertahankan.');
          assert.equal(file.filename, `${kind}.pdf`, 'Nama upload tidak menjadi path penyimpanan.');
        }
        assert.equal((await service.list(doc.id, admin)).data.length, 3);
        assert.equal(
          (await service.list(samePds.id, admin)).data.length,
          3,
          'PDS yang sama dapat membuka arsip yang sama.',
        );
        assert.equal(
          (await service.list(other.id, admin)).data.length,
          0,
          'PDS serupa pada customer lain tidak tercampur.',
        );
        const list = await service.list(doc.id, admin);
        const otherPlant: Principal = { ...admin, roleKind: 'VIEW', plantId: plant.id + 9999 };
        await assert.rejects(service.list(doc.id, otherPlant), /tidak dapat diakses/);
        await assert.rejects(service.file(list.data[0]!.id, otherPlant), /tidak dapat diakses/);
        await assert.rejects(
          service.upload(
            { deliveryId: doc.id, kind: 'MANIFEST', filename: 'bad.pdf', fileBase64: 'not-a-pdf' },
            admin,
          ),
          /valid|PDF/,
        );
        await assert.rejects(
          service.upload(
            {
              deliveryId: doc.id,
              kind: 'MANIFEST',
              filename: 'bad.pdf',
              fileBase64: Buffer.from('%PDF-1.4 truncated').toString('base64'),
            },
            admin,
          ),
          /lengkap/,
        );
        assert(
          !deliveryDocumentUploadSchema.safeParse({
            deliveryId: doc.id,
            kind: 'INTERNAL',
            filename: 'x.pdf',
            fileBase64: 'YQ==',
          }).success,
        );
        assert(
          !deliveryDocumentUploadSchema.safeParse({
            deliveryId: doc.id,
            kind: 'MANIFEST',
            filename: 'x.pdf',
            fileBase64: 'A'.repeat(Math.ceil(MAX_DELIVERY_DOCUMENT_BYTES / 3) * 4 + 4),
          }).success,
        );
        assert.equal(
          (await readdir(dir)).length,
          3,
          'Tidak ada file yatim setelah retry atau upload gagal.',
        );
        const [unchanged] = await tx.select().from(deliveries).where(eq(deliveries.id, doc.id));
        assert.equal(unchanged?.status, 'DRAFT', 'Arsip/print tidak mengubah pulling atau SAP.');
        assert.equal(
          (await tx.select().from(deliveryDocuments)).filter(
            (d) => d.referenceNumber === `PDS-${tag}`,
          ).length,
          3,
        );
        throw rollback;
      }),
      (error) => error === rollback,
    );
    console.log(
      'Delivery document checks passed: PDF archive/dedup, 3 document types, PDS/customer isolation, authorization, round-trip bytes and validation. Fixtures rolled back.',
    );
  } finally {
    if (previous === undefined) delete process.env.DELIVERY_DOCUMENT_DIR;
    else process.env.DELIVERY_DOCUMENT_DIR = previous;
    for (const file of await readdir(dir)) {
      assert(/^[a-f0-9-]{36}\.pdf$/.test(file));
      const target = resolve(dir, file);
      assert(target.startsWith(dir + '\\'));
      await unlink(target);
    }
    await rmdir(dir);
    await closeDb();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
