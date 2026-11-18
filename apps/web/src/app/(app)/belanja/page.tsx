import Link from 'next/link';
import { ArrowUpRight, ShoppingCart, TriangleAlert } from 'lucide-react';
import { listAreaBelanja } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Chip } from '@/components/ui/chip';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

/**
 * Pemilih area sebelum masuk stasiun belanja — satu per pabrik.
 *
 * Alasannya sama dengan stasiun kanban: stasiunnya selalu milik satu pabrik
 * (/belanja/BODY) supaya layar di lantai bisa di-bookmark, dan tidak ada satu
 * pabrik yang benar untuk semua orang yang menekan menunya.
 */
export default async function BelanjaIndexPage() {
  const area = await listAreaBelanja();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Scan Belanja' }]}
        title="Scan Belanja"
        description="Cocokkan kartu FG dengan kartu WIP yang isinya sesuai Part Pairing"
      />

      {area.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada pabrik aktif. Isi dulu di Master Data › Pabrik.
        </Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {area.map((a) => (
            <StaggerItem key={a.id}>
              <Link href={`/belanja/${encodeURIComponent(a.code)}`} className="block h-full">
                <Card interactive className="group h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <IconBadge icon={ShoppingCart} />
                    <ArrowUpRight
                      className="size-5 text-ink-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </div>
                  <div className="mt-4 text-[18px] font-bold leading-tight tracking-tight">
                    Belanja {a.code}
                  </div>
                  <div className="mt-1 line-clamp-2 text-[13px] text-ink-muted">{a.name}</div>

                  {a.prosesWajib.length > 0 ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {a.prosesWajib.map((p) => (
                        <Chip key={p} value={p} />
                      ))}
                    </div>
                  ) : (
                    /*
                     * Disebut, bukan disembunyikan: belanja di pabrik ini tetap
                     * bisa dicatat, hanya belum menghalangi scan produksi apa
                     * pun — dan itu keadaan yang harus terbaca, bukan ditebak.
                     */
                    <p className="mt-4 flex items-start gap-2 rounded-2xl border border-dashed border-line p-3 text-[12.5px] leading-snug text-ink-muted">
                      <TriangleAlert
                        className="mt-0.5 size-4 shrink-0 text-ink-muted"
                        strokeWidth={2}
                        aria-hidden
                      />
                      <span>
                        Belum ada proses yang mewajibkan belanja di sini. Nyalakan{' '}
                        <span className="font-semibold">Wajib Belanja</span> di Integrasi › Rute
                        Proses kalau interlock-nya mau berlaku.
                      </span>
                    </p>
                  )}
                </Card>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}
