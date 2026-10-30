'use client';

import { useRef } from 'react';
import Form from 'next/form';
import Link from 'next/link';
import { Search, RotateCcw } from 'lucide-react';
import { PER_HALAMAN } from '@avicenna/contracts';

export interface PilihanFilter {
  value: string;
  label: string;
}

export interface FilterTampil {
  /** Nama parameter URL APA ADANYA, mis. `f_plantId` atau `roleId`. */
  name: string;
  label: string;
  pilihan: PilihanFilter[];
  /** Nilai yang sedang berlaku, '' bila tidak disaring. */
  nilai: string;
}

const kelasKendali =
  'h-10 rounded-full border border-line bg-card px-3 text-[14px] outline-none transition-colors duration-200 focus:border-line-strong';

/**
 * Satu baris kendali untuk menyaring, mencari, dan mengatur panjang halaman.
 *
 * Dipakai setiap tabel daftar, jadi nama parameternya diserahkan pemanggil
 * apa adanya: master memakai berawalan `f_` supaya nama kolom tidak bertabrakan
 * dengan parameter halaman, sedangkan daftar pengguna memakai nama yang sudah
 * lama dikenal endpoint-nya (`roleId`, `plantId`, `aktif`). Komponen ini tidak
 * perlu tahu bedanya.
 *
 * ── Kenapa SATU formulir, bukan beberapa ────────────────────────────────────
 *
 * Pencarian dan setiap penyaring berada di dalam formulir yang sama, jadi
 * mengubah salah satunya mengirim SEMUA nilai yang sedang berlaku. Dengan
 * formulir terpisah, memilih pabrik akan menghapus kata yang baru diketik —
 * dan itu tidak terlihat sebagai kesalahan, cuma terasa seperti layar yang
 * suka lupa.
 *
 * `page` sengaja TIDAK ikut. Mengubah penyaring berarti kembali ke halaman 1;
 * tetap di halaman 7 pada hasil yang baru hampir selalu berarti tabel kosong
 * tanpa sebab yang kelihatan.
 *
 * ── Kenapa `next/form`, bukan <form> biasa ──────────────────────────────────
 *
 * Nilainya tetap jadi bagian URL — bisa di-bookmark, dibagikan, dan dimuat
 * ulang tanpa state klien apa pun, sama seperti kotak pencarian sebelumnya.
 * Bedanya `next/form` berpindah di sisi klien, jadi tabel panjang tidak
 * berkedip putih setiap kali satu dropdown digeser.
 */
export function FilterBar({
  action,
  cariLabel,
  q,
  perPage,
  filters,
}: {
  /** Alamat tujuan formulir — halaman daftarnya sendiri. */
  action: string;
  cariLabel: string;
  q: string;
  perPage: number;
  filters: FilterTampil[];
}) {
  const form = useRef<HTMLFormElement>(null);
  const adaYangAktif = q.length > 0 || filters.some((f) => f.nilai !== '');

  /*
   * Kendali yang kosong dilepas namanya sesaat sebelum dikirim, supaya URL-nya
   * tidak menumpuk `f_plantId=&f_lineId=&f_isActive=` untuk penyaring yang
   * memang tidak dipakai. API sudah mengabaikan nilai kosong, jadi ini soal
   * alamat yang masih bisa dibaca orang — dan alamat itu yang dibagikan ke
   * rekan saat melaporkan data yang aneh.
   *
   * Namanya dipulihkan setelah satu tick: perpindahannya di sisi klien, jadi
   * formulir yang sama masih dipakai untuk kiriman berikutnya.
   */
  function lepasYangKosong(e: React.FormEvent<HTMLFormElement>) {
    const dilepas: Array<HTMLInputElement | HTMLSelectElement> = [];
    for (const el of Array.from(e.currentTarget.elements)) {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) continue;
      if (el.name && el.value === '') {
        dilepas.push(el);
        el.name = '';
      }
    }
    if (dilepas.length > 0) {
      setTimeout(() => {
        for (const el of dilepas) {
          if (el.dataset.nama) el.name = el.dataset.nama;
        }
      }, 0);
    }
  }

  return (
    <Form
      ref={form}
      action={action}
      onSubmit={lepasYangKosong}
      className="mb-4 flex flex-wrap items-end gap-2"
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          strokeWidth={1.8}
          aria-hidden
        />
        <input
          /* Uncontrolled agar mengetik tidak membutuhkan state klien. `key`
             membuatnya diinisialisasi ulang saat Reset/Back mengirim nilai
             baru dari server; defaultValue sendiri tidak memperbarui elemen
             yang sudah terpasang. */
          key={q}
          type="search"
          name="q"
          data-nama="q"
          defaultValue={q}
          placeholder={`Cari ${cariLabel}`}
          aria-label={`Cari ${cariLabel}`}
          className={`${kelasKendali} w-64 pl-9`}
        />
      </div>

      {filters.map((f) => (
        <label key={f.name} className="flex flex-col gap-1">
          <span className="px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            {f.label}
          </span>
          <select
            key={`${f.name}:${f.nilai}`}
            name={f.name}
            data-nama={f.name}
            defaultValue={f.nilai}
            onChange={() => form.current?.requestSubmit()}
            className={kelasKendali}
          >
            <option value="">Semua</option>
            {f.pilihan.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ))}

      <label className="flex flex-col gap-1">
        <span className="px-1 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Per halaman
        </span>
        <select
          key={perPage}
          name="perPage"
          data-nama="perPage"
          defaultValue={String(perPage)}
          onChange={() => form.current?.requestSubmit()}
          className={kelasKendali}
        >
          {PER_HALAMAN.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      {/* Tetap ada meski dropdown sudah mengirim sendiri saat diubah: kotak
          pencarian dikirim dengan Enter, dan tombol inilah yang membuat itu
          terlihat — juga satu-satunya jalan bila JavaScript gagal dimuat. */}
      <button
        type="submit"
        className="h-10 rounded-full border border-line bg-card px-4 text-[14px] font-semibold transition-colors duration-200 hover:border-line-strong hover:bg-surface"
      >
        Terapkan
      </button>

      {adaYangAktif ? (
        <Link
          href={action}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[14px] font-semibold text-ink-muted transition-colors duration-200 hover:text-ink"
        >
          <RotateCcw className="size-4" strokeWidth={2} aria-hidden />
          Reset
        </Link>
      ) : null}
    </Form>
  );
}
