import '@avicenna/db/load-env';
import { randomUUID } from 'node:crypto';
import type { LoadingRfidBatchInput, LoadingRfidBatchResult } from '@avicenna/contracts';

/**
 * Simulasi aplikasi RFID eksternal: memanggil POST /loading/rfid/batch lewat HTTP,
 * persis seperti yang dikirim perangkat — pengganti Postman.
 *
 *   pnpm --filter @avicenna/api rfid:simulate <deliveryId> [jumlahTag] [--ulang]
 *
 * Login: RFID_DEVICE_CODE + RFID_DEVICE_TOKEN (perangkat RFID), kalau tidak ada
 * SIM_NPK + SIM_PASSWORD (bawaan seed lokal ADMIN / admin123).
 * Tag dibangkitkan dari sisa rencana tiap baris loading list. --ulang mengirim
 * batch yang sama dua kali untuk melihat penanganan DUPLICATE.
 */
const api = (process.env.SIM_API_URL ?? process.env.API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');

async function call<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}\n${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function login(): Promise<string> {
  const { RFID_DEVICE_CODE: deviceCode, RFID_DEVICE_TOKEN: token } = process.env;
  if (deviceCode && token) {
    console.log(`Login perangkat ${deviceCode}`);
    return (await call<{ accessToken: string }>('POST', '/auth/device', { deviceCode, token }))
      .accessToken;
  }
  const npk = process.env.SIM_NPK ?? 'ADMIN';
  console.log(`Login pengguna ${npk}`);
  return (
    await call<{ accessToken: string }>('POST', '/auth/login', {
      npk,
      password: process.env.SIM_PASSWORD ?? 'admin123',
    })
  ).accessToken;
}

async function main() {
  const args = process.argv.slice(2);
  const ulang = args.includes('--ulang');
  const [idArg, maxArg] = args.filter((a) => !a.startsWith('--'));
  const deliveryId = Number(idArg);
  if (!Number.isInteger(deliveryId) || deliveryId <= 0)
    throw new Error('Pakai: rfid:simulate <deliveryId> [jumlahTag] [--ulang]');
  const max = Math.min(Number(maxArg ?? 200) || 200, 200); // batas skema: 200 tag per batch

  const token = await login();
  const doc = await call<{
    documentNumber: string;
    status: string;
    lines: Array<{
      customerPartNumber: string | null;
      plannedKanban: number;
      pickedKanban: number;
    }>;
  }>('GET', `/loading/${deliveryId}`, undefined, token);
  console.log(`Loading list ${doc.documentNumber} (status ${doc.status}), ${doc.lines.length} baris`);

  const tags: LoadingRfidBatchInput['tags'] = [];
  for (const line of doc.lines) {
    if (!line.customerPartNumber) continue;
    for (let i = line.pickedKanban; i < line.plannedKanban && tags.length < max; i += 1)
      tags.push({ tagId: `SIM-${randomUUID().slice(0, 12)}`, customerPart: line.customerPartNumber });
  }
  if (tags.length === 0) throw new Error('Tidak ada sisa rencana kanban untuk dibuat tag-nya.');

  const body: LoadingRfidBatchInput = { deliveryId, tags };
  for (const putaran of ulang ? [1, 2] : [1]) {
    console.log(`\n→ POST /loading/rfid/batch (${tags.length} tag)${ulang ? ` · kiriman ${putaran}` : ''}`);
    const result = await call<LoadingRfidBatchResult>('POST', '/loading/rfid/batch', body, token);
    console.table(
      result.results.map((r) => ({
        tagId: r.tagId,
        status: r.status,
        part: r.partNumber,
        pesan: r.message,
      })),
    );
    console.log('summary', result.summary, '· totals', result.totals);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
