import { notFound } from 'next/navigation';
import { getPapanStasiun } from '@/lib/scan-api';
import { PapanStasiun } from '@/components/scan/papan-stasiun';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ line: string }>;
}

/**
 * Papan perintah kerja lini finish good.
 *
 * Beralamat SENDIRI, terpisah dari /scan/<line>, dan itu disengaja untuk
 * sekarang: papan ini belum memuat kotak scan, sedangkan layar scan yang ada
 * sudah dipakai berproduksi. Mengganti layar scan sebelum papannya bisa
 * menerima scan berarti menghentikan lini demi tampilan.
 *
 * Begitu bentuknya disetujui dan jalur scan-nya dipindahkan ke sini, alamat
 * ini yang menggantikan /scan/<line> untuk lini FG.
 */
export default async function PapanPage({ params }: PageProps) {
  const { line } = await params;
  const code = decodeURIComponent(line);

  let papan;
  try {
    papan = await getPapanStasiun(code);
  } catch {
    notFound();
  }

  return <PapanStasiun awal={papan} />;
}
