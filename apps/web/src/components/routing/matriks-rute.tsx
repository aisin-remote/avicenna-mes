'use client';

import { useState, useMemo } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { simpanRuteAction } from '@/app/(app)/master/part-processes/actions';
import { PROCESS_LABELS } from '@avicenna/contracts';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

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
  /** Masalah pada rute ini, kosong bila wajar. */
  masalah: string[];
}

/*
 * Label diambil dari @avicenna/contracts, tidak disalin lagi di sini.
 * Salinan daftar proses sudah dua kali menyimpang dari aslinya.
 */
const LABEL = PROCESS_LABELS as Record<string, string>;

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
  finishGood,
  baris,
  liniPerProses,
  sapAktif,
  prosesTerdaftar,
  prosesTakTerdaftar,
}: {
  proses: string[];
  /** Proses yang lininya menghasilkan finish good — ditandai di kepala kolom. */
  finishGood: string[];
  baris: BarisMatriks[];
  liniPerProses: Record<string, string[]>;
  /** plantId -> processType -> push SAP aktif. Baca-saja, dari TM_ROUTE_PROCESS. */
  sapAktif: Record<number, Record<string, boolean>>;
  /** plantId -> proses yang terdaftar di master Rute Proses (Integrasi). */
  prosesTerdaftar: Record<number, string[]>;
  /** plantId -> proses yang masih dipakai tetapi sudah tidak ada di master. */
  prosesTakTerdaftar: Record<number, Array<{ processType: string; lini: number; rute: number }>>;
}) {
  const [data, setData] = useState(baris);
  const [sibuk, setSibuk] = useState<number | null>(null);
  const [baruSimpan, setBaruSimpan] = useState<number | null>(null);
  const [saringan, setSaringan] = useState('');
  const toast = useToast();

  /*
   * Kolom mengikuti master Rute Proses (Integrasi), bukan daftar tetap.
   *
   * Yang tampil: proses yang terdaftar di master pabrik mana pun yang ada di
   * layar, DITAMBAH proses yang sudah tidak terdaftar tetapi masih dipakai
   * lini atau rute. Yang kedua diberi tanda — menyembunyikannya membuat rute
   * part terlihat lebih pendek dari kenyataan, dan scan di lini itu tetap
   * diminta oleh server.
   */
  const pabrikTampil = useMemo(() => [...new Set(data.map((b) => b.plantId))], [data]);
  const takTerdaftarDiKolom = useMemo(() => {
    const peta: Record<string, { lini: number; rute: number }> = {};
    for (const pid of pabrikTampil) {
      for (const x of prosesTakTerdaftar[pid] ?? []) {
        const ada = peta[x.processType] ?? { lini: 0, rute: 0 };
        peta[x.processType] = { lini: ada.lini + x.lini, rute: ada.rute + x.rute };
      }
    }
    return peta;
  }, [pabrikTampil, prosesTakTerdaftar]);
  const kolom = useMemo(
    () =>
      proses.filter(
        (p) =>
          pabrikTampil.some((pid) => prosesTerdaftar[pid]?.includes(p)) || p in takTerdaftarDiKolom,
      ),
    [proses, pabrikTampil, prosesTerdaftar, takTerdaftarDiKolom],
  );

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
          ? {
              ...x,
              rute: Object.fromEntries(sesudah.map((s, i) => [s, (i + 1) * 10])),
              // Server yang memutuskan wajar atau tidak; di layar dikosongkan
              // dulu supaya peringatan lama tidak tertinggal saat menunggu.
              masalah: [],
            }
          : x,
      ),
    );
    setSibuk(b.partId);

    const hasil = await simpanRuteAction(b.partId, sesudah);
    setSibuk(null);

    if ('error' in hasil) {
      setData(sebelumnya);
      /*
       * Toast, bukan banner di atas tabel. Matriks ini 18 baris ke bawah dan
       * 10 kolom ke samping; yang diklik di baris terakhir tidak akan pernah
       * melihat banner di atasnya — ia hanya melihat selnya kembali seperti
       * semula tanpa tahu sebabnya.
       */
      toast.galat(hasil.error, `${b.partNumber} — rute tidak tersimpan`);
      return;
    }

    /*
     * Rute tersimpan, tetapi belum tentu wajar.
     *
     * Rute setengah jadi adalah keadaan biasa saat menyusun: FG dulu, Delivery
     * menyusul. Peringatannya ditempelkan ke barisnya supaya tetap terlihat
     * sesudah toast hilang — itulah tanda bahwa rutenya belum selesai, bukan
     * bahwa kliknya gagal.
     */
    if (hasil.masalah.length > 0) {
      setData((d) =>
        d.map((x) => (x.partId === b.partId ? { ...x, masalah: hasil.masalah } : x)),
      );
      toast.warn(hasil.masalah.join('; '), `${b.partNumber} — rute belum lengkap`);
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


      {/* Tabel lebar: digulir di wadahnya sendiri, bukan menggeser seluruh halaman. */}
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-line">
              <Th sticky>Part</Th>
              <Th>Proyek</Th>
              <Th>Plant</Th>
              {kolom.map((p) => (
                <th
                  key={p}
                  className={cn(
                    'border-l border-line px-2 py-2 text-center align-bottom font-semibold whitespace-nowrap',
                    p in takTerdaftarDiKolom && 'bg-warn/10',
                  )}
                >
                  <span className="block">{LABEL[p] ?? p}</span>
                  {p in takTerdaftarDiKolom ? (
                    <span
                      className="mt-0.5 block text-[11px] font-semibold text-warn"
                      title={`Tidak ada di Integrasi › Rute Proses, tetapi masih dipakai ${takTerdaftarDiKolom[p]!.rute} rute dan ${takTerdaftarDiKolom[p]!.lini} lini. Daftarkan lagi, atau cabut dari rute dan lininya.`}
                    >
                      tidak di master
                    </span>
                  ) : null}
                  {/* Lini FG ditandai: di situlah kanban mulai ditempel, dan
                      cara scan-nya berbeda dari lini WIP. */}
                  {finishGood.includes(p) ? (
                    <span className="mt-0.5 block text-[11px] font-semibold text-ok">
                      finish good
                    </span>
                  ) : null}
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

                  {kolom.map((p) => {
                    const aktif = p in b.rute;
                    const posisi = urut.indexOf(p) + 1;
                    /*
                     * Boleh ditambahkan hanya bila terdaftar di master pabrik
                     * part ini. Yang sudah ada di rute tetap bisa dicabut — walau
                     * masternya sudah dihapus. Server memeriksa hal yang sama.
                     */
                    const terdaftarDiPabrik = prosesTerdaftar[b.plantId]?.includes(p) ?? false;
                    const bolehDiubah = aktif || terdaftarDiPabrik;
                    return (
                      <td key={p} className="border-l border-line px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => ubah(b, p)}
                          disabled={sibuk === b.partId || !bolehDiubah}
                          title={
                            bolehDiubah
                              ? undefined
                              : `${LABEL[p] ?? p} tidak terdaftar untuk pabrik ${b.plantCode ?? ''} — daftarkan di Integrasi › Rute Proses`
                          }
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
                        {/* Penanda BACA-SAJA, per PROSES per pabrik — bukan per
                            part. Pengaturannya ada di Integrasi > Rute Proses.
                            Ditampilkan di sel yang aktif supaya leader tahu
                            langkah ini akan sampai ke SAP tanpa membuka menu lain. */}
                        {aktif && sapAktif[b.plantId]?.[p] ? (
                          <span
                            title="Push ke SAP aktif untuk proses ini — atur di Integrasi › Rute Proses"
                            className="mx-auto mt-1 block w-fit rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ok"
                          >
                            SAP
                          </span>
                        ) : null}
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
                    ) : b.masalah.length > 0 ? (
                      <span className="text-ng">{b.masalah.join('; ')}</span>
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
        Angka di dalam sel menunjukkan proses ke berapa, bukan sekadar dilalui atau tidak. Urutannya
        mengikuti urutan kolom, jadi menyalakan proses mana pun tidak akan mengacak urutan yang
        sudah ada.
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
