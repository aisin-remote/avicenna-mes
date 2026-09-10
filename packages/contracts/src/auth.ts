import { z } from 'zod';

export const loginSchema = z.object({
  npk: z.string().trim().min(1, 'NPK wajib diisi').max(32),
  password: z.string().min(1, 'Password wajib diisi').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: z.object({
    id: z.number(),
    npk: z.string(),
    name: z.string(),
    role: z.string().nullable(),
    plantId: z.number().nullable(),
  }),
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

/** Login terminal/scanner — pakai token device, bukan akun manusia. */
export const deviceLoginSchema = z.object({
  deviceCode: z.string().trim().min(1).max(64),
  token: z.string().min(1).max(255),
});
export type DeviceLoginInput = z.infer<typeof deviceLoginSchema>;
