import Link from 'next/link';
import { Package, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { listParts } from '@/lib/queries';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import { Chip } from '@/components/ui/chip';
import { Reveal } from '@/components/motion/reveal';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ page?: string; q?: string }>;
}

export default async function PartsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const search = params.q?.trim() || undefined;

  const { data, meta } = await listParts({ page, perPage: 25, search });

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master Data' }, { label: 'Part' }]}
        title="Master Part"
        description={`${meta.total} part terdaftar di seluruh pabrik`}
        actions={
          // Form GET biasa: pencarian jadi bagian URL, bisa di-bookmark dan
          // di-refresh tanpa state klien apa pun.
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
              placeholder="Cari part number atau nama"
              aria-label="Cari part"
              className="h-11 w-72 rounded-full border border-line bg-card pl-11 pr-4 text-[14px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong"
            />
          </form>
        }
      />

      <Reveal>
        <Card>
          <CardHeader
            icon={Package}
            title="Daftar Part"
            subtitle={search ? `Hasil pencarian untuk "${search}"` : 'Seluruh part aktif'}
          />
          <Table>
            <thead>
              <tr>
                <Th>Part Number</Th>
                <Th>Back No.</Th>
                <Th>Nama</Th>
                <Th>Pabrik</Th>
                <Th>Proses</Th>
                <Th>Line</Th>
                <Th align="right">Qty/Kanban</Th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <EmptyState colSpan={7}>
                  {search ? (
                    <>
                      Tidak ada part yang cocok dengan &ldquo;{search}&rdquo;.{' '}
                      <Link href="/master/parts" className="underline underline-offset-4">
                        Hapus pencarian
                      </Link>
                    </>
                  ) : (
                    <>
                      Belum ada part. Jalankan{' '}
                      <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[13px]">
                        pnpm db:seed
                      </code>{' '}
                      untuk data contoh.
                    </>
                  )}
                </EmptyState>
              ) : (
                data.map((p) => (
                  <Tr key={p.id}>
                    <Td strong>{p.partNumber}</Td>
                    <Td>{p.backNumber ?? '—'}</Td>
                    <Td>{p.name}</Td>
                    <Td>
                      <Chip value={p.plantCode ?? '—'} />
                    </Td>
                    <Td>
                      <Chip value={p.processType} />
                    </Td>
                    <Td>{p.lineName ?? '—'}</Td>
                    <Td align="right" strong className="tabular">
                      {p.qtyPerKanban ?? '—'}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </Reveal>

      {meta.totalPages > 1 ? (
        <nav className="mt-5 flex items-center justify-between text-[14px]">
          <span className="text-ink-muted">
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <PageLink page={meta.page - 1} disabled={meta.page <= 1} search={search} dir="prev">
              Sebelumnya
            </PageLink>
            <PageLink
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
  page,
  disabled,
  search,
  dir,
  children,
}: {
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
      href={`/master/parts?${query.toString()}`}
      className="inline-flex h-10 items-center gap-1.5 rounded-full border border-line bg-card px-4 font-medium transition-colors duration-200 hover:border-line-strong hover:bg-surface"
    >
      {content}
    </Link>
  );
}
