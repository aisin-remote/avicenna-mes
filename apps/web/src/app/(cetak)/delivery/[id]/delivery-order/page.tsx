import Link from 'next/link';
import QRCode from 'qrcode';
import { notFound } from 'next/navigation';
import { deliveryOrderPreview } from '@avicenna/domain';
import { getDeliveryOrder } from '@/lib/loading-api';
import { TombolCetak } from '@/components/cetak/tombol-cetak';
import { ApiRequestError } from '@/lib/api';
import { DeliveryFlowPanel } from '@/components/delivery/delivery-flow';

export const dynamic = 'force-dynamic';

export default async function DeliveryOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId < 1) notFound();
  let result;
  try {
    result = await getDeliveryOrder(numericId);
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 404) notFound();
    throw err;
  }
  const back = (
    <Link href={`/delivery/${numericId}`} className="do-back">
      Kembali ke delivery
    </Link>
  );
  if (!result.data)
    return (
      <main className="mx-auto max-w-xl space-y-5 p-8">
        <h1 className="text-xl font-bold">Delivery Order belum terbit</h1>
        <p>{result.reason}</p>
        {result.flow ? <DeliveryFlowPanel flow={result.flow}/> : null}
        {back}
      </main>
    );
  const { number, snapshot: doc } = result.data;
  const preview = deliveryOrderPreview({
    status: 'PICKED',
    manifestNumber: doc.qr.value,
    pdsNumber: doc.pdsNumber,
    lines: doc.lines,
  });
  if (!preview.available)
    return (
      <main className="p-8">
        <p>{preview.reason}</p>
        {back}
      </main>
    );
  const qr = await QRCode.toDataURL(doc.qr.value, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 256,
  });
  const date = doc.deliveryDates
    .map((d) =>
      new Date(`${d}T12:00:00+07:00`).toLocaleDateString('en-US', {
        timeZone: 'Asia/Jakarta',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
      }),
    )
    .join(' / ');
  let row = 0;
  return (
    <main className="do-document">
      <style>{`
      @page { size: A4 portrait; margin: 8mm; }
      .do-document { padding: 24px; color:#111; background:#eee; font-family:Arial,Helvetica,sans-serif; }
      .do-controls { max-width:194mm; margin:0 auto 20px; display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; font-size:14px; }
      .do-back { display:inline-block; border:1px solid #aaa; border-radius:20px; padding:10px 18px; }
      .do-sheet { width:194mm; max-width:none; min-height:277mm; margin:0 auto 24px; padding:5mm 2mm; box-sizing:border-box; background:white; }
      .do-company { display:flex; align-items:center; gap:3mm; font-size:10pt; line-height:1.2; }
      .do-logo { width:23mm; height:20mm; object-fit:contain; }
      .do-title { display:flex; justify-content:space-between; align-items:center; margin:4mm 0 8mm; }
      .do-title h1 { font-size:18pt; font-weight:700; }
      .do-qr { width:30mm; height:30mm; }
      .do-meta { display:grid; grid-template-columns:1fr 1fr; gap:8mm; margin-bottom:5mm; font-size:8pt; font-weight:600; }
      .do-meta dl { display:grid; grid-template-columns:28mm 1fr; gap:2.2mm 1mm; align-content:start; }
      .do-meta dd { overflow-wrap:anywhere; }
      .do-meta dd::before { content:': '; }
      .do-items { width:100%; table-layout:fixed; border-collapse:collapse; font-size:8pt; line-height:1.1; }
      .do-items th,.do-items td { border:.3mm solid #555; text-align:center; padding:1.3mm .6mm; overflow-wrap:anywhere; vertical-align:middle; }
      .do-items th { font-weight:700; padding:.8mm .4mm; }
      .do-items tbody tr { height:10mm; break-inside:avoid; }
      .do-ref { margin-top:3mm; font-size:7pt; }
      @media screen and (max-width:820px) { .do-document { padding:12px; overflow-x:auto; } .do-controls { min-width:320px; } }
      @media print {
        html,body { background:white !important; zoom:1 !important; }
        .do-document { padding:0; background:white; }
        .tanpa-cetak { display:none !important; }
        .do-sheet { margin:0; padding:3mm 0; min-height:0; break-after:page; }
        .do-sheet:last-child { break-after:auto; }
        .do-items thead { display:table-header-group; }
      }
    `}</style>
      <header className="do-controls tanpa-cetak">
        <div>
          <strong>{number}</strong>
          <p>
            PDS {doc.pdsNumber} · {preview.pages.length} halaman
          </p>
        </div>
        <div className="flex items-center gap-3">
          {back}
          <TombolCetak />
        </div>
      </header>
      {result.data.isSimulation ? <p className="mx-auto max-w-[194mm] border-2 border-black p-3 text-center font-bold">SIMULASI — BUKAN SURAT JALAN UNTUK PENGIRIMAN NYATA</p> : null}
      {preview.pages.map((lines, index) => (
        <section
          className="do-sheet"
          key={index}
          aria-label={`Delivery Order halaman ${index + 1}`}
        >
          <header className="do-company">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="do-logo" src="/images/aii-delivery-logo.png" alt="AII" />
            <div>
              <strong>PT. AISIN INDONESIA</strong>
              <p>EJIP INDUSTRIAL PARK PLOT 5J, CIKARANG - BEKASI</p>
              <p>Telp.(021) - 8970909 Facs.(021) - 8970910</p>
            </div>
          </header>
          <div className="do-title">
            <h1>DELIVERY ORDER</h1>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="do-qr" src={qr} alt={`QR ${doc.qr.source}: ${doc.qr.value}`} />
          </div>
          <div className="do-meta">
            <dl>
              <dt>Do No</dt>
              <dd>{number}</dd>
              <dt>Page</dt>
              <dd>
                {index + 1}/{preview.pages.length}
              </dd>
              <dt>For D/N NO</dt>
              <dd>{doc.documentNumbers.join(' / ')}</dd>
              <dt>Delivery Date</dt>
              <dd>{date}</dd>
              <dt>Time</dt>
              <dd>{doc.planTimes.join(' / ') || '—'}</dd>
            </dl>
            <dl>
              <dt>Customer</dt>
              <dd>{doc.customerName}</dd>
              <dt>Delivery Location</dt>
              <dd>{doc.deliveryLocations.join(' / ') || '—'}</dd>
              <dt>PO NO</dt>
              <dd>{doc.purchaseOrderNumbers.join(' / ') || '—'}</dd>
              <dt>Customer Code</dt>
              <dd>{doc.customerCode}</dd>
            </dl>
          </div>
          <table className="do-items">
            <colgroup>
              {[3, 14, 27, 6, 6, 6, 7, 7, 8, 8, 8].map((width, i) => (
                <col key={i} style={{ width: `${width}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {[
                  'No.',
                  'PARTS No.',
                  'PARTS NAME',
                  'BOX CODE',
                  'TOTAL KBN',
                  'PCS/ KBN',
                  'TOTAL QTY',
                  'UNIT',
                  'RECEIVE',
                  'REMARK',
                  'NOTE',
                ].map((label) => (
                  <th key={label} scope="col">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>{++row}</td>
                  <td>
                    {line.customerPartNumber ? <div>({line.customerPartNumber})</div> : null}
                    <div>{line.partNumber ?? '—'}</div>
                  </td>
                  <td>{line.partName ?? '—'}</td>
                  <td></td>
                  <td>{line.pickedKanban}</td>
                  <td>{line.qtyPerKanban}</td>
                  <td>{line.pickedQty}</td>
                  <td>{line.uom ?? ''}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="do-ref">
            PDS: {doc.pdsNumber} · {doc.qr.source}: {doc.qr.value}
          </p>
        </section>
      ))}
    </main>
  );
}
