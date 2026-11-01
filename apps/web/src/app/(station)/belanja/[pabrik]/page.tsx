import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { StasiunBelanja } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/session';
import { StasiunBelanjaLayar } from '@/components/scan/stasiun-belanja';

export const dynamic = 'force-dynamic';

/** Sama seperti stasiun kanban: 375×667 tegak, tanpa pinch-zoom. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

/**
 * Stasiun belanja — satu area per pabrik, di scanner genggam 375×667.
 *
 * Alamatnya /belanja/<pabrik>. Satu kartu FG ditembak lebih dulu sebagai
 * perintah, lalu kartu WIP tiap box yang diambil dari rak.
 */
export default async function StasiunBelanjaPage({
  params,
}: {
  params: Promise<{ pabrik: string }>;
}) {
  const { pabrik } = await params;
  const kode = decodeURIComponent(pabrik);
  const user = await getSessionUser();

  let awal: StasiunBelanja;
  try {
    awal = await apiFetch<StasiunBelanja>(`/belanja/stasiun/${encodeURIComponent(kode)}`);
  } catch {
    notFound();
  }

  return <StasiunBelanjaLayar awal={awal} npk={user?.npk ?? '—'} />;
}
