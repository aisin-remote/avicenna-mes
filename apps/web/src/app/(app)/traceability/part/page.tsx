import Link from 'next/link';
import { Boxes, Layers, Route, ScanSearch, Tag, TriangleAlert } from 'lucide-react';
import type { HasilTracePart, TraceQrUnit } from '@avicenna/contracts';
import { tracePart } from '@/lib/traceability-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import {
  ChipSap,
  Chip,
  KotakCari,
  Kosong,
  LabelPart,
  TautanKanban,
  TautanUnit,
  waktu,
} from '@/components/traceability/bagian';

export const dynamic = 'force-dynamic';

/**
 * Trace Part — dari QR unit (atau nomor/back number part).
 *
 * QR unit menampilkan jejak lengkapnya: proses yang dilewati berurutan, kanban
 * yang membawanya, komponen yang terpotong, dan status kirim SAP tiap langkah.
 * Nomor/back number part menampilkan scan terbaru part itu; tiap seri bisa
 * diklik untuk ditelusuri.
 */
export default async function TracePartPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim().slice(0, 300) ?? '';
  const hasil: HasilTracePart = q ? await tracePart(q) : { jenis: 'KOSONG' };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Traceability' }, { label: 'Trace Part' }]}
        title="Trace Part"
        description="Jejak satu unit dari casting sampai kanban dan SAP"
      />

      <KotakCari
        action="/traceability/part"
        q={q}
        placeholder="Scan QR unit, atau ketik nomor / back number part"
        contoh="Contoh: 011231234567899 (QR unit) · CI11 atau 21211034010 (daftar scan part itu)"
      />

      {hasil.jenis === 'KOSONG' ? (
        <Kosong>Scan QR yang tertatah di part untuk melihat jejaknya.</Kosong>
      ) : hasil.jenis === 'TIDAK_DITEMUKAN' ? (
        <Kosong>
          <span className="tabular font-semibold text-ink">{hasil.q}</span> tidak ditemukan — belum
          pernah discan, dan bukan nomor atau back number part yang terdaftar.
        </Kosong>
      ) : hasil.jenis === 'UNIT' ? (
        <Unit hasil={hasil} />
      ) : (
        <DaftarPart hasil={hasil} />
      )}
    </>
  );
}

