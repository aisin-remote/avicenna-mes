import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { and, desc, eq, deliveries, deliveryDocuments, type Database } from '@avicenna/db';
import { MAX_DELIVERY_DOCUMENT_BYTES, type DeliveryDocumentUpload } from '@avicenna/contracts';
import type { Principal } from '../auth/auth.types';
import { InjectDb } from '../db/db.module';

interface DocumentReference {
  plantId: number;
  customerId: number;
  referenceType: 'PDS' | 'MANIFEST' | 'LOADING_LIST';
  referenceNumber: string;
}

@Injectable()
export class DeliveryDocumentsService {
  private readonly dir = resolve(
    process.env.DELIVERY_DOCUMENT_DIR || join(process.cwd(), '../../storage/delivery-documents'),
  );
  constructor(@InjectDb() private readonly db: Database) {}

  private authorize(plantId: number, principal?: Principal) {
    if (
      principal?.kind !== 'user' ||
      (principal.roleKind !== 'ADMIN' && principal.plantId !== plantId)
    )
      throw new ForbiddenException('Dokumen delivery tidak dapat diakses oleh pengguna ini.');
  }

  private async context(deliveryId: number, principal?: Principal): Promise<DocumentReference> {
    const [doc] = await this.db.select().from(deliveries).where(eq(deliveries.id, deliveryId));
    if (!doc) throw new NotFoundException('Loading list tidak ditemukan.');
    this.authorize(doc.plantId, principal);
    const pds = doc.pdsNumber?.trim(),
      manifest = doc.manifestNumber?.trim();
    return {
      plantId: doc.plantId,
      customerId: doc.customerId,
      referenceType: pds
        ? ('PDS' as const)
        : manifest
          ? ('MANIFEST' as const)
          : ('LOADING_LIST' as const),
      referenceNumber: pds || manifest || doc.documentNumber,
    };
  }

  private matching(ref: DocumentReference) {
    return and(
      eq(deliveryDocuments.plantId, ref.plantId),
      eq(deliveryDocuments.customerId, ref.customerId),
      eq(deliveryDocuments.referenceType, ref.referenceType),
      eq(deliveryDocuments.referenceNumber, ref.referenceNumber),
    );
  }

  async list(deliveryId: number, principal?: Principal) {
    const ref = await this.context(deliveryId, principal);
    const data = await this.db
      .select({
        id: deliveryDocuments.id,
        kind: deliveryDocuments.kind,
        filename: deliveryDocuments.filename,
        byteSize: deliveryDocuments.byteSize,
        createdAt: deliveryDocuments.createdAt,
      })
      .from(deliveryDocuments)
      .where(this.matching(ref))
      .orderBy(desc(deliveryDocuments.createdAt), desc(deliveryDocuments.id));
    return { reference: { type: ref.referenceType, number: ref.referenceNumber }, data };
  }

  async upload(
    input: DeliveryDocumentUpload,
    principal?: Principal,
  ): Promise<{ id: number; alreadyStored: boolean }> {
    const ref = await this.context(input.deliveryId, principal);
    const filename = basename(input.filename.replaceAll('\\', '/'));
    if (!/\.pdf$/i.test(filename) || /[\r\n\x00]/.test(filename))
      throw new BadRequestException('Pilih file PDF.');
    const bytes = Buffer.from(input.fileBase64, 'base64');
    if (!bytes.length || bytes.length > MAX_DELIVERY_DOCUMENT_BYTES)
      throw new BadRequestException('PDF maksimal 20 MB.');
    if (bytes.toString('base64') !== input.fileBase64)
      throw new BadRequestException('Data PDF tidak valid.');
    if (
      !bytes.subarray(0, 8).toString('ascii').startsWith('%PDF-') ||
      !bytes
        .subarray(Math.max(0, bytes.length - 1024))
        .toString('latin1')
        .includes('%%EOF')
    )
      throw new BadRequestException('Isi file bukan PDF yang lengkap.');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const sameFile = and(
      this.matching(ref),
      eq(deliveryDocuments.kind, input.kind),
      eq(deliveryDocuments.sha256, sha256),
    );
    const [existing] = await this.db
      .select({ id: deliveryDocuments.id })
      .from(deliveryDocuments)
      .where(sameFile);
    if (existing) return { id: existing.id, alreadyStored: true };
    await mkdir(this.dir, { recursive: true });
    const storageKey = `${randomUUID()}.pdf`,
      target = join(this.dir, storageKey);
    await writeFile(target, bytes, { flag: 'wx' });
    try {
      const [saved] = await this.db
        .insert(deliveryDocuments)
        .values({
          ...ref,
          kind: input.kind,
          filename,
          storageKey,
          sha256,
          byteSize: bytes.length,
          uploadedById: principal?.kind === 'user' ? principal.sub : null,
        })
        .onConflictDoNothing()
        .returning({ id: deliveryDocuments.id });
      if (saved) return { id: saved.id, alreadyStored: false };
      const [duplicate] = await this.db
        .select({ id: deliveryDocuments.id })
        .from(deliveryDocuments)
        .where(sameFile);
      if (!duplicate) throw new Error('Dokumen tidak tersimpan.');
      await unlink(target);
      return { id: duplicate.id, alreadyStored: true };
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
  }

  private async row(id: number, principal?: Principal) {
    const [doc] = await this.db
      .select()
      .from(deliveryDocuments)
      .where(eq(deliveryDocuments.id, id));
    if (!doc) throw new NotFoundException('Arsip PDF tidak ditemukan.');
    this.authorize(doc.plantId, principal);
    return doc;
  }

  async metadata(id: number, principal?: Principal) {
    const doc = await this.row(id, principal);
    return {
      id: doc.id,
      kind: doc.kind,
      filename: doc.filename,
      byteSize: doc.byteSize,
      createdAt: doc.createdAt,
      reference: { type: doc.referenceType, number: doc.referenceNumber },
    };
  }

  async file(id: number, principal?: Principal) {
    const doc = await this.row(id, principal);
    if (!/^[a-f0-9-]{36}\.pdf$/.test(doc.storageKey))
      throw new NotFoundException('File PDF tidak tersedia.');
    try {
      return { filename: doc.filename, bytes: await readFile(join(this.dir, doc.storageKey)) };
    } catch {
      throw new NotFoundException('File PDF tidak tersedia di penyimpanan.');
    }
  }
}
