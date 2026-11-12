import Link from 'next/link';
import { ScanLine, ArrowUpRight } from 'lucide-react';
import { listLines } from '@/lib/queries';
import { getSessionUser } from '@/lib/session';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { IconBadge } from '@/components/ui/icon-badge';
import { Chip } from '@/components/ui/chip';
import { FilterBar } from '@/components/ui/filter-bar';
import { Stagger, StaggerItem } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

function satu(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[v.length - 1] : v;
}

/**
 * Pemilih line sebelum masuk layar stasiun.
 *
 * Di avicenna, line dipilih lewat modal scan barcode line di setiap halaman
 * proses. Di sini line menjadi bagian dari alamat halaman, sehingga stasiun
 * bisa di-bookmark dan layar yang menyala terus di lantai produksi kembali ke
 * line yang sama setelah komputernya di-restart.
 *
 * Line dibagi per pabrik — satu tab dibuka, bawaannya pabrik pengguna — lalu
 * disaring nama/kode dan jenis prosesnya. Line receiving (SE0800 dan
 * kawannya) tidak tampil: tempatnya di Scan Komponen, layar genggam.
 */
export default async function ScanIndexPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const [semua, user] = await Promise.all([listLines(), getSessionUser()]);
  const lines = semua.filter((l) => l.processGroup !== 'RECEIVING');

  const daftarPabrik = [...new Set(lines.map((l) => l.plantCode ?? '—'))];
  const pabrikUser = lines.find((l) => l.plantId === user?.plantId)?.plantCode;
  const dimintaPabrik = satu(sp.pabrik);
  const pabrik =
    (dimintaPabrik && daftarPabrik.includes(dimintaPabrik) ? dimintaPabrik : null) ??
    pabrikUser ??
    daftarPabrik[0] ??
    '';

  const q = satu(sp.q)?.trim() ?? '';
  const diPabrik = lines.filter((l) => (l.plantCode ?? '—') === pabrik);
  const pilihanProses = [
    ...new Map(diPabrik.map((l) => [l.processType, l.processLabel ?? l.processType])),
  ].map(([value, label]) => ({ value, label }));
  const dimintaProses = satu(sp.proses) ?? '';
  const proses = pilihanProses.some((p) => p.value === dimintaProses) ? dimintaProses : '';

  const cari = q.toLowerCase();
  const tampil = diPabrik.filter(
    (l) =>
      (!proses || l.processType === proses) &&
      (!cari || l.code.toLowerCase().includes(cari) || l.name.toLowerCase().includes(cari)),
  );

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Scan' }]}
        title="Scan Produksi"
        description="Pilih line tempat Anda bekerja"
      />

      {lines.length === 0 ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          Belum ada line. Tambahkan lebih dulu di Master Data.
        </Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2" aria-label="Pabrik">
            {daftarPabrik.map((kode) => (
              <Link
                key={kode}
                // Kata yang dicari ikut; jenis proses tidak, karena berbeda per pabrik.
                href={`/scan?${new URLSearchParams({ pabrik: kode, ...(q ? { q } : {}) })}`}
                aria-current={pabrik === kode ? 'page' : undefined}
                className={`min-h-11 rounded-full border px-4 py-2.5 text-sm ${pabrik === kode ? 'border-accent bg-accent text-white' : 'border-line bg-card text-ink-muted'}`}
              >
                {kode}
                <span className="tabular ml-1.5 opacity-70">
                  {lines.filter((l) => (l.plantCode ?? '—') === kode).length}
                </span>
              </Link>
            ))}
          </div>

          <FilterBar
            action="/scan"
            cariLabel="kode atau nama line"
            q={q}
            tetap={{ pabrik }}
            filters={[
              { name: 'proses', label: 'Jenis proses', pilihan: pilihanProses, nilai: proses },
            ]}
          />

          {tampil.length === 0 ? (
            <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
              Tidak ada line {pabrik} yang cocok dengan saringan ini.
            </Card>
          ) : (
            <Stagger
              key={`${pabrik}:${proses}:${q}`}
              className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
            >
              {tampil.map((line) => (
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
      )}
    </>
  );
}
