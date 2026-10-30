import { z } from 'zod';

export const DELIVERY_DOCUMENT_KINDS = ['CUSTOMER_KANBAN', 'MANIFEST', 'SKID_LABEL'] as const;
export const DELIVERY_DOCUMENT_LABELS = {
  CUSTOMER_KANBAN: 'Kanban Customer',
  MANIFEST: 'Manifest',
  SKID_LABEL: 'Skid Label',
} as const;
export const MAX_DELIVERY_DOCUMENT_BYTES = 20 * 1024 * 1024;
export const deliveryDocumentUploadSchema = z.object({
  deliveryId: z.coerce.number().int().positive(),
  kind: z.enum(DELIVERY_DOCUMENT_KINDS),
  filename: z.string().trim().min(1).max(255),
  fileBase64: z
    .string()
    .min(1)
    .max(Math.ceil(MAX_DELIVERY_DOCUMENT_BYTES / 3) * 4),
});
export type DeliveryDocumentUpload = z.infer<typeof deliveryDocumentUploadSchema>;
export interface DeliveryDocumentFile {
  id: number;
  kind: (typeof DELIVERY_DOCUMENT_KINDS)[number];
  filename: string;
  byteSize: number;
  createdAt: string;
}
export interface DeliveryDocumentArchive {
  reference: { type: 'PDS' | 'MANIFEST' | 'LOADING_LIST'; number: string };
  data: DeliveryDocumentFile[];
}
