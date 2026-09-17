'use client';

import { useState, useMemo } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { simpanRuteAction } from '@/app/(app)/master/part-processes/actions';
import { cn } from '../ui/cn';

export interface BarisMatriks {
  partId: number;
  partNumber: string;
  backNumber: string | null;
  name: string;
  project: string | null;
  plantId: number;
  plantCode: string | null;
  /** processType -> urutan. Tidak ada kunci = tidak melewati proses itu. */
  rute: Record<string, number>;
}

const LABEL: Record<string, string> = {
  MELTING: 'Melting',
  CASTING: 'Casting',
  MACHINING: 'Machining',
  ASSEMBLING_UNIT: 'Assembling (Unit)',
  INJECTION: 'Injection',
  PAINTING: 'Painting',
  ASSEMBLING_BODY: 'Assembling (Body)',
  DELIVERY: 'Delivery',
};

/**
 * Matriks part × proses — bentuk yang sama dengan tabel rute di lapangan.
 *
 * ── Kenapa matriks, bukan formulir per baris ────────────────────────────────
 *
 * Rute dibaca orang sebagai tabel: satu baris part, satu kolom per proses, isi
 * ya/tidak. Formulir baris-per-baris memaksa empat puluhan kali simpan untuk
 * sebelas part, dan yang lebih buruk — tidak memperlihatkan pola. Perbedaan
 * antara dua part yang mestinya sama baru terlihat kalau keduanya sebaris.
 *
 * ── Kenapa urutan tidak diketik ─────────────────────────────────────────────
 *
 * Nomor urut dibangkitkan server dari urutan kolom, bukan diketik orang.
 * Mengetik nomor membuka kemungkinan dua langkah bernomor sama, dan nomor itu
 * sendiri tidak bermakna bagi siapa pun — yang bermakna adalah proses apa
 * mendahului proses apa.
 */
