import type { Viewport } from 'next';
import { notFound } from 'next/navigation';
import type { StasiunKomponen } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getSessionUser } from '@/lib/session';
import { StasiunKanban } from '@/components/scan/stasiun-kanban';

export const dynamic = 'force-dynamic';

/**
 * Layar dikunci pada ukuran perangkatnya, 375×667 tegak.
 *
 * `maximumScale`/`userScalable` mematikan pinch-zoom: di layar yang dipegang
 * sambil membawa box, cubitan tidak sengaja menggeser tata letak dan operator
 * tidak punya tangan bebas untuk membetulkannya.
 *
 * `interactiveWidget: 'resizes-content'` membuat tinggi layar menyusut saat
 * papan tuts bawaan muncul, bukan menutupi isinya. Tanpa itu, panel hasil —
 * satu-satunya hal yang dilihat operator — bersembunyi di belakang papan tuts.
 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
};

/**
 * Stasiun kanban — satu area per pabrik, di scanner genggam 375×667.
 *
 * Alamatnya /komponen/<pabrik>: UNIT, BODY, atau ELEC. Satu layar menerima dua
 * jenis kartu — kartu komponen ARES yang memindahkan barang dari gudang ke WIP
 * pabrik ini, dan kartu WIP yang dicopot dari box lalu kembali kosong ke
 * peredaran.
 */
export default async function StasiunKomponenPage({
  params,
}: {
  params: Promise<{ pabrik: string }>;
}) {
  const { pabrik } = await params;
  const kode = decodeURIComponent(pabrik);
  const user = await getSessionUser();

  let awal: StasiunKomponen;
  try {
    awal = await apiFetch<StasiunKomponen>(`/komponen/stasiun/${encodeURIComponent(kode)}`);
  } catch {
    // Pabrik yang tidak dikenal berarti alamatnya salah, bukan server gagal.
    notFound();
  }

  return <StasiunKanban awal={awal} npk={user?.npk ?? '—'} />;
}
