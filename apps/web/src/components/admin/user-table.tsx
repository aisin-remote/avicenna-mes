'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'motion/react';
import { Plus, Pencil, KeyRound, Check, X, ShieldAlert } from 'lucide-react';
import type { UserRow, RoleRow } from '@avicenna/contracts';
import {
  simpanPenggunaAction,
  gantiSandiAction,
  aktifkanPenggunaAction,
  type AksiState,
} from '@/app/(app)/admin/actions';
import { springSoft } from '../motion/transitions';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

interface PilihanPabrik {
  id: number;
  code: string;
  name: string;
}

const AWAL: AksiState = {};

/**
 * Daftar pengguna beserta penyuntingannya.
 *
 * ── Kata sandi punya jalurnya sendiri ───────────────────────────────────────
 *
 * Formulir sunting TIDAK memuat kolom sandi. Kalau ada, setiap penyimpanan
 * biasa berpeluang menulis ulang sandi orang — dan yang paling sering terjadi
 * adalah mengosongkannya tanpa sengaja, membuat orangnya tidak bisa masuk lagi
 * tanpa satu pun pesan yang menjelaskan sebabnya.
 */
export function UserTable({
  rows,
  roles,
  plants,
  meAku,
}: {
  rows: UserRow[];
  roles: RoleRow[];
  plants: PilihanPabrik[];
  /** Id pengguna yang sedang masuk — dipakai menandai baris "Anda". */
  meAku: number | null;
}) {
  const [form, setForm] = useState<{ mode: 'buat' | 'sunting'; row?: UserRow } | null>(null);
  const [sandiUntuk, setSandiUntuk] = useState<UserRow | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  function ubahAktif(row: UserRow, aktif: boolean) {
    startTransition(async () => {
      const hasil = await aktifkanPenggunaAction(row.id, aktif);
      if (hasil.error) {
        toast.galat(hasil.error, 'Status tidak berubah');
        return;
      }
      toast.ok(`${row.name} ${aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
      router.refresh();
    });
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[14px] text-ink-muted">
          {rows.length} pengguna ditampilkan
        </p>
        <button
          type="button"
          onClick={() => setForm({ mode: 'buat' })}
          className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" strokeWidth={2.2} aria-hidden /> Pengguna baru
        </button>
      </div>


      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full min-w-[720px] text-[14px]">
          <thead className="border-b border-line text-left text-[12px] uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">NPK</th>
              <th className="px-4 py-3 font-semibold">Nama</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">Pabrik</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-ink-muted">
                  Tidak ada pengguna yang cocok.
                </td>
              </tr>
            ) : (
              rows.map((u) => (
                <tr key={u.id} className={cn(!u.isActive && 'opacity-55')}>
                  <td className="tabular px-4 py-3 font-semibold">
                    {u.npk}
                    {u.id === meAku ? (
                      <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-muted">
                        Anda
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {u.name}
                    {u.email ? (
                      <span className="block text-[12px] text-ink-muted">{u.email}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {u.roleLabel ?? u.roleName ?? (
                      <span className="text-ng">tanpa role</span>
                    )}
                    {u.roleKind ? (
                      <span className="block text-[12px] text-ink-muted">{u.roleKind}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{u.plantCode ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => ubahAktif(u, !u.isActive)}
                        disabled={pending}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold transition-colors',
                          u.isActive
                            ? 'border-ok/40 bg-ok/10 text-ok'
                            : 'border-line text-ink-muted hover:border-ink',
                        )}
                      >
                        {u.isActive ? (
                          <Check className="size-3.5" strokeWidth={2.4} aria-hidden />
                        ) : (
                          <X className="size-3.5" strokeWidth={2.4} aria-hidden />
                        )}
                        {u.isActive ? 'Aktif' : 'Nonaktif'}
                      </button>
                      {/* Akun tanpa sandi terlihat persis sama dengan akun
                          normal di daftar, padahal sama sekali tidak bisa
                          dipakai masuk. */}
                      {u.tanpaSandi ? (
                        <span
                          title="Akun ini belum punya kata sandi dan tidak bisa dipakai masuk"
                          className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[12px] font-semibold text-warn"
                        >
                          <ShieldAlert className="size-3.5" strokeWidth={2.2} aria-hidden />
                          tanpa sandi
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => setForm({ mode: 'sunting', row: u })}
                        aria-label={`Ubah ${u.name}`}
                        className="rounded-full border border-line p-2 text-ink-muted transition-colors hover:border-ink hover:text-ink"
                      >
                        <Pencil className="size-4" strokeWidth={1.8} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => setSandiUntuk(u)}
                        aria-label={`Ganti kata sandi ${u.name}`}
                        className="rounded-full border border-line p-2 text-ink-muted transition-colors hover:border-ink hover:text-ink"
                      >
                        <KeyRound className="size-4" strokeWidth={1.8} aria-hidden />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {form ? (
        <FormPengguna
          key={`${form.mode}-${form.row?.id ?? 'baru'}`}
          mode={form.mode}
          row={form.row}
          roles={roles}
          plants={plants}
          onClose={() => setForm(null)}
        />
      ) : null}

      {sandiUntuk ? (
        <FormSandi
          key={`sandi-${sandiUntuk.id}`}
          user={sandiUntuk}
          onClose={() => setSandiUntuk(null)}
        />
      ) : null}
    </>
  );
}

/* ── Panel ────────────────────────────────────────────────────────────────── */

function Panel({
  judul,
  keterangan,
  onClose,
  children,
}: {
  judul: string;
  keterangan?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  // Esc menutup — kebiasaan yang berlaku untuk semua lapisan menutup.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={springSoft}
        role="dialog"
        aria-modal="true"
        aria-label={judul}
        className="w-full max-w-lg rounded-card border border-line bg-card p-6 shadow-shell"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-extrabold tracking-tight">{judul}</h2>
            {keterangan ? (
              <p className="mt-1 text-[13px] text-ink-muted">{keterangan}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="rounded-full border border-line p-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            <X className="size-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

function Baris({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[12px] font-medium text-ng">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-ink-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const KELAS_INPUT =
  'mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-ink focus:bg-card';

function FormPengguna({
  mode,
  row,
  roles,
  plants,
  onClose,
}: {
  mode: 'buat' | 'sunting';
  row?: UserRow;
  roles: RoleRow[];
  plants: PilihanPabrik[];
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(simpanPenggunaAction, AWAL);
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (state.ok) {
      toast.ok(mode === 'buat' ? 'Pengguna dibuat.' : 'Pengguna tersimpan.');
      router.refresh();
      onClose();
    }
    // Galat per kolom tetap di bawah kolomnya; hanya galat umum yang jadi toast.
    if (state.error && !state.fieldErrors) toast.galat(state.error, 'Tidak tersimpan');
    // Bergantung pada objek state: Simpan kedua dengan galat sama harus tetap memberi tahu.
  }, [state, router, onClose, toast, mode]);

  const e = state.fieldErrors ?? {};

  return (
    <Panel
      judul={mode === 'buat' ? 'Pengguna baru' : `Ubah ${row?.name}`}
      keterangan={
        mode === 'sunting'
          ? 'Kata sandi diganti lewat tombol kunci di daftar, bukan di sini.'
          : undefined
      }
      onClose={onClose}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="__id" value={row?.id ?? ''} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Baris label="NPK" error={e.npk} hint="Dipakai untuk masuk dan menandai setiap scan.">
            <input
              name="npk"
              defaultValue={row?.npk ?? ''}
              required
              autoComplete="off"
              className={cn(KELAS_INPUT, 'tabular')}
            />
          </Baris>
          <Baris label="Nama" error={e.name}>
            <input name="name" defaultValue={row?.name ?? ''} required className={KELAS_INPUT} />
          </Baris>
        </div>

        <Baris label="Email" error={e.email} hint="Boleh dikosongkan.">
          <input
            name="email"
            type="email"
            defaultValue={row?.email ?? ''}
            autoComplete="off"
            className={KELAS_INPUT}
          />
        </Baris>

        {mode === 'buat' ? (
          <Baris
            label="Kata sandi"
            error={e.password}
            hint="Minimal 6 karakter. Kartu QR login berisi NPK|sandi."
          >
            <input
              name="password"
              type="password"
              required
              minLength={6}
              autoComplete="new-password"
              className={KELAS_INPUT}
            />
          </Baris>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Baris
            label="Role"
            error={e.roleId}
            hint="Menentukan halaman awal, menu, dan lini yang boleh discan."
          >
            <select name="roleId" defaultValue={row?.roleId ?? ''} required className={KELAS_INPUT}>
              <option value="">— pilih role —</option>
              {roles
                .filter((r) => r.isActive || r.id === row?.roleId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label ?? r.name} ({r.kind}
                    {r.processGroup ? ` · ${r.processGroup}` : ''})
                    {r.isActive ? '' : ' — nonaktif'}
                  </option>
                ))}
            </select>
          </Baris>
          <Baris label="Pabrik" error={e.plantId}>
            <select name="plantId" defaultValue={row?.plantId ?? ''} className={KELAS_INPUT}>
              <option value="">— tanpa pabrik —</option>
              {plants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </Baris>
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


        <div className="flex justify-end gap-2 pt-1">
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
      </form>
    </Panel>
  );
}

function FormSandi({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [state, action, pending] = useActionState(gantiSandiAction, AWAL);
  const toast = useToast();

  useEffect(() => {
    if (state.ok) {
      toast.ok(`Kata sandi ${user.name} diganti.`);
      onClose();
    }
    if (state.error && !state.fieldErrors) toast.galat(state.error, 'Sandi tidak diganti');
  }, [state, onClose, toast, user.name]);

  return (
    <Panel
      judul={`Kata sandi — ${user.name}`}
      keterangan="Sandi lama tidak diminta. Ini tindakan administrator, dan justru dipakai ketika sandinya sudah tidak diketahui siapa pun."
      onClose={onClose}
    >
      <form action={action} className="space-y-4">
        <input type="hidden" name="__id" value={user.id} />
        <Baris label="Kata sandi baru" hint="Minimal 6 karakter.">
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className={KELAS_INPUT}
          />
        </Baris>
        <Baris label="Ulangi" error={state.fieldErrors?.ulangi}>
          <input
            name="ulangi"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            className={KELAS_INPUT}
          />
        </Baris>


        <div className="flex justify-end gap-2 pt-1">
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
            {pending ? 'Menyimpan…' : 'Ganti sandi'}
          </button>
        </div>
      </form>
    </Panel>
  );
}
