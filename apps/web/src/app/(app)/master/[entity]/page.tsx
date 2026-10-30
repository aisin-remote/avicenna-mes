import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  isMasterEntity,
  getEntityDef,
  filterFields,
  tafsirNilaiFilter,
  AWALAN_FILTER,
  PER_HALAMAN,
  type MasterEntity,
} from '@avicenna/contracts';
import { listMaster, getMasterOptions, type RefOption } from '@/lib/master-api';
import { katalogProsesServer } from '@/lib/process-types';
import { PageHeader } from '@/components/ui/page-header';
import { MasterTable } from '@/components/master/master-table';
import type { PilihanDariMaster } from '@/components/master/master-form';
import { MasterImport } from '@/components/master/master-import';
import { FilterBar, type FilterTampil, type PilihanFilter } from '@/components/ui/filter-bar';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ entity: string }>;
  /* Kunci penyaring tidak tetap (`f_plantId`, `f_isActive`, …), jadi bentuknya
     terbuka — yang memeriksa nama kolomnya adalah registry, bukan tipe ini. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Nilai tunggal dari query; array (parameter ganda) diambil yang terakhir. */
function satu(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[v.length - 1] : v;
}

/**
 * Satu halaman untuk seluruh entitas master.
 *
 * Tabel, formulir, validasi, DAN penyaringnya dibangun dari definisi di
 * @avicenna/contracts. Menambah entitas master baru cukup menambah entri di
 * registry dan pemetaan tabelnya — halaman ini tidak perlu disentuh, termasuk
 * untuk mendapatkan dropdown penyaring.
 */
