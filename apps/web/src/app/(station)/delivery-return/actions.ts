'use server';
import { revalidatePath } from 'next/cache';
import type {
  DriverAttendanceBoard,
  DriverAttendanceHistory,
  DriverAttendanceOrder,
  DriverAttendanceStart,
} from '@avicenna/contracts';
import { apiFetch, ApiRequestError } from '@/lib/api';

function message(error: unknown) {
  if (error instanceof ApiRequestError) {
    const body = error.body as { details?: Array<{ message: string }> } | undefined;
    return body?.details?.map((d) => d.message).join('. ') || error.message;
  }
  return 'Server belum dapat dihubungi. Coba perbarui layar.';
}
export async function driverBoardAction(plantId: number) {
  try {
    return { data: await apiFetch<DriverAttendanceBoard>(`/driver-attendance?plantId=${plantId}`) };
  } catch (e) {
    return { error: message(e) };
  }
}
export async function resolveDriverOrderAction(code: string, plantId: number) {
  try {
    return await apiFetch<{ data: DriverAttendanceOrder[] }>(
      `/driver-attendance/resolve?${new URLSearchParams({ code, plantId: String(plantId) })}`,
    );
  } catch (e) {
    return { error: message(e) };
  }
}
export async function startDriverPickupAction(input: DriverAttendanceStart) {
  try {
    const result = await apiFetch<{ id: number }>('/driver-attendance/start', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    revalidatePath('/preparation-monitoring');
    return result;
  } catch (e) {
    return { error: message(e) };
  }
}
export async function finishDriverPickupAction(id: number) {
  try {
    const result = await apiFetch<{ id: number; alreadyFinished: boolean }>(
      `/driver-attendance/${id}/finish`,
      { method: 'POST' },
    );
    for (const path of ['/delivery', '/trace', '/sap', '/preparation-monitoring'])
      revalidatePath(path);
    return result;
  } catch (e) {
    return { error: message(e) };
  }
}
export async function driverHistoryAction(plantId: number, from: string, to: string, page: number) {
  try {
    return {
      data: await apiFetch<DriverAttendanceHistory>(
        `/driver-attendance/history?${new URLSearchParams({ plantId: String(plantId), from, to, page: String(page) })}`,
      ),
    };
  } catch (e) {
    return { error: message(e) };
  }
}
