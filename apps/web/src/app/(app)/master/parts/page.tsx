import Link from 'next/link';
import { listParts } from '@/lib/queries';

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
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Master Part</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            {meta.total} part terdaftar
          </p>
        </div>

        {/* Form GET biasa: pencarian jadi bagian URL, bisa di-bookmark dan
            di-refresh tanpa state klien apa pun. */}
        <form className="flex gap-2">
          <input
            type="search"
            name="q"
            defaultValue={search ?? ''}
            placeholder="Cari part number / nama"
            className="w-64 rounded-lg border px-3 py-2 text-sm outline-none focus:border-brand-500"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          />
          <button
            type="submit"
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Cari
          </button>
        </form>
      </header>

      <div className="surface overflow-x-auto rounded-xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: 'var(--border)' }}>
              <Th>Part Number</Th>
              <Th>Back No.</Th>
              <Th>Nama</Th>
              <Th>Pabrik</Th>
              <Th>Proses</Th>
              <Th>Line</Th>
              <Th className="text-right">Qty/Kanban</Th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
                  Tidak ada part yang cocok. Jalankan <code>pnpm db:seed</code> untuk data contoh.
                </td>
              </tr>
            ) : (
              data.map((p) => (
                <tr key={p.id} className="border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                  <Td className="font-medium">{p.partNumber}</Td>
                  <Td>{p.backNumber ?? '-'}</Td>
                  <Td>{p.name}</Td>
                  <Td>{p.plantCode ?? '-'}</Td>
                  <Td>{p.processType}</Td>
                  <Td>{p.lineName ?? '-'}</Td>
                  <Td className="tabular text-right">{p.qtyPerKanban ?? '-'}</Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {meta.totalPages > 1 ? (
        <nav className="flex items-center justify-between text-sm">
          <span style={{ color: 'var(--muted)' }}>
            Halaman {meta.page} dari {meta.totalPages}
          </span>
          <div className="flex gap-2">
            <PageLink page={meta.page - 1} disabled={meta.page <= 1} search={search}>
              Sebelumnya
            </PageLink>
            <PageLink page={meta.page + 1} disabled={meta.page >= meta.totalPages} search={search}>
              Berikutnya
            </PageLink>
          </div>
        </nav>
      ) : null}
    </div>
  );
}

function PageLink({
  page,
  disabled,
  search,
  children,
}: {
  page: number;
  disabled: boolean;
  search?: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="rounded-lg border px-3 py-1.5 opacity-40" style={{ borderColor: 'var(--border)' }}>
        {children}
      </span>
    );
  }
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set('q', search);
  return (
    <Link
      href={`/master/parts?${query.toString()}`}
      className="rounded-lg border px-3 py-1.5 hover:bg-brand-50"
      style={{ borderColor: 'var(--border)' }}
    >
      {children}
    </Link>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-5 py-2.5 text-xs font-medium uppercase tracking-wide ${className}`} style={{ color: 'var(--muted)' }}>
      {children}
    </th>
  );
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-2.5 ${className}`}>{children}</td>;
}
