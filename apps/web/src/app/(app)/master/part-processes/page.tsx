import Link from 'next/link';
import { ChevronLeft, ChevronRight, Route } from 'lucide-react';
import { getEntityDef, PER_HALAMAN, type DaftarRutePart } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getMasterOptions, type RefOption } from '@/lib/master-api';
import { katalogProsesServer } from '@/lib/process-types';
import { PageHeader } from '@/components/ui/page-header';
import { FilterBar } from '@/components/ui/filter-bar';
import { MasterImport } from '@/components/master/master-import';
import { TabelRutePart } from '@/components/master/tabel-rute-part';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

type Sp = Record<string, string | string[] | undefined>;

function satu(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[v.length - 1] : v)?.trim() ?? '';
}

/**
 * Rute per part, satu baris per part di satu work center.
 *
 * Halaman sendiri, bukan `[entity]`: kolom group product dan work center datang
 * dari part dan line, dan kelengkapannya dihitung per part. Formulir dan unggah
 * Excel-nya tetap milik master generik.
 */
export default async function RutePartPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams;
  const def = getEntityDef('part-processes');
  const saringan = {
    q: satu(sp.q),
    plantId: satu(sp.plantId),
    project: satu(sp.project),
    kelengkapan: satu(sp.kelengkapan),
    perPage: satu(sp.perPage),
  };
  const perPage = (PER_HALAMAN as readonly number[]).includes(Number(saringan.perPage))
    ? Number(saringan.perPage)
    : PER_HALAMAN[0];

  const buatAlamat = (page: number) => {
    const qs = new URLSearchParams();
    for (const [nama, nilai] of Object.entries(saringan)) if (nilai) qs.set(nama, nilai);
    qs.set('page', String(page));
    return qs.toString();
  };

  const [rute, plants, partOpsi, lines, locations, katalog] = await Promise.all([
    apiFetch<DaftarRutePart>(`/routing/rute?${buatAlamat(Math.max(1, Number(satu(sp.page)) || 1))}`),
    getMasterOptions('plants'),
    getMasterOptions('parts'),
    getMasterOptions('lines'),
    getMasterOptions('locations'),
    katalogProsesServer(),
  ]);
  const { data, meta, ringkasan, projects } = rute;
  const options: Record<string, RefOption[]> = { plants, parts: partOpsi, lines, locations };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master Data' }, { label: def.label }]}
        title={def.label}
        description={`${ringkasan.baris} langkah terdaftar — ${def.description.toLowerCase()}`}
      />

      <Reveal>
        {ringkasan.perluDilengkapi > 0 || ringkasan.partTanpaRute > 0 ? (
          <p className="mb-4 flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
            <Route className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
            <span>
              {ringkasan.perluDilengkapi > 0 ? (
                <>
                  <strong>{ringkasan.perluDilengkapi} langkah perlu dilengkapi.</strong>{' '}
                  <Link href="?kelengkapan=kurang" className="font-semibold underline">
                    Tampilkan yang kurang
                  </Link>
                  .{' '}
                </>
              ) : null}
              {ringkasan.partTanpaRute > 0 ? (
                <>
                  <strong>{ringkasan.partTanpaRute} part aktif belum punya rute.</strong> Scan part
                  itu tetap diterima dengan peringatan, dan dokumen SAP-nya ditahan.
                </>
              ) : null}
            </span>
          </p>
        ) : null}

        <div className="mb-4">
          <MasterImport entity="part-processes" label={def.label} />
        </div>

        <FilterBar
          action="/master/part-processes"
          cariLabel="part atau work center"
          q={saringan.q}
          perPage={perPage}
          filters={[
            {
              name: 'plantId',
              label: 'Pabrik',
              nilai: saringan.plantId,
              pilihan: plants.map((p) => ({ value: String(p.value), label: p.short })),
            },
            {
              name: 'project',
              label: 'Group Product',
              nilai: saringan.project,
              pilihan: projects.map((p) => ({ value: p, label: p })),
            },
            {
              name: 'kelengkapan',
              label: 'Kelengkapan',
              nilai: saringan.kelengkapan,
              pilihan: [{ value: 'kurang', label: 'Perlu dilengkapi' }],
            },
          ]}
        />

        <TabelRutePart
          def={def}
          rows={data}
          options={options}
          pilihanDariMaster={{
            'process-types': katalog.kode.map((k) => ({ value: k, label: katalog.label(k) })),
          }}
        />
      </Reveal>

      <nav className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[14px]">
        <span className="text-ink-muted">
          {meta.total === 0
            ? 'Tidak ada baris yang cocok'
            : `Menampilkan ${(meta.page - 1) * meta.perPage + 1}–` +
              `${Math.min(meta.page * meta.perPage, meta.total)} dari ${meta.total}` +
              (meta.totalPages > 1 ? ` · halaman ${meta.page} dari ${meta.totalPages}` : '')}
        </span>
        {meta.totalPages > 1 ? (
          <div className="flex gap-2">
            <TautanHalaman href={meta.page > 1 ? `?${buatAlamat(meta.page - 1)}` : null}>
              <ChevronLeft className="size-4" strokeWidth={2} aria-hidden />
              Sebelumnya
            </TautanHalaman>
            <TautanHalaman href={meta.page < meta.totalPages ? `?${buatAlamat(meta.page + 1)}` : null}>
              Berikutnya
              <ChevronRight className="size-4" strokeWidth={2} aria-hidden />
            </TautanHalaman>
          </div>
        ) : null}
      </nav>
    </>
  );
}

function TautanHalaman({ href, children }: { href: string | null; children: React.ReactNode }) {
  if (!href) {
    return (
      <span
        aria-disabled
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line px-4 font-medium text-ink-muted opacity-45"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 font-medium transition-colors duration-200 hover:border-line-strong hover:bg-surface"
    >
      {children}
    </Link>
  );
}
