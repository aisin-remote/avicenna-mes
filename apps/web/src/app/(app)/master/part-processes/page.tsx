import { Route } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { MatriksRute, type BarisMatriks } from '@/components/routing/matriks-rute';

export const dynamic = 'force-dynamic';

interface Matriks {
  proses: string[];
  finishGood: string[];
  baris: BarisMatriks[];
}

export default async function RutePage() {
  const [matriks, liniPerProses] = await Promise.all([
    apiFetch<Matriks>('/routing/matrix'),
    apiFetch<Record<string, string[]>>('/routing/lines'),
  ]);

  const tanpaRute = matriks.baris.filter((b) => Object.keys(b.rute).length === 0).length;
  const bermasalah = matriks.baris.filter((b) => b.masalah.length > 0).length;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master', href: '/master/parts' }, { label: 'Rute Proses' }]}
        title="Rute Proses"
        description="Proses yang dilalui tiap part, beserta urutannya. Klik sel untuk mengubah."
      />

      {matriks.baris.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada part aktif. Tambahkan part lebih dulu di master.
        </Card>
      ) : (
        <>
          {/* Part tanpa rute tidak diperiksa urutannya saat scan — itu perlu
              terlihat, bukan tersembunyi di antara ratusan baris. */}
          {tanpaRute > 0 ? (
            <p className="mb-5 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
              <Route className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>
                <strong>{tanpaRute} part belum punya rute.</strong> Scan untuk part itu tetap
                diterima, tetapi urutan prosesnya tidak diperiksa — operator bisa melewati proses
                tanpa tertahan.
              </span>
            </p>
          ) : null}

          {/* Rute yang melanggar aturan lini finish good perlu terlihat lebih
              dulu: barangnya tidak akan punya kanban, dan itu baru ketahuan
              saat truk sudah menunggu di dock. */}
          {bermasalah > 0 ? (
            <p className="mb-5 flex items-start gap-2 rounded-card border border-ng/40 bg-ng/10 px-4 py-3 text-[14px] text-ng">
              <Route className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
              <span>
                <strong>{bermasalah} rute tidak wajar.</strong> Rincian masalahnya ada di kolom
                paling kanan masing-masing baris.
              </span>
            </p>
          ) : null}

          <MatriksRute
            proses={matriks.proses}
            finishGood={matriks.finishGood}
            baris={matriks.baris}
            liniPerProses={liniPerProses}
          />
        </>
      )}
    </>
  );
}
