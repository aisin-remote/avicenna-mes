import Form from 'next/form';
import { TriangleAlert } from 'lucide-react';
import type { DaftarPartFg, PohonPartFg } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { getMasterOptions, type RefOption } from '@/lib/master-api';
import { katalogProsesServer } from '@/lib/process-types';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { TabelPohonFg } from '@/components/master/tabel-pohon-fg';

export const dynamic = 'force-dynamic';

/**
 * Satu FG beserta seluruh turunannya: susunannya dari BOM SAP, sedangkan part dan
 * rutenya dari master Avicenna dan bisa disunting di sini.
 *
 * Alamatnya menyimpan FG yang dibuka, jadi muat ulang setelah menyimpan tetap di
 * FG yang sama, dan tautannya bisa dikirim ke orang lain.
 */
export default async function PartFgPage({
  searchParams,
}: {
  searchParams: Promise<{ fg?: string }>;
}) {
  const fg = (await searchParams).fg?.trim() ?? '';
  const [daftar, pohon, plants, partOpsi, lines, locations, katalog] = await Promise.all([
    apiFetch<DaftarPartFg>('/bom/fg'),
    fg ? apiFetch<PohonPartFg>(`/bom/fg/${encodeURIComponent(fg)}`) : null,
    getMasterOptions('plants'),
    getMasterOptions('parts'),
    getMasterOptions('lines'),
    getMasterOptions('locations'),
    katalogProsesServer(),
  ]);
  const options: Record<string, RefOption[]> = { plants, parts: partOpsi, lines, locations };
  const galat = !daftar.tersedia ? daftar.galat : pohon && !pohon.tersedia ? pohon.galat : null;

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Master Data' }, { label: 'Part FG & Turunan' }]}
        title="Part FG & Turunan"
        description="Susunan part dari BOM SAP, lengkap dengan part dan rute prosesnya di Avicenna"
      />

      <Form
        action="/master/part-fg"
        className="mb-4 flex flex-wrap items-end gap-3 rounded-card border border-line bg-card p-4"
      >
        <label className="block min-w-[280px] flex-1">
          <span className="mb-1.5 block text-[13px] font-semibold">Part FG</span>
          <select
            name="fg"
            defaultValue={fg}
            required
            className="h-11 w-full rounded-2xl border border-line bg-card px-3 text-[14px] outline-none focus:border-ink"
          >
            <option value="">— pilih part FG —</option>
            {daftar.daftar.map((p) => (
              <option key={p.partNumber} value={p.partNumber}>
                {p.partNumber}
                {p.backNumber ? ` (${p.backNumber})` : ''}
                {p.name ? ` — ${p.name}` : ' — belum di master'} · {p.jumlahKomponen} turunan
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-11 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:bg-surface"
        >
          Buka
        </button>
      </Form>

      {galat ? (
        <p className="mb-4 flex items-start gap-2 rounded-card border border-ng/45 bg-ng/5 px-4 py-3 text-[14px] text-ng">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {galat}
        </p>
      ) : null}

      {!fg && !galat ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          {daftar.daftar.length === 0
            ? 'BOM SAP belum berisi part FG.'
            : 'Pilih part FG untuk melihat seluruh turunannya.'}
        </Card>
      ) : null}

      {pohon?.tersedia && !pohon.ditemukan ? (
        <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">
          {fg} tidak ada di BOM SAP.
        </Card>
      ) : null}

      {pohon?.tersedia && pohon.ditemukan ? (
        <TabelPohonFg
          simpul={pohon.simpul}
          options={options}
          pilihanDariMaster={{
            'process-types': katalog.kode.map((k) => ({ value: k, label: katalog.label(k) })),
          }}
        />
      ) : null}
    </>
  );
}
