import { notFound, redirect } from 'next/navigation';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/session';
import { PROCESS_GROUPS } from '@avicenna/contracts';
import { StasiunProses } from '@/components/scan/stasiun-proses';

export const dynamic = 'force-dynamic';

interface LiniGrup {
  grup: string;
  label: string;
  lines: Array<{
    id: number;
    code: string;
    name: string;
    processType: string;
    plantCode: string | null;
  }>;
}

/**
 * Layar scan untuk satu GRUP proses.
 *
 * Operator dibawa ke sini tepat setelah login — lasman casting ke grup casting.
 * Lininya belum diketahui saat itu: ia ditentukan dengan men-scan barcode lini
 * di layar ini, bukan dipilih dari daftar panjang. Daftar tetap disediakan
 * sebagai jalan keluar saat barcode lininya rusak.
 */
export default async function ScanProsesPage({
  params,
}: {
  params: Promise<{ grup: string }>;
}) {
  const { grup } = await params;
  const tegak = grup.toUpperCase();
  if (!(PROCESS_GROUPS as readonly string[]).includes(tegak)) notFound();

  const [user, data] = await Promise.all([
    getSessionUser(),
    apiFetch<LiniGrup>(`/scan/proses/${encodeURIComponent(grup)}/lines`),
  ]);
  // Layout stasiun sudah memeriksa sesi; ini hanya menjaga tipe, dan menutup
  // celah bila layout-nya suatu saat diubah.
  if (!user) redirect('/login');

  return (
    <StasiunProses
      grup={grup}
      label={data.label}
      lines={data.lines}
      operator={user.name}
    />
  );
}
