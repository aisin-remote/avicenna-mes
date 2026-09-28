import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';

/**
 * Layout untuk halaman yang dicetak: label, slip, dokumen.
 *
 * Tanpa sidebar, tanpa header, latar putih — printer tidak butuh menu, dan
 * warna latar aplikasi hanya menghabiskan tinta. Tetap di balik sesi: label
 * DN adalah dokumen yang menggerakkan barang, bukan halaman publik.
 */
export default async function CetakLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return <div className="min-h-screen bg-white text-black">{children}</div>;
}
