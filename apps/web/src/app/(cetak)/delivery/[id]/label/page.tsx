import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { susunLabelDn } from '@avicenna/domain';
import { getLoading } from '@/lib/loading-api';
import { TombolCetak } from '@/components/cetak/tombol-cetak';

export const dynamic = 'force-dynamic';

/**
 * Kanban — satu label per box, dicetak dari loading list kita sendiri.
 *
 * Di sistem lama label ini datang dari modul pulling bella lewat API. Sekarang
 * loading list dibuat di sini, jadi labelnya pun dari sini: isinya disusun
 * `susunLabelDn` dan dibaca `ATURAN_KANBAN_LABEL_DN` — satu pasang, satu paket,
 * supaya yang dicetak pasti terbaca di lini FG.
 *
 * Jumlah label per part = rencana kanban baris itu. Box yang sudah diambil
 * tetap dicetak ulang bila diminta — label sobek itu biasa — dan tidak apa-apa:
 * label yang sama tidak bisa terhitung dua kali di server.
 */
export default async function LabelDnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  let doc;
  try {
    doc = await getLoading(numericId);
  } catch {
    notFound();
  }

  const labelWidth = 90;
  const labelHeight = 62;

  const customerCode = doc.customerCode ?? 'CUST';
  const tanggal = new Date(`${doc.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  const label = await Promise.all(
    doc.lines.flatMap((l) =>
      Array.from({ length: l.plannedKanban }, (_, i) => {
        const seq = i + 1;
        const teks = susunLabelDn({
          customerCode,
          // Label memakai penomoran customer; bila belum dipetakan, nomor
          // internal — server menerima keduanya (lihat periksaLabelDn).
          customerPartNumber: l.customerPartNumber ?? l.partNumber ?? '',
          dnNumber: doc.documentNumber,
          dnSeq: seq,
        });
        return QRCode.toString(teks, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }).then(
          (svg) => ({ line: l, seq, teks, svg }),
        );
      }),
    ),
  );

  return (
    <main className="mx-auto max-w-[210mm] p-6 print:p-0">
      <style>{`
        @page { size: A4; margin: 8mm; }
        @media print {
          .tanpa-cetak { display: none !important; }
          .label { break-inside: avoid; }
        }
      `}</style>

      <p className="mb-3 border border-dashed border-black px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.18em]">
        Preview internal · format kanban menunggu validasi customer / SAP
      </p>

      <header className="tanpa-cetak mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Kanban · {doc.documentNumber}</h1>
          <p className="text-[14px] text-neutral-600">
            {label.length} label · {doc.customerName ?? '—'} · kirim {tanggal} rit {doc.cycle}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/delivery/${doc.id}`}
            className="inline-flex h-11 items-center rounded-full border border-neutral-300 px-5 text-[14px] font-semibold"
          >
            Kembali
          </Link>
          <TombolCetak />
        </div>
      </header>

      {label.length === 0 ? (
        <p className="tanpa-cetak rounded-2xl border border-dashed border-neutral-300 p-8 text-center text-neutral-500">
          Loading list ini belum punya rencana kanban, jadi belum ada label untuk dicetak.
        </p>
      ) : null}

      {/* Dua kolom × 90mm: muat 8 label per A4. Ukurannya mengikuti label
          kanban 230 karakter yang sudah dipakai di lantai supaya tempat
          tempelnya sama. */}
      <div className="grid grid-cols-2 gap-[4mm]">
        {label.map(({ line, seq, teks, svg }) => (
          <article
            key={teks}
            className="label flex gap-3 overflow-hidden rounded-md border border-black p-3"
            style={{
              width: `${labelWidth}mm`,
              height: `${labelHeight}mm`,
            }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-baseline justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">
                <span className="truncate">{doc.customerName ?? customerCode}</span>
                <span>Direct pulling</span>
              </div>
              <div className="mt-1 truncate text-[20px] font-extrabold leading-tight tracking-tight">
                {line.customerPartNumber ?? line.partNumber}
              </div>
              {line.customerPartNumber && line.partNumber ? (
                <div className="truncate text-[12px] font-semibold text-neutral-700">
                  {line.partNumber}
                </div>
              ) : null}
              <div className="truncate text-[12px] text-neutral-700">{line.partName}</div>

              <div className="mt-auto grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
                <div className="text-neutral-500">DN</div>
                <div className="font-semibold">{doc.documentNumber}</div>
                <div className="text-neutral-500">Box</div>
                <div className="font-semibold">
                  {seq} / {line.plannedKanban}
                </div>
                <div className="text-neutral-500">Isi</div>
                <div className="font-semibold">
                  {line.qtyPerKanban} {line.uom ?? 'pcs'}
                </div>
                <div className="text-neutral-500">Kirim</div>
                <div className="font-semibold">
                  {tanggal} · rit {doc.cycle}
                  {doc.dock ? ` · ${doc.dock}` : ''}
                </div>
              </div>
            </div>

            <div className="flex w-[30mm] shrink-0 flex-col items-center justify-center gap-1">
              <div
                className="size-[28mm] [&>svg]:size-full"
                // SVG ini dihasilkan sendiri dari teks label, bukan dari masukan orang.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
              <div className="w-full break-all text-center font-mono text-[7px] leading-tight text-neutral-600">
                {teks}
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
