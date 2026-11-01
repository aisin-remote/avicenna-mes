import Link from 'next/link';
import { ArrowRight, ArrowUpRight, ScanBarcode, TriangleAlert } from 'lucide-react';
import { listAreaKomponen } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Chip } from '@/components/ui/chip';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

/**
 * Pemilih area sebelum masuk stasiun kanban — tiga, satu per pabrik.
 *
 * Halaman inilah yang ditunjuk menu, bukan stasiunnya: stasiun selalu milik
 * satu pabrik (/komponen/UNIT) supaya layar di lantai bisa di-bookmark dan
 * kembali ke area yang sama setelah perangkatnya mati. Tidak ada satu pabrik
 * yang benar untuk semua orang yang menekan menunya.
 *
 * Area yang SLOC-nya belum lengkap tetap muncul dan tetap bisa ditekan, dengan
 * peringatannya terbaca di kartunya. Menonaktifkannya di sini hanya memindahkan
 * penemuan masalah ke lantai produksi, di tangan orang yang tidak bisa
 * memperbaikinya.
 */
export default async function KomponenIndexPage() {
  const area = await listAreaKomponen();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Scan Komponen' }]}
        title="Scan Komponen"
        description="Pilih area perpindahan komponen — satu per pabrik"
      />

      {area.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada pabrik aktif. Isi dulu di Master Data › Pabrik.
        </Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {area.map((a) => {
            const lengkap = Boolean(a.gudang && a.wip);
            return (
              <StaggerItem key={a.id}>
                <Link href={`/komponen/${encodeURIComponent(a.code)}`} className="block h-full">
                  <Card interactive className="group h-full p-5">
                    <div className="flex items-start justify-between gap-3">
                      <IconBadge icon={ScanBarcode} />
                      <ArrowUpRight
                        className="size-5 text-ink-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                    </div>
                    <div className="mt-4 text-[18px] font-bold leading-tight tracking-tight">
                      Komponen {a.code}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{a.name}</div>

                    {lengkap ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="tabular inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[13px] font-bold">
                          {a.gudang}
                          <ArrowRight className="size-3.5" strokeWidth={2.4} aria-hidden />
                          {a.wip}
                        </span>
                        {/* Kode SAP disebut di sini: kosongnya berarti dokumen
                            perpindahan nanti ditahan, dan itu lebih baik
                            diketahui sebelum kartu pertama discan. */}
                        <Chip value={a.sapCode ? `SAP ${a.sapCode}` : 'SAP belum diisi'} />
                      </div>
                    ) : (
                      <p className="mt-4 flex items-start gap-2 rounded-2xl border border-dashed border-line p-3 text-[12.5px] leading-snug text-ink-muted">
                        <TriangleAlert
                          className="mt-0.5 size-4 shrink-0 text-ng"
                          strokeWidth={2}
                          aria-hidden
                        />
                        <span>
                          SLOC {a.gudang ? 'WIP' : 'gudang'} belum ada. Isi dulu di Master Data ›
                          Lokasi, kalau tidak kartu komponen akan ditolak.
                        </span>
                      </p>
                    )}
                  </Card>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </>
  );
}
