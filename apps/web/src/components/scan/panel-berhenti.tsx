'use client';

import { useEffect, useState } from 'react';
import { OctagonPause, Play, Wrench, ClipboardCheck, AlertTriangle, Package } from 'lucide-react';
import { nadaPanel, nadaTombol } from '@avicenna/contracts';
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
 * Tombol berhenti produksi, sebagai kolom tetap di sisi kiri layar stasiun.
 *
 * ── Kenapa di sisi, bukan sebaris di atas kotak scan ────────────────────────
 *
 * Operator memandangi kotak scan dan panel hasil sepanjang shift. Tombol
 * berhenti yang ikut di aliran itu bergeser setiap kali isi layar berubah —
 * dan saat mesin benar-benar rusak, yang dicari orang harus berada di tempat
 * yang sama persis seperti sejam sebelumnya. Kolom tetap memberi itu, sekaligus
 * memberi tiap tombol tinggi penuh yang bisa ditekan tanpa melihat.
 *
 * ── Kenapa warnanya ditentukan "terencana", bukan kategori ──────────────────
 *
 * Dandori dan QC cek rutin adalah berhenti yang MEMANG dijadwalkan; mewarnainya
 * merah sama seperti mesin rusak membuat merah berhenti berarti apa-apa.
 * Yang merah hanya yang tidak direncanakan — dan itu pula yang nanti mengurangi
 * availability di laporan.
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

  /*
   * Saat berhenti, SELURUH kolom berubah merah.
   *
   * Di tata letak sebelumnya keadaan ini berupa spanduk melintang yang sulit
   * dilewatkan. Kolom selebar 250px tidak bisa menandingi itu dengan ukuran,
   * jadi yang dipakai adalah warna: satu bidang merah setinggi layar terlihat
   * dari seberang lini, dan jamnya yang berjalan ada di tengahnya.
   */
  if (berhenti) {
    const sejak = new Date(berhenti.startedAt);
    /*
     * Kartu ini memakai warna ALASAN YANG BARUSAN DITEKAN, bukan merah tetap.
     *
     * Operator menekan tombol kuning lalu seluruh kolom berubah merah adalah
     * jeda ragu yang tidak perlu: sejenak ia bertanya apakah yang tercatat
     * memang yang ia pilih. Warnanya sama, jadi hubungan tombol dan keadaan
     * terbaca tanpa dijelaskan.
     *
     * Alasan tanpa warna jatuh ke aturan lama — merah untuk yang tidak
     * direncanakan, netral untuk yang direncanakan. Dandori yang berwarna
     * merah menyala akan membuat berhenti terjadwal terlihat seperti kerusakan.
     */
    const nada = nadaPanel(berhenti.color);
    const netral = !nada && berhenti.isPlanned;
    const gaya = nada ? { backgroundColor: nada.bg, borderColor: nada.border } : undefined;
    const warnaIsi = nada ? { color: nada.teks } : undefined;

    return (
      <section
        aria-live="polite"
        style={gaya}
        className={cn(
          'flex h-full min-h-0 flex-col rounded-card border-2 p-5',
          nada ? '' : netral ? 'border-line bg-surface' : 'border-ng/45 bg-ng/10',
        )}
      >
        <OctagonPause
          style={warnaIsi}
          className={cn('size-9 shrink-0', nada ? '' : netral ? 'text-ink-soft' : 'text-ng')}
          strokeWidth={1.8}
          aria-hidden
        />
        <div className="mt-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          Produksi berhenti
        </div>
        <div
          style={warnaIsi}
          className={cn(
            'mt-1 text-[22px] font-extrabold leading-tight',
            nada ? '' : netral ? 'text-ink' : 'text-ng',
          )}
        >
          {berhenti.reasonName ?? berhenti.reasonCode ?? 'Berhenti'}
        </div>

        <div
          style={warnaIsi}
          className={cn(
            'tabular mt-5 text-[44px] font-extrabold leading-none',
            nada ? '' : netral ? 'text-ink' : 'text-ng',
          )}
        >
          {lamanya(sejak, sekarang)}
        </div>
        <div className="mt-2 text-[13px] leading-snug text-ink-soft">
          Sejak {sejak.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
          {berhenti.npk ? ` · ${berhenti.npk}` : ''}
        </div>

        {/* Tombol didorong ke dasar kolom: posisinya tetap, berapa pun panjang
            nama alasannya, jadi tangan hafal tempatnya. */}
        <button
          type="button"
          onClick={() => void selesai()}
          disabled={sibuk}
          className="mt-auto inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-ok text-[19px] font-bold text-white transition-[filter] duration-200 hover:brightness-110 disabled:opacity-60"
        >
          <Play className="size-5" strokeWidth={2.4} aria-hidden />
          Mulai
        </button>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col rounded-card border border-line bg-card p-5">
      <h2 className="text-[13px] font-bold uppercase tracking-wide">Berhenti karena</h2>
      <p className="mt-1.5 text-[12.5px] leading-snug text-ink-muted">
        Pilih alasan ketika proses produksi berhenti atau tidak ada scan.
      </p>

      {alasan.length === 0 ? (
        /*
         * Kekosongan ini disebut penyebabnya, bukan dibiarkan jadi kolom kosong.
         * Tanpa satu pun alasan, tombol berhenti tidak bisa ditekan sama sekali
         * — dan itu bukan hal yang boleh ditemukan operator sendiri saat mesin
         * sudah terlanjur mati.
         */
        <p className="mt-4 rounded-2xl border border-dashed border-line p-4 text-[12.5px] leading-snug text-ink-muted">
          Belum ada alasan berhenti untuk lini ini. Isi dulu di{' '}
          <span className="font-semibold">Master Data › Alasan Berhenti</span>, kalau tidak
          berhentinya tidak akan pernah tercatat.
        </p>
      ) : (
        /*
         * Daftarnya MENGGULIR, bukan memanjang keluar kolom.
         *
         * Alasan yang berlaku umum ditambah alasan khusus lini bisa berjumlah
         * enam atau lebih di satu lini. Tanpa ini, tombol terakhir terdorong
         * keluar layar dan kartu "Monitoring aktif" di dasar kolom ikut
         * hilang — dan tombol berhenti yang tidak terlihat sama saja dengan
         * tidak ada.
         */
        <div className="scroll-slim -mr-1 mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {alasan.map((a) => {
            const Ikon = IKON[a.category] ?? OctagonPause;
            /*
             * Warna pilihan orang MENANG atas warna bawaan.
             *
             * Yang kosong jatuh ke aturan lama — merah untuk yang tidak
             * direncanakan, netral untuk yang direncanakan. Baris yang dibuat
             * sebelum kolom warna ada tidak boleh berubah tampilannya hanya
             * karena kolomnya ditambahkan.
             */
            const nada = nadaTombol(a.color);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => void mulai(a)}
                disabled={sibuk}
                style={
                  nada
                    ? { backgroundColor: nada.bg, borderColor: nada.border, color: nada.teks }
                    : undefined
                }
                className={cn(
                  'inline-flex min-h-[72px] w-full shrink-0 items-center gap-3 rounded-2xl border px-4 text-left text-[15px] font-bold uppercase tracking-wide transition-colors duration-200 disabled:opacity-60',
                  nada
                    ? 'hover:brightness-95'
                    : a.isPlanned
                      ? 'border-line bg-card text-ink hover:border-line-strong hover:bg-surface'
                      : 'border-ng/25 bg-ng/8 text-ng hover:bg-ng/15',
                )}
              >
                <Ikon className="size-[22px] shrink-0" strokeWidth={2.1} aria-hidden />
                {/* Membungkus dua baris, tidak dipotong: "PART SUPPLY KOSONG"
                    yang terbaca "PART SUPPLY KOS…" membuat operator ragu
                    apakah ini tombol yang ia cari. */}
                <span className="line-clamp-2 min-w-0 flex-1 leading-tight">{a.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Didorong ke dasar: menegaskan lini sedang DIPANTAU, yaitu alasan kenapa
          memilih alasan yang benar itu penting — angkanya masuk laporan. */}
      <div className="shrink-0 pt-5">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            <span className="size-2 shrink-0 rounded-full bg-ok" aria-hidden />
            Monitoring aktif
          </p>
          <p className="mt-1 text-[12px] leading-snug text-ink-muted">
            Pilih alasan berhenti sesuai kondisi aktual line.
          </p>
        </div>
      </div>
    </section>
  );
}
