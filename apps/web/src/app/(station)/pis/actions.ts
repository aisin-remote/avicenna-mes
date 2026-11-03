'use server';

import { unstable_rethrow } from 'next/navigation';
import type {
  PisBoard, PisConfirmInput, PisContextInput, PisScanInput, PisUnlockInput,
} from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

export type PisResult = { data: PisBoard; error?: never } | { error: string; data?: never };

async function request(path: string, input?: unknown): Promise<PisResult> {
  try {
    const data = await apiFetch<PisBoard>(path, input === undefined ? {} : {
      method: 'POST', body: JSON.stringify(input),
    });
    return { data };
  } catch (error) {
    unstable_rethrow(error);
    return { error: error instanceof ApiRequestError ? error.message :
      'Server belum dapat dihubungi. Coba lagi; jumlah packing tidak akan dihitung dua kali.' };
  }
}

export async function readPisAction(plantId?: number) {
  return request(`/pis${plantId ? `?plantId=${plantId}` : ''}`);
}
export async function scanPisAction(input: PisScanInput) { return request('/pis/scan', input); }
export async function confirmPisAction(input: PisConfirmInput) { return request('/pis/confirm', input); }
export async function contextPisAction(input: PisContextInput) { return request('/pis/context', input); }
export async function resetPisAction(plantId: number) { return request('/pis/reset', { plantId }); }
export async function unlockPisAction(input: PisUnlockInput) { return request('/pis/unlock', input); }
