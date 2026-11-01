import { notFound } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { getLoading, getInternalKanbans } from '@/lib/loading-api';
import { TombolCetak } from '@/components/cetak/tombol-cetak';

export const dynamic = 'force-dynamic';

/** Cetak ulang identitas kartu internal. Kanban customer berasal dari PDF portal. */
export default async function InternalKanbanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; card?: string | string[] }>;
}) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) notFound();
  let doc;
  try {
    doc = await getLoading(numericId);
  } catch {
    notFound();
  }
  const sp = await searchParams;
  const query = typeof sp.q === 'string' ? sp.q.slice(0, 64) : '';
  const { data: cards, truncated } = await getInternalKanbans(numericId, query);
  const requested = new Set(
    (Array.isArray(sp.card) ? sp.card : sp.card ? [sp.card] : [])
      .filter((value) => /^[1-9]\d*$/.test(value))
      .slice(0, 500)
      .map(Number),
  );
  // Hanya ID dari hasil yang sudah dibatasi part/pabrik/customer oleh API yang bisa dicetak.
  const selected = cards.filter((card) => requested.has(card.id) && card.barcode);
  const labels = await Promise.all(
    selected.map(async (card) => ({
      ...card,
      svg: await QRCode.toString(card.barcode!, {
        type: 'svg',
        margin: 4,
        errorCorrectionLevel: 'M',
      }),
    })),
  );
  const printPath = `/delivery/${doc.id}/label`;

  return (
    <main className="mx-auto max-w-[210mm] p-6 print:p-0">
      <style>{`
        @page { size: A4; margin: 8mm; }
        @media print { .tanpa-cetak { display: none !important; } .label { break-inside: avoid; } }
      `}</style>
      <header className="tanpa-cetak mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[24px] font-bold">Kanban Internal</h1>
          <p className="mt-1 text-sm text-neutral-600">
            {doc.documentNumber} · {doc.customerName}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/delivery/${doc.id}`}
            className="rounded-full border border-neutral-300 px-5 py-3 text-sm font-semibold"
          >
            Kembali
          </Link>
          {labels.length > 0 ? <TombolCetak /> : null}
        </div>
      </header>
      <section className="tanpa-cetak mb-6 rounded-2xl border border-neutral-300 p-4">
        <h2 className="font-bold">Pilih nomor seri kartu yang akan dicetak</h2>
        <p className="mt-1 text-sm text-neutral-600">
          Kartu internal mengikuti master part dan nomor seri yang sudah terdaftar. Cetak ulang
          tidak menambah stok atau mencatat scan pulling.
        </p>
        <p className="mt-2 text-sm">
          Kanban customer memakai file dari portal customer.{' '}
          <Link href="/kanban" className="font-semibold text-blue-700 underline">
            Upload / potong PDF customer
          </Link>
        </p>
        <form action={printPath} method="get" className="mt-4 flex flex-wrap gap-2">
          <label htmlFor="card-query" className="sr-only">
            Cari nomor seri, part atau back number
          </label>
          <input
            id="card-query"
            name="q"
            defaultValue={query}
            maxLength={64}
            placeholder="Cari seri / part / back number…"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          <button className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-semibold">
            Cari
          </button>
        </form>
        {truncated ? (
          <p role="status" className="mt-3 text-sm text-amber-800">
            Menampilkan 500 kartu pertama. Gunakan pencarian untuk mempersempit daftar.
          </p>
        ) : null}
        {requested.size > labels.length ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            Sebagian pilihan tidak tersedia atau datanya belum lengkap. Periksa kembali nomor seri
            yang akan dicetak.
          </p>
        ) : null}
        {cards.length ? (
          <form action={printPath} method="get" className="mt-4">
            <input type="hidden" name="q" value={query} />
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {cards.map((card) => (
                <label
                  key={card.id}
                  className="flex items-start gap-3 rounded-xl border border-neutral-200 p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    name="card"
                    value={card.id}
                    defaultChecked={requested.has(card.id) && !!card.barcode}
                    disabled={!card.barcode}
                    className="mt-1 size-4 shrink-0"
                  />
                  <span className="min-w-0">
                    <strong className="block break-all">{card.serialNumber}</strong>
                    <span className="block break-words text-neutral-600">
                      {card.backNumber ?? 'Back number belum diisi'} · {card.partNumber} ·{' '}
                      {card.qtyPerBox} {card.uom}/box
                    </span>
                    {!card.barcode ? (
                      <span className="block text-red-700">
                        Lengkapi back number, nomor seri, dan qty kartu di Master Data sebelum
                        mencetak.
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
            </div>
            <button className="mt-4 rounded-full bg-black px-5 py-3 text-sm font-semibold text-white">
              Tampilkan label pilihan
            </button>
          </form>
        ) : (
          <p className="mt-4 rounded-xl bg-neutral-100 p-4 text-sm">
            Belum ada kartu internal yang cocok. Periksa pencarian atau daftarkan kartunya melalui
            Master Data → Kanban.
          </p>
        )}
      </section>
      {labels.length > 0 ? (
        <p className="tanpa-cetak mb-3 text-sm font-semibold">
          {labels.length} kartu siap dicetak. Pastikan nomor seri sesuai kartu fisik yang
          diperlukan.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-[4mm] sm:grid-cols-2 print:grid-cols-2">
        {labels.map((card) => (
          <article
            key={card.id}
            className="label flex gap-2 rounded-md border border-black p-3"
            style={{ width: '90mm', height: '62mm' }}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="text-[10px] font-bold uppercase tracking-wider">
                Kanban Internal · {card.plantCode}
              </div>
              <div className="mt-1 break-all text-[25px] font-extrabold leading-tight">
                {card.backNumber}
              </div>
              <div className="mt-1 break-all text-[12px] font-bold leading-tight">
                {card.partNumber}
              </div>
              <div className="mt-1 line-clamp-2 text-[10px] leading-tight">{card.partName}</div>
              <div className="mt-auto text-[10px]">
                <div>
                  No. seri <strong className="break-all">{card.serialNumber}</strong>
                </div>
                <div>
                  Qty / box{' '}
                  <strong>
                    {card.qtyPerBox} {card.uom}
                  </strong>
                </div>
                {card.boxType || card.side ? (
                  <div>
                    Box {card.boxType ?? '—'} · Side {card.side ?? '—'}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex w-[30mm] shrink-0 flex-col items-center justify-center gap-1">
              <div
                className="size-[30mm] [&>svg]:size-full"
                dangerouslySetInnerHTML={{ __html: card.svg }}
              />
              <div className="w-full break-all text-center font-mono text-[7px] leading-tight">
                {card.barcode}
              </div>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