function Unit({ hasil }: { hasil: Extract<HasilTracePart, { jenis: 'UNIT' }> }) {
  const terakhir = hasil.langkah[hasil.langkah.length - 1];
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon={ScanSearch}
          title={hasil.serial}
          subtitle={
            terakhir ? (
              <>
                Posisi terakhir: <strong className="text-ink">{terakhir.lineCode ?? '—'}</strong>{' '}
                sebagai <LabelPart part={terakhir.part} /> · {waktu(terakhir.waktu)}
              </>
            ) : (
              'Belum ada scan produksi untuk seri ini'
            )
          }
        />
        {hasil.qr ? <UraianQr qr={hasil.qr} /> : null}
      </Card>

      <Card>
        <CardHeader
          icon={Route}
          title="Jejak proses"
          subtitle={`${hasil.langkah.length} scan, berurutan dari yang pertama`}
        />
        {hasil.langkah.length === 0 ? (
          <p className="px-6 pb-6 text-[14px] text-ink-muted">Belum ada scan untuk seri ini.</p>
        ) : (
          <ol className="relative mx-6 mb-6 border-l-2 border-line pl-6">
            {hasil.langkah.map((l, i) => (
              <li key={l.scanId} className="relative pb-5 last:pb-0">
                <span
                  className={`absolute -left-[33px] top-1 grid size-4 place-items-center rounded-full border-2 ${
                    i === hasil.langkah.length - 1
                      ? 'border-ok bg-ok'
                      : 'border-line-strong bg-card'
                  }`}
                  aria-hidden
                />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[16px] font-bold">{l.lineCode ?? '—'}</span>
                  <LabelPart part={l.part} />
                  <span className="tabular text-[12.5px] text-ink-muted">{waktu(l.waktu)}</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-soft">
                  {l.lineName ? <span>{l.lineName}</span> : null}
                  <Chip nada="netral">{l.kind}</Chip>
                  {l.scanMode ? <Chip nada="netral">{l.scanMode}</Chip> : null}
                  {l.kanbanSerial ? (
                    <span>
                      Kanban <TautanKanban part={l.part} serial={l.kanbanSerial} />
                    </span>
                  ) : null}
                  <span>
                    oleh {l.npk ?? '—'}
                    {l.userName && l.userName !== l.npk ? ` (${l.userName})` : ''}
                  </span>
                </div>
                {l.sap.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {l.sap.map((s, j) => (
                      <ChipSap key={j} sap={s} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-[12px] text-ink-muted">
                    Belum ada dokumen SAP (dikumpulkan ±1 menit sesudah scan).
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={Tag}
            title="Kanban"
            subtitle="Kartu yang membawa unit ini ke proses berikutnya"
          />
          <Table>
            <thead>
              <tr>
                <Th>Kartu</Th>
                <Th>Line</Th>
                <Th>Waktu</Th>
                <Th>Keadaan</Th>
              </tr>
            </thead>
            <tbody>
              {hasil.kanban.length === 0 ? (
                <EmptyState colSpan={4}>Unit ini belum masuk kanban.</EmptyState>
              ) : (
                hasil.kanban.map((k, i) => (
                  <Tr key={`${k.serial}-${i}`}>
                    <Td>
                      <TautanKanban part={k.part} serial={k.serial} />
                    </Td>
                    <Td>{k.lineCode ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">{waktu(k.waktu)}</Td>
                    <Td>
                      {k.masihTerpasang ? (
                        <Chip nada="ok">Masih di box</Chip>
                      ) : (
                        <Chip nada="netral">Sudah dilepas</Chip>
                      )}
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            icon={Boxes}
            title="Komponen"
            subtitle="Terpotong lewat backflush, atau tercatat di silsilah unit"
          />
          <Table>
            <thead>
              <tr>
                <Th>Komponen</Th>
                <Th>Line</Th>
                <Th align="right">Qty</Th>
                <Th>Sumber</Th>
              </tr>
            </thead>
            <tbody>
              {hasil.komponen.length === 0 ? (
                <EmptyState colSpan={4}>Belum ada komponen tercatat.</EmptyState>
              ) : (
                hasil.komponen.map((k, i) => (
                  <Tr key={i}>
                    <Td>
                      <LabelPart part={k.part} nama />
                      {k.serialKomponen || k.lotNumber ? (
                        <span className="block text-[12px] text-ink-muted">
                          {k.serialKomponen ? `seri ${k.serialKomponen}` : ''}
                          {k.lotNumber ? ` lot ${k.lotNumber}` : ''}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{k.lineCode ?? '—'}</Td>
                    <Td align="right" className="tabular">
                      {k.qty}
                    </Td>
                    <Td>
                      <Chip nada="netral">
                        {k.sumber === 'BACKFLUSH' ? 'Backflush' : 'Silsilah'}
                      </Chip>
                    </Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </div>
    </div>
  );
}

const NAMA_BULAN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];

function UraianQr({ qr }: { qr: TraceQrUnit }) {
  const tidakSah = new Set(qr.ruasTidakSah);
  const ruas: { label: string; nilai: string; kunci?: string; keterangan?: string }[] = [
    {
      label: 'Program',
      nilai: qr.program,
      keterangan: qr.fg
        ? `${qr.fg.backNumber ?? ''} ${qr.fg.partNumber}`.trim()
        : 'FG tidak terdaftar',
    },
    { label: 'Die', nilai: qr.die },
    { label: 'Line', nilai: qr.line },
    {
      label: 'Tanggal',
      kunci: 'tanggal',
      nilai: qr.tanggalProduksi
        ? `${qr.tanggal} ${NAMA_BULAN[(qr.bulan ?? 1) - 1]} ${qr.tahun}`
        : 'tidak sah',
    },
    { label: 'Shift', kunci: 'shift', nilai: qr.shift ?? 'tidak sah' },
    { label: 'Shot', kunci: 'shot', nilai: qr.shot !== null ? String(qr.shot) : 'tidak sah' },
  ];
  return (
    <div className="border-t border-line px-6 py-5">
      <div className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        Isi QR 15 digit
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ruas.map((r) => {
          const salah =
            (r.kunci && tidakSah.has(r.kunci)) ||
            (r.kunci === 'tanggal' && (tidakSah.has('tahun') || tidakSah.has('bulan')));
          return (
            <div
              key={r.label}
              className={`rounded-2xl border p-3 ${salah ? 'border-ng/35 bg-ng/5' : 'border-line bg-surface'}`}
            >
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {r.label}
              </div>
              <div className={`tabular mt-1 text-[17px] font-bold ${salah ? 'text-ng' : ''}`}>
                {r.nilai}
              </div>
              {r.keterangan ? (
                <div className="mt-0.5 truncate text-[12px] text-ink-muted">{r.keterangan}</div>
              ) : null}
            </div>
          );
        })}
      </div>
      {qr.ruasTidakSah.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] text-ink-muted">
          <TriangleAlert
            className="mt-0.5 size-3.5 shrink-0 text-warn"
            strokeWidth={2}
            aria-hidden
          />
          Ruas {qr.ruasTidakSah.join(', ')} di luar format — biasanya QR uji atau tatahan yang
          salah. Seri tetap ditelusuri apa adanya.
        </p>
      ) : null}
    </div>
  );
}

function DaftarPart({ hasil }: { hasil: Extract<HasilTracePart, { jenis: 'PART' }> }) {
  return (
    <Card>
      <CardHeader
        icon={Layers}
        title="Scan terbaru"
        subtitle={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {hasil.part.map((p) => (
              <span key={p.id}>
                <LabelPart part={p} /> {p.name ? `— ${p.name}` : ''}
                {p.plantCode ? ` (${p.plantCode})` : ''}
              </span>
            ))}
          </span>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>Waktu</Th>
            <Th>Line</Th>
            <Th>Seri unit</Th>
            <Th>Kanban</Th>
            <Th>Jenis</Th>
            <Th align="right">Qty</Th>
            <Th>Operator</Th>
          </tr>
        </thead>
        <tbody>
          {hasil.scan.length === 0 ? (
            <EmptyState colSpan={7}>Part ini belum pernah discan.</EmptyState>
          ) : (
            hasil.scan.map((s) => (
              <Tr key={s.scanId}>
                <Td className="tabular whitespace-nowrap">{waktu(s.waktu)}</Td>
                <Td>{s.lineCode ?? '—'}</Td>
                <Td>
                  <TautanUnit serial={s.serial} />
                </Td>
                <Td>
                  <TautanKanban
                    part={hasil.part.find((p) => p.id === s.partId) ?? null}
                    serial={s.kanbanSerial}
                  />
                </Td>
                <Td>
                  <Chip nada="netral">{s.kind}</Chip>
                </Td>
                <Td align="right" className="tabular">
                  {s.qty}
                </Td>
                <Td>{s.npk ?? '—'}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
      {hasil.terpotong ? (
        <p className="px-6 py-4 text-[12.5px] text-ink-muted">
          Hanya 200 scan terbaru yang ditampilkan.{' '}
          <Link href="/traceability/part" className="underline underline-offset-4">
            Scan QR unit
          </Link>{' '}
          untuk jejak lengkap satu unit.
        </p>
      ) : null}
    </Card>
  );
}
