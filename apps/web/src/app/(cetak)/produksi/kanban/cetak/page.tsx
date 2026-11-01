import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  cetakKanbanSchema,
  KARTU_LEBAR_MM,
  KARTU_PER_LEMBAR,
  KARTU_TINGGI_MM,
  type KartuKanbanCetak,
} from '@avicenna/contracts';
import { daftarKartuCetak } from '@/lib/kanban-cetak-api';
import { TombolCetak } from '@/components/cetak/tombol-cetak';

export const dynamic = 'force-dynamic';

type KartuSiap = KartuKanbanCetak & { svg: string };

/**
 * Lembar kartu kanban — A4 tegak, empat LAJUR mendatar per lembar.
 *
 * Kartunya 210 × 74,2 mm: selebar A4, setinggi seperempatnya. Satu lembar
 * dipotong tiga kali lurus mendatar; tidak ada potongan tegak sama sekali, dan
 * itu yang membuat memotong setumpuk lembar sekaligus mungkin dilakukan dengan
 * pemotong kertas biasa.
 *
 * ── Kenapa halaman ini hanya MEMBACA ────────────────────────────────────────
 *
 * Barisnya dibuat tombol "Buat & cetak" di layar OMD, bukan di sini. Halaman
 * cetak yang menulis akan membuat baris baru setiap kali orang menekan
 * muat-ulang, atau mencetak ulang satu kartu yang sobek bulan depan — dan
 * jumlah kartu beredar, yang menjadi batas WIP, langsung salah.
 *
 * ── Kenapa pemisah lembarnya ditulis sendiri ────────────────────────────────
 *
 * Kartu dikelompokkan berempat dan tiap kelompok diberi `page-break-after`,
 * alih-alih mengandalkan browser menghitung bahwa empat kartu 74,2 mm muat di
 * 297 mm. Perhitungan itu benar di atas kertas tetapi bergantung pembulatan
 * sub-piksel; sekali salah, satu kartu terdorong ke lembar berikutnya dan
 * seluruh tumpukan ikut bergeser.
 *
 * ── Margin nol, dan harus dicetak 100% ─────────────────────────────────────
 *
 * Kartunya selebar kertas, jadi tidak ada ruang untuk margin. "Fit to page" di
 * dialog cetak akan mengecilkan segalanya beberapa persen — ukurannya tidak
 * lagi 21 cm, dan kartunya tidak masuk kantong kanban. Itu disebut di layar,
 * bukan dibiarkan ditemukan sendiri setelah 250 lembar.
 */
