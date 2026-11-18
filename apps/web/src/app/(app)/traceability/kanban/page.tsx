import Link from 'next/link';
import { History, Package, Tag, Truck } from 'lucide-react';
import type { HasilTraceKanban, TraceKanbanDetail } from '@avicenna/contracts';
import { traceKanban } from '@/lib/traceability-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { Table, Th, Td, Tr, EmptyState } from '@/components/ui/table';
import {
  Chip,
  ChipKanban,
  KotakCari,
  Kosong,
  LabelPart,
  TautanKanban,
  TautanUnit,
  waktu,
} from '@/components/traceability/bagian';

export const dynamic = 'force-dynamic';

/**
 * Trace Kanban — dari isi QR kartu, "BACK SERI", atau back/nomor part.
 *
 * Satu kartu: isinya sekarang, unit yang pernah dibawanya (dari meta scan,
 * karena isi box dihapus saat dilepas), riwayat siklusnya, dan delivery yang
 * memuatnya. Back/nomor part saja: semua kartu part itu beserta keadaannya.
 */
export default async function TraceKanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = (await searchParams).q?.trim().slice(0, 300) ?? '';
  const hasil: HasilTraceKanban = q ? await traceKanban(q) : { jenis: 'KOSONG' };

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Traceability' }, { label: 'Trace Kanban' }]}
        title="Trace Kanban"
        description="Isi kartu sekarang, unit yang pernah dibawanya, dan riwayat siklusnya"
      />

      <KotakCari
        action="/traceability/kanban"
        q={q}
        placeholder="Scan kartu kanban, atau ketik back number dan seri"
        contoh="Contoh: scan QR kartu · CI11 0008 (satu kartu) · CI11 (semua kartu part itu)"
      />

      {hasil.jenis === 'KOSONG' ? (
        <Kosong>Scan QR kartu kanban untuk melihat isi dan riwayatnya.</Kosong>
      ) : hasil.jenis === 'TIDAK_DITEMUKAN' ? (
        <Kosong>{hasil.alasan}</Kosong>
      ) : hasil.jenis === 'KARTU' ? (
        <div className="space-y-8">
          {hasil.kartu.map((k) => (
            <Kartu key={k.id} k={k} />
          ))}
        </div>
      ) : (
        <Daftar hasil={hasil} />
      )}
    </>
  );
}

