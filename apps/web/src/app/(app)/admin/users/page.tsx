import Link from 'next/link';
import { PER_HALAMAN } from '@avicenna/contracts';
import { getSessionUser } from '@/lib/session';
import { getMasterOptions } from '@/lib/master-api';
import { ambilPengguna, ambilRole } from '../actions';
import { PageHeader } from '@/components/ui/page-header';
import { FilterBar, type FilterTampil } from '@/components/ui/filter-bar';
import { UserTable } from '@/components/admin/user-table';

export const dynamic = 'force-dynamic';

/** Nilai tunggal dari query; array (parameter ganda) diambil yang terakhir. */
function satu(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[v.length - 1] : v;
}

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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = satu(sp.q)?.trim() || undefined;
  const page = Math.max(1, Number(satu(sp.page) ?? 1) || 1);

  const perPageMinta = Number(satu(sp.perPage) ?? 0);
  const perPage = (PER_HALAMAN as readonly number[]).includes(perPageMinta)
    ? perPageMinta
    : PER_HALAMAN[0];

  /*
   * Nilai penyaring dibersihkan di sini sebelum dikirim: angka yang bukan
   * angka dan 'aktif' yang bukan true/false dibuang, bukan diteruskan apa
   * adanya. Tanpa itu, alamat karangan menghasilkan daftar kosong yang tampak
   * seperti data pengguna hilang.
   */
  const roleIdMentah = satu(sp.roleId);
  const plantIdMentah = satu(sp.plantId);
  const aktifMentah = satu(sp.aktif);
  const roleId = Number(roleIdMentah) > 0 ? String(Number(roleIdMentah)) : '';
  const plantId = Number(plantIdMentah) > 0 ? String(Number(plantIdMentah)) : '';
  const aktif = aktifMentah === 'true' || aktifMentah === 'false' ? aktifMentah : '';

  const [aku, { data, meta }, roles, plants] = await Promise.all([
    getSessionUser(),
    ambilPengguna({ q, page, perPage, roleId, plantId, aktif }),
    ambilRole(),
    getMasterOptions('plants'),
  ]);

  const filters: FilterTampil[] = [
    {
      name: 'roleId',
      label: 'Role',
      nilai: roleId,
      pilihan: roles.map((r) => ({ value: String(r.id), label: r.label ?? r.name })),
    },
    {
      name: 'plantId',
      label: 'Pabrik',
      nilai: plantId,
      pilihan: plants.map((p) => ({
        value: String(p.value),
        label: p.short ?? String(p.label),
      })),
    },
    {
      name: 'aktif',
      label: 'Aktif',
      nilai: aktif,
      pilihan: [
        { value: 'true', label: 'Ya' },
        { value: 'false', label: 'Tidak' },
      ],
    },
  ];

  const adaPenyempitan = Boolean(q) || roleId !== '' || plantId !== '' || aktif !== '';

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administrasi' }, { label: 'Pengguna' }]}
        title="Pengguna"
        description={
          adaPenyempitan
            ? `${meta.total} pengguna cocok dengan saringan yang dipasang`
            : 'Akun yang bisa masuk, beserta role dan pabriknya'
        }
      />

      <FilterBar
        action="/admin/users"
        cariLabel="NPK, nama, atau email"
        q={q ?? ''}
        perPage={perPage}
        filters={filters}
      />

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

      <nav
        className="mt-5 flex flex-wrap items-center justify-between gap-3 text-[14px]"
        aria-label="Halaman"
      >
        <span className="text-ink-muted">
          {meta.total === 0
            ? 'Tidak ada pengguna yang cocok'
            : `Menampilkan ${(meta.page - 1) * meta.perPage + 1}–` +
              `${Math.min(meta.page * meta.perPage, meta.total)} dari ${meta.total}` +
              (meta.totalPages > 1 ? ` · halaman ${meta.page} dari ${meta.totalPages}` : '')}
        </span>
        {meta.totalPages > 1 ? (
          <span className="flex gap-2">
            {meta.page > 1 ? (
              <Link
                href={tautanHalaman({ page: meta.page - 1, q, perPage, roleId, plantId, aktif })}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:border-ink"
              >
                Sebelumnya
              </Link>
            ) : null}
            {meta.page < meta.totalPages ? (
              <Link
                href={tautanHalaman({ page: meta.page + 1, q, perPage, roleId, plantId, aktif })}
                className="rounded-full border border-line px-4 py-2 font-semibold transition-colors hover:border-ink"
              >
                Berikutnya
              </Link>
            ) : null}
          </span>
        ) : null}
      </nav>
    </>
  );
}

/**
 * Alamat halaman lain dengan SELURUH saringan yang berlaku tetap terbawa.
 *
 * Tanpa ini "Berikutnya" diam-diam melepas penyaring, dan halaman 2 berisi
 * pengguna yang tidak ada hubungannya dengan halaman 1.
 */
function tautanHalaman(p: {
  page: number;
  q?: string;
  perPage: number;
  roleId: string;
  plantId: string;
  aktif: string;
}) {
  const query = new URLSearchParams({ page: String(p.page) });
  if (p.q) query.set('q', p.q);
  if (p.perPage !== PER_HALAMAN[0]) query.set('perPage', String(p.perPage));
  if (p.roleId) query.set('roleId', p.roleId);
  if (p.plantId) query.set('plantId', p.plantId);
  if (p.aktif) query.set('aktif', p.aktif);
  return `/admin/users?${query.toString()}`;
}
