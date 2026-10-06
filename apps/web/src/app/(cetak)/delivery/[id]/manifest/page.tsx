import Link from 'next/link';
import { notFound } from 'next/navigation';
import { TombolCetak } from '@/components/cetak/tombol-cetak';
import { getLoading } from '@/lib/loading-api';

export const dynamic = 'force-dynamic';

export default async function ManifestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  let doc;
  try {
    doc = await getLoading(numericId);
  } catch {
    notFound();
  }

  const tanggal = new Date(`${doc.deliveryDate}T00:00:00`).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const totalKanban = doc.lines.reduce((sum, line) => sum + line.plannedKanban, 0);
  const totalQty = doc.lines.reduce((sum, line) => sum + line.plannedQty, 0);

  return (
    <main className="mx-auto max-w-[297mm] p-6 print:p-0">
      <style>{`
        @page { size: A4 landscape; margin: 10mm; }
        @media print {
          .tanpa-cetak { display: none !important; }
          .baris { break-inside: avoid; }
        }
      `}</style>

      <p className="mb-3 border border-dashed border-black px-3 py-2 text-center text-[10px] font-bold uppercase tracking-[0.18em]">
        Preview internal · bukan surat jalan / DO resmi SAP
      </p>

      <header className="tanpa-cetak mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Manifest · {doc.documentNumber}</h1>
          <p className="text-[14px] text-neutral-600">
            Dokumen PPIC · {doc.customerName ?? '—'} · {tanggal}
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

      <section className="border-2 border-black">
        <div className="flex items-start justify-between gap-8 border-b-2 border-black p-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.22em]">Avicenna MES</p>
            <h2 className="mt-1 text-[28px] font-black uppercase tracking-tight">
              Manifest Pengiriman
            </h2>
          </div>
          <div className="text-right">
            <p className="text-[11px] uppercase text-neutral-600">Nomor manifest</p>
            <p className="text-[20px] font-black">{doc.manifestNumber ?? '—'}</p>
            <p className="mt-1 text-[11px]">Loading list: {doc.documentNumber}</p>
          </div>
        </div>

        <dl className="grid grid-cols-4 border-b-2 border-black text-[11px]">
          {[
            ['Customer', `${doc.customerCode ?? '—'} · ${doc.customerName ?? '—'}`],
            ['Tanggal / rit', `${tanggal} · ${doc.cycle}`],
            ['PDS', doc.pdsNumber ?? '—'],
            ['Dock', doc.dock ?? '—'],
            ['Nomor truk', doc.truckNumber ?? '—'],
            ['Sopir', doc.driverName ?? '—'],
            ['Total part', doc.lines.length.toLocaleString('id-ID')],
            [
              'Total kanban / qty',
              `${totalKanban.toLocaleString('id-ID')} / ${totalQty.toLocaleString('id-ID')}`,
            ],
          ].map(([label, value], index) => (
            <div
              key={label}
              className={`p-3 ${index % 4 !== 3 ? 'border-r border-black' : ''} ${index < 4 ? 'border-b border-black' : ''}`}
            >
              <dt className="uppercase text-neutral-500">{label}</dt>
              <dd className="mt-1 font-bold">{value}</dd>
            </div>
          ))}
        </dl>

        <table className="w-full table-fixed border-collapse text-[10px]">
          <thead>
            <tr className="border-b-2 border-black bg-neutral-100 text-left uppercase">
              <th className="w-[5%] border-r border-black p-2 text-center">No.</th>
              <th className="w-[15%] border-r border-black p-2">Part internal</th>
              <th className="w-[17%] border-r border-black p-2">Part customer</th>
              <th className="border-r border-black p-2">Nama part</th>
              <th className="w-[9%] border-r border-black p-2 text-right">Isi / box</th>
              <th className="w-[9%] border-r border-black p-2 text-right">Kanban</th>
              <th className="w-[11%] p-2 text-right">Total qty</th>
            </tr>
          </thead>
          <tbody>
            {doc.lines.map((line, index) => (
              <tr key={line.id} className="baris border-b border-black last:border-b-0">
                <td className="border-r border-black p-2 text-center">{index + 1}</td>
                <td className="border-r border-black p-2 font-bold">
                  {line.partNumber ?? '—'}
                  <span className="block text-[8px] font-normal">
                    Item {line.sapItemNumber ?? '—'}
                  </span>
                </td>
                <td className="border-r border-black p-2">{line.customerPartNumber ?? '—'}</td>
                <td className="border-r border-black p-2">{line.partName ?? '—'}</td>
                <td className="border-r border-black p-2 text-right tabular-nums">
                  {line.qtyPerKanban.toLocaleString('id-ID')} {line.uom ?? ''}
                </td>
                <td className="border-r border-black p-2 text-right tabular-nums">
                  {line.plannedKanban.toLocaleString('id-ID')}
                </td>
                <td className="p-2 text-right font-bold tabular-nums">
                  {line.plannedQty.toLocaleString('id-ID')} {line.uom ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6 grid grid-cols-3 gap-8 text-center text-[11px]">
        {['Disiapkan PPIC', 'Diperiksa', 'Diterima sopir'].map((label) => (
          <div key={label} className="border border-black p-3">
            <p className="font-bold">{label}</p>
            <div className="h-16" />
            <p className="border-t border-black pt-2">Nama / tanda tangan</p>
          </div>
        ))}
      </section>
    </main>
  );
}
