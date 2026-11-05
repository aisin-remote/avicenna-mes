import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import {
  cetakKanbanSchema,
  KARTU_LEBAR_MM,
  KARTU_PER_BARIS,
  KARTU_PER_LEMBAR,
  type KartuKanbanCetak,
} from '@avicenna/contracts';
import { daftarKartuCetak } from '@/lib/kanban-cetak-api';
import { TombolCetak } from '@/components/cetak/tombol-cetak';
import { KartuKanban } from '@/components/cetak/kartu-kanban';

export const dynamic = 'force-dynamic';

type KartuSiap = KartuKanbanCetak & { svg: string };


/**
 * Lembar kartu kanban — A4 tegak, delapan kartu per lembar (2 × 4).
 *
 * Kartunya 105 × 74,2 mm: setengah lebar A4, seperempat tingginya. Satu lembar
 * dipotong sekali tegak dan tiga kali mendatar, semuanya lurus dari tepi ke
 * tepi — itu yang membuat memotong setumpuk lembar sekaligus mungkin dilakukan
 * dengan pemotong kertas biasa.
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
 * Kartu dikelompokkan berdelapan dan tiap kelompok diberi `page-break-after`,
 * alih-alih mengandalkan browser menghitung bahwa empat baris 74,2 mm muat di
 * 297 mm. Perhitungan itu benar di atas kertas tetapi bergantung pembulatan
 * sub-piksel; sekali salah, satu kartu terdorong ke lembar berikutnya dan
 * seluruh tumpukan ikut bergeser.
 *
 * ── Margin nol, dan harus dicetak 100% ─────────────────────────────────────
 *
 * Dua kartu memenuhi lebar kertas, jadi tidak ada ruang untuk margin. "Fit to
 * page" di dialog cetak akan mengecilkan segalanya beberapa persen — lebarnya
 * tidak lagi 10,5 cm, dan kartunya tidak masuk kantong kanban. Itu disebut di layar,
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
   * margin 0: QR-nya diletakkan tepat 5 mm dari tepi atas dan kanan kartu,
   * diukur sampai modul hitamnya — seperti orang mengukurnya dengan penggaris.
   * Lima milimeter kosong itu sendiri yang menjadi zona tenang di dua sisi
   * tersebut; dua sisi lainnya dijaga celah di tata letak kartu.
   *
   * Tingkat koreksi M: isinya 230 karakter (format AIGSYS sistem lama), jadi
   * QR-nya versi 11 — 61 modul, sekitar 0,36 mm per modul pada kotak 22 mm.
   * Itu ukuran kartu lama, dan pembaca 2D genggam membacanya; yang perlu
   * dijaga adalah printernya — cetak 100%, karena "fit to page" mengecilkan
   * modulnya lagi. 15% pemulihan cukup untuk kartu yang kena minyak dan
   * tergores di lantai.
   */
  const siap: KartuSiap[] = await Promise.all(
    kartu.map((k) =>
      QRCode.toString(k.kode, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(
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
            lembar A4 tegak · {KARTU_PER_LEMBAR} kartu per lembar · kartu {KARTU_LEBAR_MM} × 74,25 mm
          </p>
          <p className="mt-2 max-w-[62ch] rounded-xl border border-black p-3 text-[13px] font-semibold leading-snug">
            Cetak dengan skala <span className="underline">100%</span> dan margin{' '}
            <span className="underline">None</span>. Pilihan &ldquo;Fit to page&rdquo; akan
            mengecilkan kartunya beberapa persen, dan lebarnya tidak lagi 10,5 cm.
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
        <section
          key={isi[0]?.kanbanId ?? i}
          className="lembar grid content-start"
          style={{ gridTemplateColumns: `repeat(${KARTU_PER_BARIS}, ${KARTU_LEBAR_MM}mm)` }}
        >
          {isi.map((k) => (
            <KartuKanban key={k.kanbanId} kartu={k} svg={k.svg} />
          ))}
        </section>
      ))}
    </main>
  );
}