export function MatriksRute({
  proses,
  baris,
  liniPerProses,
}: {
  proses: string[];
  baris: BarisMatriks[];
  liniPerProses: Record<string, string[]>;
}) {
  const [data, setData] = useState(baris);
  const [sibuk, setSibuk] = useState<number | null>(null);
  const [galat, setGalat] = useState<{ partId: number; pesan: string } | null>(null);
  const [baruSimpan, setBaruSimpan] = useState<number | null>(null);
  const [saringan, setSaringan] = useState('');

  const terlihat = useMemo(() => {
    const q = saringan.trim().toLowerCase();
    if (!q) return data;
    return data.filter((b) =>
      [b.partNumber, b.backNumber, b.name, b.project, b.plantCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, saringan]);

  async function ubah(b: BarisMatriks, p: string) {
    const aktif = p in b.rute;
    /*
     * Urutan baru mengikuti urutan KOLOM, bukan urutan klik.
     *
     * Kolom sudah tersusun sesuai jalannya barang, jadi menyalakan Painting
     * setelah Assembling tetap menghasilkan Painting lebih dulu — persis yang
     * orang harapkan saat melihat tabelnya.
     */
    const sesudah = proses.filter((x) => (x === p ? !aktif : x in b.rute));

    const sebelumnya = data;
    // Diperbarui di layar lebih dulu supaya klik terasa langsung; dikembalikan
    // bila server menolak.
    setData((d) =>
      d.map((x) =>
        x.partId === b.partId
          ? { ...x, rute: Object.fromEntries(sesudah.map((s, i) => [s, (i + 1) * 10])) }
          : x,
      ),
    );
    setSibuk(b.partId);
    setGalat(null);

    const hasil = await simpanRuteAction(b.partId, sesudah);
    setSibuk(null);

    if ('error' in hasil) {
      setData(sebelumnya);
      setGalat({ partId: b.partId, pesan: hasil.error });
      return;
    }
    setBaruSimpan(b.partId);
    setTimeout(() => setBaruSimpan((v) => (v === b.partId ? null : v)), 1200);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          id="saring-rute"
          value={saringan}
          onChange={(e) => setSaringan(e.target.value)}
          placeholder="Cari part, back number, proyek…"
          className="w-full max-w-xs rounded-md border border-line bg-card px-3 py-2 text-[14px] outline-none focus-visible:border-ink"
        />
        <span className="text-[13px] text-ink-muted">
          {terlihat.length} dari {data.length} part
        </span>
      </div>

      {galat ? (
        <p className="flex items-start gap-2 rounded-card border border-ng/40 bg-ng/10 px-4 py-3 text-[14px] text-ng">
          <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>{galat.pesan}</span>
        </p>
      ) : null}

      {/* Tabel lebar: digulir di wadahnya sendiri, bukan menggeser seluruh halaman. */}
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th sticky>Part</Th>
              <Th>Proyek</Th>
              <Th>Plant</Th>
              {proses.map((p) => (
                <th
                  key={p}
                  className="border-l border-line px-2 py-2 text-center align-bottom font-semibold whitespace-nowrap"
                >
                  <span className="block">{LABEL[p] ?? p}</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-ink-muted">
                    {liniPerProses[p]?.join(', ') ?? 'belum ada line'}
                  </span>
                </th>
              ))}
              <Th>Rute</Th>
            </tr>
          </thead>
          <tbody>
            {terlihat.map((b) => {
              const urut = proses.filter((p) => p in b.rute);
              return (
                <tr key={b.partId} className="border-b border-line last:border-0">
                  <td className="bg-card px-3 py-2 align-top whitespace-nowrap sm:sticky sm:left-0">
                    <span className="font-semibold">{b.partNumber}</span>
                    {b.backNumber ? (
                      <span className="ml-2 text-ink-muted">{b.backNumber}</span>
                    ) : null}
                    <span className="block text-[12px] text-ink-muted">{b.name}</span>
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">{b.project ?? '—'}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">{b.plantCode ?? '—'}</td>

                  {proses.map((p) => {
                    const aktif = p in b.rute;
                    const posisi = urut.indexOf(p) + 1;
                    return (
                      <td key={p} className="border-l border-line px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => ubah(b, p)}
                          disabled={sibuk === b.partId}
                          aria-pressed={aktif}
                          aria-label={`${LABEL[p] ?? p} untuk ${b.partNumber}`}
                          className={cn(
                            'tabular inline-flex h-8 w-11 items-center justify-center rounded-md border text-[12px] font-bold transition-colors',
                            'focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none',
                            aktif
                              ? 'border-ok/50 bg-ok/15 text-ok'
                              : 'border-line text-ink-muted hover:border-ink hover:text-ink',
                            sibuk === b.partId && 'opacity-50',
                          )}
                        >
                          {/* Angka urut, bukan sekadar centang: yang perlu dibaca
                              sekilas bukan "ya/tidak" tetapi proses ke berapa. */}
                          {aktif ? posisi : '–'}
                        </button>
                      </td>
                    );
                  })}

                  <td className="px-3 py-2 align-top text-[12px] whitespace-nowrap">
                    {sibuk === b.partId ? (
                      <Loader2 className="size-4 animate-spin text-ink-muted" aria-hidden />
                    ) : baruSimpan === b.partId ? (
                      <span className="inline-flex items-center gap-1 text-ok">
                        <Check className="size-4" strokeWidth={2.5} aria-hidden /> tersimpan
                      </span>
                    ) : urut.length === 0 ? (
                      <span className="text-warn">belum ada rute</span>
                    ) : (
                      <span className="text-ink-muted">
                        {urut.map((p) => LABEL[p] ?? p).join(' → ')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[13px] text-ink-muted">
        Angka di dalam sel menunjukkan proses ke berapa, bukan sekadar dilalui atau tidak.
        Urutannya mengikuti urutan kolom, jadi menyalakan proses mana pun tidak akan mengacak
        urutan yang sudah ada.
      </p>
    </div>
  );
}

function Th({ children, sticky }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <th
      className={cn(
        'px-3 py-2 text-left align-bottom font-semibold whitespace-nowrap',
        sticky && 'bg-card sm:sticky sm:left-0',
      )}
    >
      {children}
    </th>
  );
}
