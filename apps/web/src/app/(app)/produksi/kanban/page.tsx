import Form from 'next/form';
import { TriangleAlert, Info, Layers } from 'lucide-react';
import {
  KARTU_LEBAR_MM,
  KARTU_PER_CETAK_MAKS,
  KARTU_PER_LEMBAR,
  SERI_KANBAN_MAKS,
} from '@avicenna/contracts';
import type { PratinjauCetakKanban } from '@avicenna/contracts';
import { listPartKartu, pratinjauCetakKanban } from '@/lib/kanban-cetak-api';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { TombolBuatCetak } from '@/components/produksi/cetak-kanban-form';

export const dynamic = 'force-dynamic';

/**
 * Cetak kanban — layar OMD.
 *
 * Master kanban lahir di sini: pilih part, sebut rentang seri, cetak. Yang
 * sudah ada tidak dibuat ulang. Lihat catatan di `cetakKanbanSchema`
 * (@avicenna/contracts) kenapa pembuatan menempel pada pencetakan.
 *
 * Rentangnya dikirim lewat alamat (bukan keadaan di browser) supaya pratinjau
 * bisa dihitung di server, dan supaya rentang yang sedang disiapkan bisa
 * dikirim ke orang lain sebagai tautan.
 */
export default async function CetakKanbanPage({
  searchParams,
}: {
  searchParams: Promise<{ partId?: string; dari?: string; sampai?: string }>;
}) {
  const q = await searchParams;
  const part = await listPartKartu();

  const partId = Number(q.partId);
  const dari = Number(q.dari);
  const sampai = Number(q.sampai);
  const lengkap =
    Number.isInteger(partId) && partId > 0 && Number.isInteger(dari) && Number.isInteger(sampai);

  let pratinjau: PratinjauCetakKanban | null = null;
  let galat: string | null = null;
  if (lengkap) {
    try {
      pratinjau = await pratinjauCetakKanban({ partId, dari, sampai });
    } catch {
      galat =
        'Rentangnya tidak bisa dihitung. Periksa seri awal dan akhir — ' +
        `sekali cetak paling banyak ${KARTU_PER_CETAK_MAKS} kartu, dan seri paling besar ` +
        `${SERI_KANBAN_MAKS}.`;
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Cetak Kanban' }]}
        title="Cetak Kanban"
        description="Master kartu dibuat saat dicetak — yang sudah ada tidak dibuat ulang"
      />

      <Card>
        <CardHeader
          icon={Layers}
          title="Pilih part dan rentang seri"
          subtitle={
            `Kartu ${KARTU_LEBAR_MM / 10} × 7,4 cm — ${KARTU_PER_LEMBAR} kartu per lembar A4 · ` +
            `paling banyak ${KARTU_PER_CETAK_MAKS} kartu sekali cetak`
          }
        />
        <Form
          action="/produksi/kanban"
          className="grid gap-4 p-6 sm:grid-cols-[1fr_auto_auto_auto]"
        >
          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold">Part</span>
            <select
              name="partId"
              defaultValue={q.partId ?? ''}
              required
              className="h-11 w-full rounded-2xl border border-line bg-card px-3 text-[14px] outline-none focus:border-ink"
            >
              <option value="">— pilih part —</option>
              {part.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.plantCode ?? '—'} · {p.partNumber}
                  {p.backNumber ? ` (${p.backNumber})` : ''} — {p.partName}
                  {p.jumlahKartu > 0 ? ` · ${p.jumlahKartu} kartu` : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold">Seri awal</span>
            <input
              name="dari"
              type="number"
              min={1}
              max={SERI_KANBAN_MAKS}
              required
              defaultValue={q.dari ?? '1'}
              className="tabular h-11 w-[120px] rounded-2xl border border-line bg-card px-3 text-[14px] outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[13px] font-semibold">Seri akhir</span>
            <input
              name="sampai"
              type="number"
              min={1}
              max={SERI_KANBAN_MAKS}
              required
              defaultValue={q.sampai ?? ''}
              className="tabular h-11 w-[120px] rounded-2xl border border-line bg-card px-3 text-[14px] outline-none focus:border-ink"
            />
          </label>

          <div className="flex items-end">
            <button
              type="submit"
              className="h-11 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:bg-surface"
            >
              Periksa
            </button>
          </div>
        </Form>
      </Card>

      {galat ? (
        <Card className="mt-4 border-ng/45 bg-ng/5 p-5 text-[14px] text-ng">{galat}</Card>
      ) : null}

      {pratinjau ? (
        <Card className="mt-4">
          <CardHeader
            icon={Layers}
            title={`${pratinjau.part.partNumber} — ${pratinjau.part.partName}`}
            subtitle={[
              pratinjau.part.backNumber ?? 'tanpa back number',
              pratinjau.part.lineName
                ? `${pratinjau.part.lineName} (${pratinjau.part.lineWorkCenter ?? 'work center kosong'})`
                : 'tanpa line',
              pratinjau.slocTujuan ? `SLOC tujuan ${pratinjau.slocTujuan}` : 'SLOC tujuan kosong',
              pratinjau.part.qtyPerBox ? `${pratinjau.part.qtyPerBox} pcs/box` : 'isi box kosong',
            ].join(' · ')}
          />

          <div className="grid gap-4 p-6 sm:grid-cols-4">
            {[
              { label: 'Seri', nilai: `${pratinjau.dari} – ${pratinjau.sampai}` },
              { label: 'Total kartu', nilai: String(pratinjau.total) },
              { label: 'Sudah ada', nilai: String(pratinjau.sudahAda) },
              { label: 'Akan dibuat', nilai: String(pratinjau.akanDibuat) },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-line bg-surface p-4">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                  {s.label}
                </div>
                <div className="tabular mt-1 text-[22px] font-extrabold leading-none">
                  {s.nilai}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3 px-6">
            {pratinjau.penghalang.map((p) => (
              <p
                key={p}
                className="flex items-start gap-2 rounded-2xl border border-ng/45 bg-ng/5 p-4 text-[13px] leading-snug text-ng"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
                <span>{p}</span>
              </p>
            ))}
            {pratinjau.peringatan.map((p) => (
              <p
                key={p}
                className="flex items-start gap-2 rounded-2xl border border-line bg-surface p-4 text-[13px] leading-snug text-ink-soft"
              >
                <Info
                  className="mt-0.5 size-4 shrink-0 text-ink-muted"
                  strokeWidth={2}
                  aria-hidden
                />
                <span>{p}</span>
              </p>
            ))}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-4 p-6">
            <p className="text-[13px] text-ink-muted">
              {pratinjau.lembar} lembar A4 · {KARTU_PER_LEMBAR} kartu per lembar
              {pratinjau.sudahAda > 0
                ? ` · ${pratinjau.sudahAda} kartu lama ikut tercetak ulang, masternya tidak disentuh`
                : ''}
            </p>
            <TombolBuatCetak pratinjau={pratinjau} />
          </footer>
        </Card>
      ) : null}
    </>
  );
}