export default async function LembarKanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ partId?: string; dari?: string; sampai?: string }>;
}) {
  const q = await searchParams;
  const masukan = cetakKanbanSchema.safeParse({
    partId: Number(q.partId),
    dari: Number(q.dari),
    sampai: Number(q.sampai),
  });
  if (!masukan.success) notFound();

  let kartu: KartuKanbanCetak[];
  try {
    kartu = await daftarKartuCetak(masukan.data);
  } catch {
    notFound();
  }

  /*
   * QR dibuat di server, bukan di browser.
   *
   * margin 2 modul ditambah bantalan putih di CSS memberi zona tenang yang
   * dituntut spesifikasi QR. Tanpa itu, pembaca sering gagal pada kartu yang
   * QR-nya menempel langsung ke garis atau tulisan.
   *
   * Tingkat koreksi M: isinya ±30 karakter (`AVK1|PART|BACK|SERI|QTY`), jadi
   * QR-nya versi 2-3 — sekitar 29 modul, berarti 1,2 mm per modul pada kotak
   * 36 mm. Itu masih jauh di atas yang dituntut pembaca genggam, dan 15%
   * pemulihan cukup untuk kartu yang kena minyak dan tergores di lantai.
   */
  const siap: KartuSiap[] = await Promise.all(
    kartu.map((k) =>
      QRCode.toString(k.kode, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }).then(
        (svg) => ({ ...k, svg }),
      ),
    ),
  );

  const lembar: KartuSiap[][] = [];
  for (let i = 0; i < siap.length; i += KARTU_PER_LEMBAR) {
    lembar.push(siap.slice(i, i + KARTU_PER_LEMBAR));
  }

  const judul = kartu[0]
    ? `${kartu[0].partNumber}${kartu[0].backNumber ? ` (${kartu[0].backNumber})` : ''}`
    : 'Kanban';

  return (
    <main className="mx-auto w-fit p-6 print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        @media print {
          .tanpa-cetak { display: none !important; }
          .kartu { break-inside: avoid; }
          .lembar { break-after: page; }
          .lembar:last-child { break-after: auto; }
        }
      `}</style>

      <header className="tanpa-cetak mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Kartu kanban · {judul}</h1>
          <p className="text-[14px] text-neutral-600">
            {kartu.length} kartu · seri {masukan.data.dari}–{masukan.data.sampai} · {lembar.length}{' '}
            lembar A4 tegak · kartu {KARTU_LEBAR_MM} × 74,25 mm
          </p>
          <p className="mt-2 max-w-[62ch] rounded-xl border border-black p-3 text-[13px] font-semibold leading-snug">
            Cetak dengan skala <span className="underline">100%</span> dan margin{' '}
            <span className="underline">None</span>. Pilihan &ldquo;Fit to page&rdquo; akan
            mengecilkan kartunya beberapa persen, dan lebarnya tidak lagi 21 cm.
          </p>
          {kartu.length > 200 ? (
            <p className="mt-2 max-w-[62ch] rounded-xl border border-dashed border-neutral-400 p-3 text-[13px] leading-snug">
              Lembar sebanyak ini berat dimuat browser. Kalau terasa menggantung, cetak per 200 seri
              — hasilnya sama, dan rentang yang sudah ada tidak dibuat ulang.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/produksi/kanban?partId=${masukan.data.partId}&dari=${masukan.data.dari}&sampai=${masukan.data.sampai}`}
            className="inline-flex h-11 items-center rounded-full border border-neutral-300 px-5 text-[14px] font-semibold"
          >
            Kembali
          </Link>
          <TombolCetak />
        </div>
      </header>

      {kartu.length === 0 ? (
        <p className="tanpa-cetak rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
          Belum ada kartu pada rentang seri ini. Buat dulu dari layar Cetak Kanban.
        </p>
      ) : null}

      {lembar.map((isi, i) => (
        <section key={isi[0]?.kanbanId ?? i} className="lembar">
          {isi.map((k) => (
            <article
              key={k.kanbanId}
              /*
               * Garis tepi hanya di BAWAH: itulah garis potongnya. Garis penuh
               * di empat sisi menghasilkan dua garis berdampingan di tiap
               * potongan, dan kartunya terlihat seperti dipotong miring
               * meskipun lurus.
               */
              className="kartu flex flex-col border-b border-dashed border-neutral-400 px-[8mm] py-[4mm]"
              style={{ width: `${KARTU_LEBAR_MM}mm`, height: `${KARTU_TINGGI_MM}mm` }}
            >
              <div className="flex items-baseline justify-between gap-4 text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                <span className="truncate">
                  {k.plantCode ?? '—'} · {k.lineName ?? 'line belum diisi'}
                </span>
                <span className="shrink-0">Kanban produksi</span>
              </div>

              <div className="flex flex-1 items-center gap-[6mm]">
                {/* Identitas: yang dibaca orang saat memilih kartu dari rak. */}
                <div className="flex min-w-0 flex-1 flex-col justify-center">
                  {/*
                    Back number paling besar. Itulah kode yang dipakai orang di
                    lantai untuk mencocokkan kartu dengan rak dan box — nomor
                    part yang panjang dibaca saat ragu, bukan saat memilih.
                  */}
                  <div className="truncate text-[56px] font-extrabold leading-none tracking-tight">
                    {k.backNumber ?? '—'}
                  </div>
                  <div className="tabular mt-[2mm] truncate text-[24px] font-bold leading-none">
                    {k.partNumber}
                  </div>
                  <div className="mt-[1.5mm] line-clamp-2 text-[12px] leading-snug text-neutral-700">
                    {k.partName}
                  </div>
                </div>

                {/* Angka: dipakai di pos kanban dan saat mengisi box. */}
                <div className="flex shrink-0 gap-[4mm]">
                  {[
                    { label: 'Seri', nilai: k.serialNumber },
                    { label: 'Qty / box', nilai: String(k.qtyPerBox) },
                  ].map((kotak) => (
                    <div
                      key={kotak.label}
                      className="flex w-[32mm] flex-col justify-center border border-black px-[3mm] py-[2mm]"
                    >
                      <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-500">
                        {kotak.label}
                      </div>
                      <div className="tabular mt-[1mm] text-[30px] font-extrabold leading-none">
                        {kotak.nilai}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex w-[38mm] shrink-0 flex-col items-center justify-center">
                  <div
                    className="size-[36mm] bg-white p-[1mm] [&>svg]:size-full"
                    // SVG dihasilkan dari kode kartu kita sendiri, bukan masukan orang.
                    dangerouslySetInnerHTML={{ __html: k.svg }}
                  />
                  {/*
                    Yang tercetak di bawah QR adalah bentuk KETIK MANUAL
                    (`BACK|SERI`), bukan isi QR-nya.

                    Stasiun scan punya tombol ketik manual untuk kartu yang
                    QR-nya tergores — dan isi QR yang lengkap tidak akan diketik
                    siapa pun di lantai, jadi mencetaknya di sini hanya membuat
                    orang menyerah lalu melewatkan scan-nya. Keduanya menuju
                    kartu yang sama.
                  */}
                  <div className="tabular mt-[1mm] text-center text-[9px] font-semibold tracking-wide">
                    {k.kodeKetik}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}
