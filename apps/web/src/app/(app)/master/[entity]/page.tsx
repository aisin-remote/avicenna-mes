import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { isMasterEntity, getEntityDef, type MasterEntity } from '@avicenna/contracts';
import { listMaster, getMasterOptions, type RefOption } from '@/lib/master-api';
import { PageHeader } from '@/components/ui/page-header';
import { MasterTable } from '@/components/master/master-table';
import { MasterImport } from '@/components/master/master-import';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ entity: string }>;
  searchParams: Promise<{ page?: string; q?: string }>;
}

/**
 * Satu halaman untuk seluruh entitas master.
 *
 * Tabel, formulir, dan validasinya dibangun dari definisi di
 * @avicenna/contracts. Menambah entitas master baru cukup menambah entri di
 * registry dan pemetaan tabelnya — halaman ini tidak perlu disentuh.
 */
export default async function MasterEntityPage({ params, searchParams }: PageProps) {
  const { entity: raw } = await params;
  if (!isMasterEntity(raw)) notFound();
  const entity: MasterEntity = raw;
  const def = getEntityDef(entity);

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const search = sp.q?.trim() || undefined;

  const { data, meta } = await listMaster(entity, { page, perPage: 25, q: search });

  // Ambil pilihan untuk setiap kolom referensi, lalu susun peta id -> label
  // supaya tabel bisa menampilkan nama alih-alih angka id.
  const refEntities = [
    ...new Set(def.fields.filter((f) => f.kind === 'reference' && f.refEntity).map((f) => f.refEntity!)),
  ];
  const optionLists = await Promise.all(refEntities.map((e) => getMasterOptions(e)));

  const options: Record<string, RefOption[]> = {};
  refEntities.forEach((e, i) => {
    options[e] = optionLists[i] ?? [];
  });

  const refLabels: Record<string, Record<string, string>> = {};
  for (const field of def.fields) {
    if (field.kind !== 'reference' || !field.refEntity) continue;
    const map: Record<string, string> = {};
    for (const o of options[field.refEntity] ?? []) map[String(o.value)] = o.short ?? o.label;
    refLabels[field.name] = map;
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master Data' }, { label: def.label }]}
        title={def.label}
        description={`${meta.total} ${def.label.toLowerCase()} terdaftar — ${def.description.toLowerCase()}`}
        actions={
          // Form GET biasa: pencarian jadi bagian URL sehingga bisa di-bookmark
          // dan di-refresh tanpa state klien apa pun.
          <form className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-ink-muted"
              strokeWidth={1.8}
              aria-hidden
            />
            <input
              type="search"
              name="q"
              defaultValue={search ?? ''}
              placeholder={`Cari ${def.label.toLowerCase()}`}
              aria-label={`Cari ${def.label}`}
              className="h-11 w-72 rounded-full border border-line bg-card pl-11 pr-4 text-[14px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong"
            />
          </form>
        }
      />

      <Reveal>
        {/* Unduh template dan unggah Excel — di atas tabel, sebelum daftarnya,
            karena keduanya dipakai saat master masih kosong atau baru diisi
            massal. */}
        <div className="mb-4">
          <MasterImport entity={entity} label={def.label} />
        </div>

        <MasterTable
          def={def}
          entity={entity}
          rows={data}
          options={options}
          refLabels={refLabels}
        />
      </Reveal>

      {meta.totalPages > 1 ? (
        <nav className="mt-5 flex items-center justify-between text-[14px]">
          <span className="text-ink-muted">
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <PageLink
              entity={entity}
              page={meta.page - 1}
              disabled={meta.page <= 1}
              search={search}
              dir="prev"
            >
              Sebelumnya
            </PageLink>
            <PageLink
              entity={entity}
              page={meta.page + 1}
              disabled={meta.page >= meta.totalPages}
              search={search}
              dir="next"
            >
              Berikutnya
            </PageLink>
          </div>
        </nav>
      ) : null}
    </>
  );
}

function PageLink({
  entity,
  page,
  disabled,
  search,
  dir,
  children,
}: {
  entity: MasterEntity;
  page: number;
  disabled: boolean;
  search?: string;
  dir: 'prev' | 'next';
  children: React.ReactNode;
}) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight;
  const content = (
    <>
      {dir === 'prev' ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
      {children}
      {dir === 'next' ? <Icon className="size-4" strokeWidth={2} aria-hidden /> : null}
    </>
  );

  if (disabled) {
    return (
      <span
        aria-disabled
        className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line px-4 font-medium text-ink-muted opacity-45"
      >
        {content}
      </span>
    );
  }

  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('q', search);

  return (
    <Link
      href={`/master/${entity}?${query.toString()}`}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 font-medium transition-colors duration-200 hover:border-line-strong hover:bg-surface"
    >
      {content}
    </Link>
  );
}
