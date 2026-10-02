import { z } from 'zod';

const cutLineSchema = z.number().finite().min(0.02).max(0.98);

/** Posisi garis berupa rasio 0..1 dari sisi atas/kiri halaman PDF. */
export const kanbanCropProfileSchema = z.object({
  customerId: z.number().int().positive(),
  horizontalLines: z.array(cutLineSchema).max(20),
  verticalLines: z.array(cutLineSchema).max(20),
});

export type KanbanCropProfileInput = z.infer<typeof kanbanCropProfileSchema>;

export interface KanbanCropProfile extends KanbanCropProfileInput {
  id: number | null;
  customerCode: string;
  customerName: string;
  configured: boolean;
}
