import Link from 'next/link';
import { Search } from 'lucide-react';
import { getSessionUser } from '@/lib/session';
import { getMasterOptions } from '@/lib/master-api';
import { ambilPengguna, ambilRole } from '../actions';
import { PageHeader } from '@/components/ui/page-header';
import { UserTable } from '@/components/admin/user-table';

export const dynamic = 'force-dynamic';

/**
 * Pengaturan pengguna.
 *
 * Kewenangannya ditegakkan API (@AdminOnly di AdminController), bukan halaman
 * ini. Menyembunyikan menunya saja bukan pembatasan: alamat endpoint-nya ada di
 * berkas JavaScript yang dikirim ke setiap browser.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const [aku, { data, meta }, roles, plants] = await Promise.all([
    getSessionUser(),
    ambilPengguna({ q, page }),
    ambilRole(),
    getMasterOptions('plants'),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administrasi' }, { label: 'Pengguna' }]}
        title="Pengguna"
        description="Akun yang bisa masuk, beserta role dan pabriknya"
      />

      <form className="mb-5 flex max-w-md items-center gap-2" action="/admin/users">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            strokeWidth={1.8}
            aria-hidden
          />
          <input
            name="q"
            defaultValue={q ?? ''}
            placeholder="Cari NPK, nama, atau email"
            aria-label="Cari pengguna"
            className="w-full rounded-full border border-line bg-card py-2.5 pl-9 pr-3 text-[14px] outline-none transition-colors focus:border-ink"
          />
        </div>
        <button
          type="submit"
          className="rounded-full border border-line px-4 py-2.5 text-[14px] font-semibold transition-colors hover:border-ink"
        >
          Cari
        </button>
      </form>

      <UserTable
        rows={data}
        roles={roles}
        plants={plants.map((p) => ({
          id: Number(p.value),
          code: p.short ?? String(p.label),
          name: String(p.label),
        }))}
        meAku={aku?.id ?? null}
      />

      {meta.totalPages > 1 ? (
        <nav className="mt-5 flex items-center justify-between text-[14px]" aria-label="Halaman">
          <span className="text-ink-muted">
            Halaman {meta.page} dari {meta.totalPages} · {meta.total} pengguna
          </span>
          <span className="flex gap-2">
            {meta.page > 1 ? (
              <Link
                href={`/admin/users?page=${meta.page - 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:border-ink"
              >
                Sebelumnya
              </Link>
            ) : null}
            {meta.page < meta.totalPages ? (
              <Link
                href={`/admin/users?page=${meta.page + 1}${q ? `&q=${encodeURIComponent(q)}` : ''}`}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:border-ink"
              >
                Berikutnya
              </Link>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
