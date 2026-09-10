import Link from 'next/link';
import { ScanLine, ArrowUpRight } from 'lucide-react';
import { listLines } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Chip } from '@/components/ui/chip';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

/**
 * Pemilih line sebelum masuk layar stasiun.
 *
 * Di avicenna, line dipilih lewat modal scan barcode line di setiap halaman
 * proses. Di sini line menjadi bagian dari alamat halaman, sehingga stasiun
 * bisa di-bookmark dan layar yang menyala terus di lantai produksi kembali ke
 * line yang sama setelah komputernya di-restart.
 */
export default async function ScanIndexPage() {
  const lines = await listLines();

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Scan' }]}
        title="Stasiun Scan"
        description="Pilih line tempat Anda bekerja"
      />

      {lines.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada line. Tambahkan lebih dulu di Master Data.
        </Card>
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {lines.map((line) => (
            <StaggerItem key={line.id}>
              <Link href={`/scan/${encodeURIComponent(line.code)}`} className="block h-full">
                <Card interactive className="group h-full p-5">
                  <div className="flex items-start justify-between gap-3">
                    <IconBadge icon={ScanLine} />
                    <ArrowUpRight
                      className="size-5 text-ink-muted transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink"
                      strokeWidth={1.8}
                      aria-hidden
                    />
                  </div>
                  <div className="mt-4 text-[18px] font-bold leading-tight tracking-tight">
                    {line.name}
                  </div>
                  <div className="mt-1 text-[14px] text-ink-muted">{line.code}</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Chip value={line.plantCode ?? '—'} />
                    <Chip value={line.processType} />
                  </div>
                </Card>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </>
  );
}
