import type { PreparationStatus, PreparationGroup } from '@avicenna/contracts';
export const prepLabels: Record<PreparationStatus, string> = {
  NO_PLAN: 'Rencana perlu dicek',
  UNCONFIGURED: 'Jadwal belum diatur',
  NOT_STARTED: 'Belum pulling',
  IN_PROGRESS: 'On progress',
  COMPLETE: 'Close pulling',
  OVERDUE: 'Delay pulling',
  COMPLETE_LATE: 'Selesai terlambat',
  COMPLETE_UNTIMED: 'Complete · waktu belum terverifikasi',
};
export function dateTime(v: string | null, seconds = false) {
  return v
    ? new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        ...(seconds ? { second: '2-digit' } : {}),
      }).format(new Date(v))
    : '—';
}
export function time(v: string | null) {
  return v
    ? new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(v))
    : '—';
}
export const isLate = (g: PreparationGroup) => ['OVERDUE', 'COMPLETE_LATE'].includes(g.status);
export function truckState(g: PreparationGroup, now: number) {
  const picked = g.documents.filter((d) => !!d.truckPickedAt);
  const actual = picked
    .map((d) => d.truckPickedAt!)
    .sort()
    .at(-1);
  if (!g.truckEtaAt) return actual ? 'PICKED_UNTIMED' : 'UNCONFIGURED';
  if (actual && picked.length === g.documents.length)
    return Date.parse(actual) > Date.parse(g.truckEtaAt)
      ? 'PICKED_LATE'
      : Date.parse(actual) < Date.parse(g.truckEtaAt) - 900000
        ? 'EARLY'
        : 'ON_TIME';
  return now > Date.parse(g.truckEtaAt) ? 'DELIVERY_DELAY' : 'PENDING';
}
export const truckLabels: Record<string, string> = {
  PICKED_UNTIMED: 'Pick up · ETA belum diatur',
  UNCONFIGURED: 'ETA belum diatur',
  PICKED_LATE: 'Delay pick up',
  EARLY: 'Pick up early',
  ON_TIME: 'Pick up on time',
  DELIVERY_DELAY: 'Delay delivery',
  PENDING: 'Menunggu truck',
};
