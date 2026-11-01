export function pickupDuration(start: string, end: number | string | null) {
  if (end === null) return '—';
  const seconds = Math.max(
    0,
    Math.floor(((typeof end === 'string' ? Date.parse(end) : end) - Date.parse(start)) / 1000),
  );
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}
export function pickupTime(value: string | null) {
  return value
    ? new Date(value).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
}
