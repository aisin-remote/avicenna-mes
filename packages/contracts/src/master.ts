import { z } from 'zod';
import { processTypeSchema, idSchema } from './common';

export const partCreateSchema = z.object({
  plantId: idSchema,
  lineId: idSchema.optional(),
  partNumber: z.string().trim().min(1, 'Part number wajib diisi').max(64),
  backNumber: z.string().trim().max(64).optional(),
  name: z.string().trim().min(1, 'Nama part wajib diisi').max(191),
  processType: processTypeSchema,
  qtyPerKanban: z.coerce.number().int().min(1).optional(),
  standardStock: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
export type PartCreateInput = z.infer<typeof partCreateSchema>;

export const partUpdateSchema = partCreateSchema.partial().omit({ plantId: true });
export type PartUpdateInput = z.infer<typeof partUpdateSchema>;

export const customerCreateSchema = z.object({
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128),
  dock: z.string().trim().max(32).optional(),
  isActive: z.boolean().default(true),
});
export type CustomerCreateInput = z.infer<typeof customerCreateSchema>;

export const lineCreateSchema = z.object({
  plantId: idSchema,
  code: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(128),
  processType: processTypeSchema,
  sortOrder: z.coerce.number().int().default(0),
  isActive: z.boolean().default(true),
});
export type LineCreateInput = z.infer<typeof lineCreateSchema>;
