import Link from 'next/link';
import { Route, SlidersHorizontal } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { MatriksRute, type BarisMatriks } from '@/components/routing/matriks-rute';

export const dynamic = 'force-dynamic';

interface Matriks {
  proses: string[];
  finishGood: string[];
  /** plantId -> processType -> push SAP aktif. Dari master Rute Proses. */
  sapAktif: Record<number, Record<string, boolean>>;
  prosesTerdaftar: Record<number, string[]>;
  prosesTakTerdaftar: Record<number, Array<{ processType: string; lini: number; rute: number }>>;
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
        crumbs={[{ label: 'Master Data', href: '/master/parts' }, { label: 'Rute Proses per Part' }]}
        title="Rute Proses per Part"
        description="Proses yang dilalui tiap part, beserta urutannya. Klik sel untuk menambah atau mencabut."
        actions={
          /*
           * SLOC dan SAP TIDAK diatur di sini — itu per proses, urusan PPIC/IT,
           * di menu Integrasi. Matriks ini hanya menjawab "part ini lewat
           * proses apa", pertanyaan milik leader produksi.
           *
           * Tautan kedua ke CRUD junction: untuk unggah Excel massal 14 part.
           */
          <>
            <Link
              href="/master/part-processes"
              className="inline-flex items-center gap-2 rounded-full border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
            >
              <SlidersHorizontal className="size-4" strokeWidth={1.8} aria-hidden />
              Daftar & unggah Excel
            </Link>
          </>
        }
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
            sapAktif={matriks.sapAktif}
            prosesTerdaftar={matriks.prosesTerdaftar}
            prosesTakTerdaftar={matriks.prosesTakTerdaftar}
          />
        </>
      )}
    </>
  );
}