function Kartu({ k }: { k: TraceKanbanDetail }) {
  const ringkas = [
    {
      label: 'Keadaan',
      isi: <ChipKanban status={k.status} isi={k.isiSekarang} kapasitas={k.qtyPerBox} />,
    },
    { label: 'Isi', isi: `${k.isiSekarang} / ${k.qtyPerBox}` },
    { label: 'Siklus', isi: String(k.cycleCount) },
    { label: 'Jenis', isi: `${k.kanbanType} · ${k.owner}` },
    { label: 'Diproduksi', isi: waktu(k.producedAt) },
    { label: 'Dilepas', isi: waktu(k.releasedAt) },
    { label: 'Terkirim', isi: waktu(k.deliveredAt) },
    { label: 'Pabrik', isi: k.plantCode ?? '—' },
  ];
  return (
    <section className="space-y-5">
      <Card>
        <CardHeader
          icon={Tag}
          title={`${k.part?.backNumber ?? k.part?.partNumber ?? 'Kartu'} · seri ${k.serial}`}
          subtitle={
            <>
              <LabelPart part={k.part} /> {k.part?.name ? `— ${k.part.name}` : ''}
              {!k.isActive ? (
                <span className="ml-2">
                  <Chip nada="ng">Nonaktif</Chip>
                </span>
              ) : null}
            </>
          }
        />
        <div className="grid grid-cols-2 gap-3 border-t border-line px-6 py-5 sm:grid-cols-4">
          {ringkas.map((r) => (
            <div key={r.label} className="rounded-2xl border border-line bg-surface p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                {r.label}
              </div>
              <div className="tabular mt-1 text-[15px] font-bold">{r.isi}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon={Package}
            title="Isi sekarang"
            subtitle="Unit yang masih menempel di kartu ini"
          />
          <Table>
            <thead>
              <tr>
                <Th>Seri unit</Th>
                <Th>Line</Th>
                <Th>Masuk box</Th>
              </tr>
            </thead>
            <tbody>
              {k.isi.length === 0 ? (
                <EmptyState colSpan={3}>Kartu kosong — siap dipakai.</EmptyState>
              ) : (
                k.isi.map((i) => (
                  <Tr key={i.serial}>
                    <Td>
                      <TautanUnit serial={i.serial} />
                    </Td>
                    <Td>{i.lineCode ?? '—'}</Td>
                    <Td className="tabular whitespace-nowrap">{waktu(i.attachedAt)}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            icon={History}
            title="Riwayat siklus"
            subtitle="Diproduksi, dipulling, dipasangkan, dikirim"
          />
          <Table>
            <thead>
              <tr>
                <Th>Waktu</Th>
                <Th>Kejadian</Th>
                <Th>Line</Th>
                <Th align="right">Qty</Th>
                <Th>Oleh</Th>
              </tr>
            </thead>
            <tbody>
              {k.event.length === 0 && k.delivery.length === 0 ? (
                <EmptyState colSpan={5}>Belum ada kejadian tercatat.</EmptyState>
              ) : (
                k.event.map((e, i) => (
                  <Tr key={i}>
                    <Td className="tabular whitespace-nowrap">{waktu(e.waktu)}</Td>
                    <Td>
                      <Chip nada="netral">{e.type}</Chip>
                      {e.pasangan ? (
                        <span className="ml-2 text-[12.5px] text-ink-muted">
                          dengan {e.pasangan}
                        </span>
                      ) : null}
                    </Td>
                    <Td>{e.lineCode ?? '—'}</Td>
                    <Td align="right" className="tabular">
                      {e.qty ?? '—'}
                    </Td>
                    <Td>{e.npk ?? '—'}</Td>
                  </Tr>
                ))
              )}
            </tbody>
          </Table>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon={History}
          title="Unit yang pernah dibawa"
          subtitle="Setiap scan yang menutup box dengan kartu ini, terbaru lebih dulu"
        />
        <Table>
          <thead>
            <tr>
              <Th>Waktu</Th>
              <Th>Seri unit</Th>
              <Th>Line</Th>
              <Th align="right">Qty</Th>
              <Th>Operator</Th>
            </tr>
          </thead>
          <tbody>
            {k.riwayatScan.length === 0 ? (
              <EmptyState colSpan={5}>Kartu ini belum pernah membawa unit.</EmptyState>
            ) : (
              k.riwayatScan.map((r) => (
                <Tr key={r.scanId}>
                  <Td className="tabular whitespace-nowrap">{waktu(r.waktu)}</Td>
                  <Td>
                    <TautanUnit serial={r.serial} />
                  </Td>
                  <Td>{r.lineCode ?? '—'}</Td>
                  <Td align="right" className="tabular">
                    {r.qty}
                  </Td>
                  <Td>{r.npk ?? '—'}</Td>
                </Tr>
              ))
            )}
          </tbody>
        </Table>
      </Card>

      {k.delivery.length > 0 ? (
        <Card>
          <CardHeader icon={Truck} title="Delivery" subtitle="Loading list yang memuat kartu ini" />
          <Table>
            <thead>
              <tr>
                <Th>Loading list</Th>
                <Th align="right">Qty</Th>
                <Th>Dilepas</Th>
              </tr>
            </thead>
            <tbody>
              {k.delivery.map((d, i) => (
                <Tr key={i}>
                  <Td strong>
                    <Link
                      href={`/delivery/${d.deliveryId}`}
                      className="tabular underline underline-offset-4"
                    >
                      {d.documentNumber}
                    </Link>
                  </Td>
                  <Td align="right" className="tabular">
                    {d.qty}
                  </Td>
                  <Td className="tabular whitespace-nowrap">{waktu(d.releasedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </section>
  );
}

function Daftar({ hasil }: { hasil: Extract<HasilTraceKanban, { jenis: 'DAFTAR' }> }) {
  return (
    <Card>
      <CardHeader
        icon={Tag}
        title={`${hasil.kartu.length} kartu`}
        subtitle={
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            {hasil.part.map((p) => (
              <span key={p.id}>
                <LabelPart part={p} /> {p.name ? `— ${p.name}` : ''}
              </span>
            ))}
          </span>
        }
      />
      <Table>
        <thead>
          <tr>
            <Th>Kartu</Th>
            <Th>Keadaan</Th>
            <Th align="right">Isi</Th>
            <Th align="right">Siklus</Th>
            <Th>Diproduksi</Th>
            <Th>Dilepas</Th>
          </tr>
        </thead>
        <tbody>
          {hasil.kartu.length === 0 ? (
            <EmptyState colSpan={6}>Part ini belum punya kartu kanban.</EmptyState>
          ) : (
            hasil.kartu.map((k) => (
              <Tr key={k.id}>
                <Td>
                  <TautanKanban part={k.part} serial={k.serial} />
                </Td>
                <Td>
                  <ChipKanban status={k.status} isi={k.isiSekarang} kapasitas={k.qtyPerBox} />
                </Td>
                <Td align="right" className="tabular">
                  {k.isiSekarang} / {k.qtyPerBox}
                </Td>
                <Td align="right" className="tabular">
                  {k.cycleCount}
                </Td>
                <Td className="tabular whitespace-nowrap">{waktu(k.producedAt)}</Td>
                <Td className="tabular whitespace-nowrap">{waktu(k.releasedAt)}</Td>
              </Tr>
            ))
          )}
        </tbody>
      </Table>
    </Card>
  );
}
