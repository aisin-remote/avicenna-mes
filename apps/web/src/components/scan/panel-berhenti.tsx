'use client';

import { useEffect, useState } from 'react';
import { OctagonPause, Play, Wrench, ClipboardCheck, AlertTriangle, Package } from 'lucide-react';
import type { AlasanBerhenti, BerhentiLini } from '@avicenna/contracts';
import { mulaiBerhentiAction, selesaiBerhentiAction } from '@/app/(app)/scan/actions';
import { useToast } from '../ui/toast';
import { cn } from '../ui/cn';

/** Ikon per kategori — supaya tombol dikenali dari bentuknya, bukan dibaca. */
const IKON: Record<string, typeof Wrench> = {
  PROBLEM: AlertTriangle,
  SETUP: Wrench,
  QC: ClipboardCheck,
  CHANGEOVER: Wrench,
  MATERIAL: Package,
  LAINNYA: OctagonPause,
};

/** Selisih waktu sebagai jam:menit:detik — dibaca dari jauh, bukan "3 menit lalu". */
function lamanya(sejak: Date, sekarang: Date): string {
  const detik = Math.max(0, Math.floor((sekarang.getTime() - sejak.getTime()) / 1000));
  const dua = (n: number) => String(n).padStart(2, '0');
  const j = Math.floor(detik / 3600);
  const m = Math.floor((detik % 3600) / 60);
  const d = detik % 60;
  return j > 0 ? `${j}:${dua(m)}:${dua(d)}` : `${dua(m)}:${dua(d)}`;
}

/**
 * Tombol berhenti produksi di layar stasiun.
 *
 * Mengikuti layar prdreport yang sudah dipakai di BODY: satu tombol per alasan
 * (Problem, Setup, QC Cek), dan saat lini berhenti seluruh panel berubah
 * menjadi satu tombol besar "Mulai" beserta lama berhentinya.
 *
 * ── Kenapa lamanya berjalan di layar ────────────────────────────────────────
 *
 * Angka yang terus berjalan membuat orang menutup berhenti begitu lini jalan
 * lagi. Tanpa itu, baris berhenti sering tertinggal terbuka sampai pergantian
 * shift, dan laporan loss time menjadi tidak berguna justru pada hari yang
 * paling bermasalah.
 */
export function PanelBerhenti({
  lineCode,
  alasan,
  berhenti,
  onBerubah,
}: {
  lineCode: string;
  alasan: AlasanBerhenti[];
  berhenti: BerhentiLini | null;
  onBerubah: (b: BerhentiLini | null) => void;
}) {
  const [sibuk, setSibuk] = useState(false);
  const [sekarang, setSekarang] = useState(() => new Date());
  const toast = useToast();

  // Jam berjalan hanya saat memang sedang berhenti; tidak ada gunanya
  // menyalakan timer di lini yang sedang berproduksi.
  useEffect(() => {
    if (!berhenti) return;
    const t = setInterval(() => setSekarang(new Date()), 1000);
    return () => clearInterval(t);
  }, [berhenti]);

  async function mulai(a: AlasanBerhenti) {
    setSibuk(true);
    const hasil = await mulaiBerhentiAction({ lineCode, reasonId: a.id });
    setSibuk(false);
    if ('error' in hasil) {
      toast.galat(hasil.error, 'Berhenti tidak tercatat');
      return;
    }
    setSekarang(new Date());
    onBerubah(hasil);
  }

  async function selesai() {
    setSibuk(true);
    const hasil = await selesaiBerhentiAction(lineCode);
    setSibuk(false);
    if ('error' in hasil) {
      toast.galat(hasil.error, 'Gagal mengakhiri berhenti');
      return;
    }
    onBerubah(null);
  }

  if (berhenti) {
    const sejak = new Date(berhenti.startedAt);
    return (
      <section
        aria-live="polite"
        className="flex flex-wrap items-center gap-4 rounded-card border-2 border-ng/40 bg-ng/8 p-5"
      >
        <OctagonPause className="size-10 shrink-0 text-ng" strokeWidth={1.8} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
            Produksi berhenti
          </div>
          <div className="truncate text-[20px] font-extrabold text-ng">
            {berhenti.reasonName ?? berhenti.reasonCode ?? 'Berhenti'}
          </div>
          <div className="text-[13px] text-ink-soft">
            Sejak{' '}
            {sejak.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            {berhenti.npk ? ` · ${berhenti.npk}` : ''}
          </div>
        </div>
        <div className="tabular text-[40px] font-extrabold leading-none text-ng">
          {lamanya(sejak, sekarang)}
        </div>
        <button
          type="button"
          onClick={() => void selesai()}
          disabled={sibuk}
          className="inline-flex h-14 items-center gap-2 rounded-full bg-ok px-8 text-[18px] font-bold text-white transition-colors hover:brightness-110 disabled:opacity-60"
        >
          <Play className="size-5" strokeWidth={2.4} aria-hidden />
          Mulai
        </button>
      </section>
    );
  }

  if (alasan.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-line p-4 text-[13px] text-ink-muted">
        Belum ada alasan berhenti untuk lini ini. Isi di Master Data › Alasan Berhenti.
      </p>
    );
  }

  return (
    <section className="flex flex-wrap items-center gap-3">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        Berhenti karena
      </span>
      {alasan.map((a) => {
        const Ikon = IKON[a.category] ?? OctagonPause;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => void mulai(a)}
            disabled={sibuk}
            className={cn(
              'inline-flex h-12 items-center gap-2 rounded-full border-2 px-5 text-[15px] font-bold transition-colors disabled:opacity-60',
              a.isPlanned
                ? 'border-line text-ink-soft hover:border-ink hover:text-ink'
                : 'border-ng/40 bg-ng/8 text-ng hover:bg-ng/15',
            )}
          >
            <Ikon className="size-[18px]" strokeWidth={2.2} aria-hidden />
            {a.name}
          </button>
        );
      })}
    </section>
  );
}
