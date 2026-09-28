'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Plus, Pencil, Trash2, X, Users, ArrowRight } from 'lucide-react';
import {
  ROLE_KINDS,
  PROCESS_GROUPS,
  type RoleRow,
  type MenuRow,
} from '@avicenna/contracts';
import { simpanRoleAction, hapusRoleAction, type AksiState } from '@/app/(app)/admin/actions';
import { springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

const AWAL: AksiState = {};

const KETERANGAN_KIND: Record<string, string> = {
  SCANNING: 'Berdiri di lini, men-scan barang (lasman)',
  VIEW: 'Memeriksa data, tidak men-scan (JP, leader)',
  ADMIN: 'Mengelola master dan seluruh sistem',
};

/**
 * Role beserta menu yang boleh dilihat pemegangnya.
 *
 * Padanan `role_has_apps` di sistem lama, tetapi daftarnya bukan tabel bebas:
 * hanya menu yang halamannya memang ada yang muncul sebagai centang. Di sistem
 * lama rutenya diketik manusia, dan satu salah ketik mengantar setiap pemegang
 * role ke halaman yang tidak ada — tanpa satu pun pesan.
 */
export function RoleEditor({
  roles,
  katalog,
}: {
  roles: RoleRow[];
  katalog: MenuRow[];
}) {
  const [form, setForm] = useState<{ mode: 'buat' | 'sunting'; row?: RoleRow } | null>(null);

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[14px] text-ink-muted">{roles.length} role</p>
        <button
          type="button"
          onClick={() => setForm({ mode: 'buat' })}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" strokeWidth={2.2} aria-hidden /> Role baru
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {roles.map((r) => (
          <article
            key={r.id}
            className={cn(
              'rounded-card border border-line bg-card p-5',
              !r.isActive && 'opacity-60',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-[16px] font-bold tracking-tight">
                  {r.label ?? r.name}
                </h3>
                <p className="tabular mt-0.5 truncate text-[12px] text-ink-muted">{r.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setForm({ mode: 'sunting', row: r })}
                aria-label={`Ubah role ${r.label ?? r.name}`}
                className="shrink-0 rounded-full border border-line p-2 text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                <Pencil className="size-4" strokeWidth={1.8} aria-hidden />
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="rounded-full border border-line px-2.5 py-1 font-semibold">
                {r.kind}
              </span>
              {r.processGroup ? (
                <span className="rounded-full border border-line px-2.5 py-1 font-semibold">
                  {r.processGroup}
                </span>
              ) : null}
              {!r.isActive ? (
                <span className="rounded-full border border-ng/40 bg-ng/10 px-2.5 py-1 font-semibold text-ng">
                  nonaktif
                </span>
              ) : null}
            </div>

            <dl className="mt-4 space-y-1.5 text-[13px]">
              <div className="flex items-center gap-2 text-ink-soft">
                <Users className="size-4 shrink-0 text-ink-muted" strokeWidth={1.8} aria-hidden />
                <dt className="sr-only">Pemegang</dt>
                <dd>{r.userCount} pengguna</dd>
              </div>
              {/* Halaman awal diturunkan dari jabatan + lingkupnya, bukan
                  diketik — ditampilkan supaya yang mengatur tahu ke mana
                  pemegangnya akan dibawa sesudah login. */}
              <div className="flex items-center gap-2 text-ink-soft">
                <ArrowRight className="size-4 shrink-0 text-ink-muted" strokeWidth={1.8} aria-hidden />
                <dt className="sr-only">Halaman awal</dt>
                <dd className="tabular truncate">{r.landing}</dd>
              </div>
            </dl>

            <p className="mt-3 text-[13px] text-ink-muted">
              {r.kind === 'ADMIN' ? (
                <span className="font-medium text-ink-soft">
                  Seluruh menu — jabatan ADMIN tidak dibatasi daftar ini.
                </span>
              ) : r.menuKeys.length === 0 ? (
                <span className="font-medium text-warn">
                  Belum ada menu. Pemegangnya masuk ke halaman kosong.
                </span>
              ) : (
                `${r.menuKeys.length} menu`
              )}
            </p>
          </article>
        ))}
      </div>

      {form ? (
        <FormRole
          key={`${form.mode}-${form.row?.id ?? 'baru'}`}
          mode={form.mode}
          row={form.row}
          katalog={katalog}
          onClose={() => setForm(null)}
        />
      ) : null}
    </>
  );
}

const KELAS_INPUT =
  'mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-ink focus:bg-card';

function FormRole({
  mode,
  row,
  katalog,
  onClose,
}: {
  mode: 'buat' | 'sunting';
  row?: RoleRow;
  katalog: MenuRow[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(simpanRoleAction, AWAL);
  const [hapusState, hapusAction, hapusPending] = useActionState(hapusRoleAction, AWAL);
  const [kind, setKind] = useState(row?.kind ?? 'VIEW');
  const [konfirmasiHapus, setKonfirmasiHapus] = useState(false);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.ok) toast.ok(mode === 'buat' ? 'Role dibuat.' : 'Role tersimpan.');
    if (hapusState.ok) toast.ok('Role dihapus.');
    if (state.ok || hapusState.ok) {
      router.refresh();
      onClose();
    }
    // Galat umum jadi toast; galat per kolom tetap di bawah kolomnya.
    if (state.error && !state.fieldErrors) toast.galat(state.error, 'Role tidak tersimpan');
    if (hapusState.error) toast.galat(hapusState.error, 'Role tidak terhapus');
  }, [state, hapusState, router, onClose, toast, mode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const e = state.fieldErrors ?? {};
  // Menu adminOnly tidak pernah ditawarkan sebagai centang: memberikannya
  // begitu berarti hak admin bisa diberikan oleh siapa pun yang sudah punya
  // layar ini terbuka.
  const dapatDipilih = katalog.filter((m) => !m.adminOnly);
  const grup = [...new Set(dapatDipilih.map((m) => m.group))];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSoft}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'buat' ? 'Role baru' : `Ubah role ${row?.name}`}
        className="w-full max-w-2xl rounded-card border border-line bg-card p-6 shadow-shell"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="text-[18px] font-extrabold tracking-tight">
            {mode === 'buat' ? 'Role baru' : `Ubah ${row?.label ?? row?.name}`}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-full border border-line p-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </div>

        <form action={action} className="space-y-4">
          <input type="hidden" name="__id" value={row?.id ?? ''} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[13px] font-semibold">Nama teknis</span>
              <input
                name="name"
                defaultValue={row?.name ?? ''}
                required
                pattern="[a-z][a-z0-9_]*"
                autoComplete="off"
                placeholder="casting_lasman"
                className={cn(KELAS_INPUT, 'tabular')}
              />
              <span
                className={cn('mt-1 block text-[12px]', e.name ? 'text-ng' : 'text-ink-muted')}
              >
                {e.name ?? 'Huruf kecil, angka, dan garis bawah.'}
              </span>
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold">Nama tampilan</span>
              <input
                name="label"
                defaultValue={row?.label ?? ''}
                placeholder="Casting Lasman"
                className={KELAS_INPUT}
              />
              {e.label ? (
                <span className="mt-1 block text-[12px] text-ng">{e.label}</span>
              ) : null}
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[13px] font-semibold">Jabatan</span>
              <select
                name="kind"
                value={kind}
                onChange={(ev) => setKind(ev.target.value as typeof kind)}
                className={KELAS_INPUT}
              >
                {ROLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] text-ink-muted">
                {KETERANGAN_KIND[kind]}
              </span>
            </label>
            <label className="block">
              <span className="text-[13px] font-semibold">Lingkup proses</span>
              <select
                name="processGroup"
                defaultValue={row?.processGroup ?? ''}
                className={KELAS_INPUT}
              >
                <option value="">— seluruh proses —</option>
                {PROCESS_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[12px] text-ink-muted">
                Menentukan lini mana yang boleh discan dan saringan pemantauan.
              </span>
            </label>
          </div>

          <label className="flex items-center gap-2.5 text-[14px]">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={row ? row.isActive : true}
              className="size-4 accent-[color:var(--accent,#111)]"
            />
            Aktif
          </label>

          {/* ── Hak menu ────────────────────────────────────────────────── */}
          <fieldset className="rounded-card border border-line p-4">
            <legend className="px-1.5 text-[13px] font-semibold">Menu yang boleh dilihat</legend>

            {kind === 'ADMIN' ? (
              <p className="text-[13px] text-ink-muted">
                Jabatan ADMIN selalu melihat seluruh menu. Daftar ini tidak berlaku —
                membuatnya berlaku berarti satu kali salah simpan bisa menghilangkan layar
                pengaturan dari semua orang.
              </p>
            ) : (
              <div className="space-y-4">
                {grup.map((g) => (
                  <div key={g}>
                    <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                      {g}
                    </p>
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {dapatDipilih
                        .filter((m) => m.group === g)
                        .map((m) => (
                          <label
                            key={m.key}
                            className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 text-[14px] transition-colors hover:bg-surface"
                          >
                            <input
                              type="checkbox"
                              name="menuKeys"
                              value={m.key}
                              defaultChecked={row?.menuKeys.includes(m.key) ?? false}
                              className="mt-0.5 size-4 shrink-0 accent-[color:var(--accent,#111)]"
                            />
                            <span className="min-w-0">
                              <span className="block truncate">{m.label}</span>
                              <span className="tabular block truncate text-[12px] text-ink-muted">
                                {m.href}
                              </span>
                            </span>
                          </label>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>


          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div>
              {mode === 'sunting' && row ? (
                konfirmasiHapus ? (
                  <span className="flex items-center gap-2 text-[13px]">
                    <span className="text-ink-soft">Hapus permanen?</span>
                    <button
                      type="submit"
                      formAction={hapusAction}
                      disabled={hapusPending}
                      className="rounded-full border border-ng bg-ng/10 px-3 py-1.5 font-semibold text-ng"
                    >
                      {hapusPending ? 'Menghapus…' : 'Ya, hapus'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setKonfirmasiHapus(false)}
                      className="rounded-full border border-line px-3 py-1.5 font-semibold text-ink-soft"
                    >
                      Batal
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setKonfirmasiHapus(true)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-2 text-[13px] font-semibold text-ink-muted transition-colors hover:border-ng hover:text-ng"
                  >
                    <Trash2 className="size-4" strokeWidth={1.8} aria-hidden /> Hapus role
                  </button>
                )
              ) : null}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-line px-4 py-2 text-[14px] font-semibold text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-full bg-accent px-5 py-2 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {pending ? 'Menyimpan…' : 'Simpan'}
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