export default async function MasterEntityPage({ params, searchParams }: PageProps) {
  const { entity: raw } = await params;
  if (!isMasterEntity(raw)) notFound();
  const entity: MasterEntity = raw;
  const def = getEntityDef(entity);

  const sp = await searchParams;
  const page = Math.max(1, Number(satu(sp.page) ?? 1) || 1);
  const search = satu(sp.q)?.trim() || undefined;

  const perPageMinta = Number(satu(sp.perPage) ?? 0);
  const perPage = (PER_HALAMAN as readonly number[]).includes(perPageMinta)
    ? perPageMinta
    : PER_HALAMAN[0];

  /*
   * Penyaring dari URL, hanya kolom yang registry akui dan nilai yang bisa
   * ditafsirkan. Nilai asing dibuang di sini DAN di API — yang di sini supaya
   * dropdown-nya tidak menampilkan pilihan yang sebenarnya tidak berlaku,
   * yang di API supaya penjaganya tidak bergantung pada layar.
   */
  const bolehDisaring = filterFields(def);
  const filterAktif: Record<string, string> = {};
  for (const field of bolehDisaring) {
    const mentah = satu(sp[`${AWALAN_FILTER}${field.name}`]);
    if (tafsirNilaiFilter(field, mentah) === undefined) continue;
    filterAktif[field.name] = mentah!.trim();
  }

  const { data, meta } = await listMaster(entity, {
    page,
    perPage,
    q: search,
    filters: filterAktif,
  });

  // Ambil pilihan untuk setiap kolom referensi, lalu susun peta id -> label
  // supaya tabel bisa menampilkan nama alih-alih angka id.
  const refEntities = [
    ...new Set(
      def.fields.filter((f) => f.kind === 'reference' && f.refEntity).map((f) => f.refEntity!),
    ),
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

  /*
   * Jenis proses adalah satu-satunya kolom yang pilihannya datang dari master
   * LAIN sambil menyimpan KODE, bukan id — jadi daftarnya tidak bisa diambil
   * lewat getMasterOptions yang mengembalikan id. Diambil hanya bila memang
   * ada kolom seperti itu, supaya entitas lain tidak membayar permintaan yang
   * tidak dipakainya.
   */
  const butuhKatalogProses = def.fields.some((f) => f.optionsFrom === 'process-types');
  const katalog = butuhKatalogProses ? await katalogProsesServer() : null;

  /* Dipakai DUA kali: pilihan dropdown penyaring, dan pilihan dropdown yang
     sama di formulir tambah/ubah. Satu permintaan, satu daftar — kalau
     diambil terpisah, keduanya bisa berbeda dalam satu layar. */
  const pilihanDariMaster: PilihanDariMaster | undefined = katalog
    ? { 'process-types': katalog.kode.map((k) => ({ value: k, label: katalog.label(k) })) }
    : undefined;

  const filters: FilterTampil[] = bolehDisaring.map((field) => {
    let pilihan: PilihanFilter[] = [];
    if (field.kind === 'boolean') {
      pilihan = [
        { value: 'true', label: 'Ya' },
        { value: 'false', label: 'Tidak' },
      ];
    } else if (field.optionsFrom) {
      pilihan = pilihanDariMaster?.[field.optionsFrom] ?? [];
    } else if (field.kind === 'select') {
      pilihan = (field.options ?? []).map((o) => ({
        value: o,
        label: field.optionLabels?.[o] ?? o,
      }));
    } else if (field.kind === 'reference' && field.refEntity) {
      pilihan = (options[field.refEntity] ?? []).map((o) => ({
        value: String(o.value),
        label: o.short ?? String(o.label),
      }));
    }
    return {
      /* Berawalan `f_` di URL supaya nama kolom master tidak pernah bertabrakan
         dengan parameter halaman — lihat catatan di controller API. */
      name: `${AWALAN_FILTER}${field.name}`,
      label: field.label,
      pilihan,
      nilai: filterAktif[field.name] ?? '',
    };
  });

  const adaPenyempitan = Boolean(search) || Object.keys(filterAktif).length > 0;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master Data' }, { label: def.label }]}
        title={def.label}
        description={
          adaPenyempitan
            ? `${meta.total} dari seluruh ${def.label.toLowerCase()} cocok dengan saringan yang dipasang`
            : `${meta.total} ${def.label.toLowerCase()} terdaftar — ${def.description.toLowerCase()}`
        }
      />

      <Reveal>
        {/* Unduh template dan unggah Excel — di atas tabel, sebelum daftarnya,
            karena keduanya dipakai saat master masih kosong atau baru diisi
            massal. */}
        <div className="mb-4">
          <MasterImport entity={entity} label={def.label} />
        </div>

        {/* Kendali penyaring menempel langsung di atas tabel: yang diubah di
            sini mengubah isi tabel, dan jaraknya ke tabel itu yang membuat
            hubungan keduanya terbaca tanpa dijelaskan. */}
        <FilterBar
          action={`/master/${entity}`}
          cariLabel={def.label.toLowerCase()}
          q={search ?? ''}
          perPage={perPage}
          filters={filters}
        />

        <MasterTable
          def={def}
          entity={entity}
          rows={data}
          options={options}
          pilihanDariMaster={pilihanDariMaster}
          refLabels={refLabels}
          disaring={adaPenyempitan}
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
            <PageLink
              entity={entity}
              page={meta.page - 1}
              disabled={meta.page <= 1}
              search={search}
              perPage={perPage}
              filters={filterAktif}
              dir="prev"
            >
              Sebelumnya
            </PageLink>
            <PageLink
              entity={entity}
              page={meta.page + 1}
              disabled={meta.page >= meta.totalPages}
              search={search}
              perPage={perPage}
              filters={filterAktif}
              dir="next"
            >
              Berikutnya
            </PageLink>
          </div>
        ) : null}
      </nav>
    </>
  );
}

function PageLink({
  entity,
  page,
  disabled,
  search,
  perPage,
  filters,
  dir,
  children,
}: {
  entity: MasterEntity;
  page: number;
  disabled: boolean;
  search?: string;
  perPage: number;
  filters: Record<string, string>;
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

  /*
   * Pindah halaman harus MEMBAWA seluruh saringan yang berlaku. Tanpa ini,
   * "Berikutnya" diam-diam melepas penyaring dan halaman 2 menampilkan data
   * yang tidak ada hubungannya dengan halaman 1.
   */
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('q', search);
  if (perPage !== PER_HALAMAN[0]) query.set('perPage', String(perPage));
  for (const [nama, nilai] of Object.entries(filters)) {
    query.set(`${AWALAN_FILTER}${nama}`, nilai);
  }

  return (
    <Link
      href={`/master/${entity}?${query.toString()}`}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 font-medium transition-colors duration-200 hover:border-line-strong hover:bg-surface"
    >
      {content}
    </Link>
  );
}
