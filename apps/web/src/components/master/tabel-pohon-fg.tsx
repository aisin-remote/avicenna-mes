'use client';

import { useCallback, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, Plus, Trash2, TriangleAlert, X } from 'lucide-react';
import { getEntityDef, SCAN_MODE_LABELS } from '@avicenna/contracts';
import type { BarisRutePart, MasterEntity, ScanMode, SimpulBomFg } from '@avicenna/contracts';
import { deleteMasterAction } from '@/app/(app)/master/actions';
import { MasterForm, type PilihanDariMaster, type RefOptions } from './master-form';
import { useToast } from '../ui/toast';

type IsiFormulir = {
  entity: MasterEntity;
  row?: Record<string, unknown> & { id: number };
  nilaiAwal?: Record<string, unknown>;
};

const JUDUL = ['Part', 'Qty', 'BOM SAP', 'Rute proses'];

const LABEL_SOURCE: Record<string, string> = { E: 'Buatan sendiri', F: 'Beli' };

/** Pohon satu FG. Susunan dan kolom BOM hanya dibaca; part dan rutenya bisa disunting. */
export function TabelPohonFg({
  simpul,
  options,
  pilihanDariMaster,
}: {
  simpul: SimpulBomFg[];
  options: RefOptions;
  pilihanDariMaster: PilihanDariMaster;
}) {
  const [form, setForm] = useState<IsiFormulir | null>(null);
  const [terbuka, setTerbuka] = useState(false);
  // Kunci MasterForm: useActionState menyimpan hasil terakhir, dan tanpa remount
  // `ok` lama langsung menutup panel yang baru dibuka.
  const [formKey, setFormKey] = useState(0);
  const tutup = useCallback(() => setTerbuka(false), []);
  const [konfirmasi, setKonfirmasi] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const pabrikAkar = simpul[0]?.part?.plantId;

  function buka(isi: IsiFormulir) {
    setForm(isi);
    setFormKey((k) => k + 1);
    setTerbuka(true);
  }

  function hapus(entity: MasterEntity, id: number) {
    const fd = new FormData();
    fd.set('__entity', entity);
    fd.set('__id', String(id));
    startTransition(async () => {
      const res = await deleteMasterAction({}, fd);
      if (res.error) {
        toast.galat(res.error, `${getEntityDef(entity).singular} tidak terhapus`);
        return;
      }
      setKonfirmasi(null);
      toast.ok(`${getEntityDef(entity).singular} dihapus.`);
      router.refresh();
    });
  }

  /** SLOC di BOM berupa kode; formulir rute memilih baris lokasi milik pabrik part. */
  function lokasiDariKode(kode: string | null, plantId: number) {
    if (!kode) return undefined;
    return options.locations?.find((o) => o.short === kode && o.plantId === plantId)?.value;
  }

  function tambahPart(s: SimpulBomFg) {
    buka({
      entity: 'parts',
      nilaiAwal: {
        plantId: pabrikAkar,
        partNumber: s.partNumberMaster,
        uom: s.uom,
        sourceType: s.source === 'F' ? 'PURCHASED' : 'MANUFACTURED',
        partType: s.kedalaman === 0 ? 'FINISHED_GOOD' : s.source === 'F' ? 'COMPONENT' : 'WIP',
      },
    });
  }

  function tambahRute(s: SimpulBomFg) {
    if (!s.part) return;
    buka({
      entity: 'part-processes',
      nilaiAwal: {
        plantId: s.part.plantId,
        partId: s.part.id,
        seqNo: (s.rute.length + 1) * 10,
        outputLocationId: lokasiDariKode(s.sloc, s.part.plantId),
      },
    });
  }

  return (
    <>
      <div className="scroll-slim overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              {JUDUL.map((j) => (
                <th
                  key={j}
                  scope="col"
                  className="whitespace-nowrap border-b border-line px-4 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-muted"
                >
                  {j}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {simpul.map((s) => (
              <tr key={s.kunci}>
                <td
                  className="min-w-[320px] border-b border-line py-3 pr-4 align-top"
                  style={{ paddingLeft: `${16 + s.kedalaman * 20}px` }}
                >
                  <div className="tabular whitespace-nowrap font-semibold text-ink">
                    {s.partNumber}
                    {s.part?.backNumber ? ` (${s.part.backNumber})` : ''}
                  </div>
                  {s.part ? (
                    <>
                      <div className="text-[13px] text-ink-soft">{s.part.name}</div>
                      <div className="text-[12px] text-ink-muted">
                        PV {s.part.productionVersion ?? 'kosong'}
                      </div>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <TombolKecil
                          label={`Ubah part ${s.partNumber}`}
                          onClick={() => buka({ entity: 'parts', row: s.part! })}
                        >
                          <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
                        </TombolKecil>
                        <Hapus
                          nama={`part ${s.partNumber}`}
                          terbuka={konfirmasi === `part-${s.kunci}`}
                          pending={pending}
                          onMinta={() => setKonfirmasi(`part-${s.kunci}`)}
                          onBatal={() => setKonfirmasi(null)}
                          onYa={() => hapus('parts', s.part!.id)}
                        />
                      </div>
                    </>
                  ) : s.phantom ? (
                    <div className="text-[13px] text-ink-muted">Phantom, tidak distok</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => tambahPart(s)}
                      className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-warn underline"
                    >
                      <Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
                      Belum di master, tambahkan
                    </button>
                  )}
                </td>
                <td className="tabular whitespace-nowrap border-b border-line px-4 py-3 align-top text-ink-soft">
                  {s.qty ?? '—'} {s.uom ?? ''}
                </td>
                <td className="whitespace-nowrap border-b border-line px-4 py-3 align-top text-ink-soft">
                  <div>{s.source ? (LABEL_SOURCE[s.source] ?? s.source) : '—'}</div>
                  <div className="text-[12px] text-ink-muted">SLOC {s.sloc ?? 'kosong'}</div>
                </td>
                <td className="min-w-[420px] border-b border-line px-4 py-3 align-top">
                  <div className="space-y-2">
                    {s.rute.map((r) => (
                      <BarisRute
                        key={r.id}
                        rute={r}
                        terbukaHapus={konfirmasi === `rute-${s.kunci}-${r.id}`}
                        pending={pending}
                        onUbah={() =>
                          buka({
                            entity: 'part-processes',
                            row: r as unknown as Record<string, unknown> & { id: number },
                          })
                        }
                        onMintaHapus={() => setKonfirmasi(`rute-${s.kunci}-${r.id}`)}
                        onBatalHapus={() => setKonfirmasi(null)}
                        onHapus={() => hapus('part-processes', r.id)}
                      />
                    ))}
                    {s.part ? (
                      <button
                        type="button"
                        onClick={() => tambahRute(s)}
                        className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-soft underline hover:text-ink"
                      >
                        <Plus className="size-3.5" strokeWidth={2.2} aria-hidden />
                        Tambah rute
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form ? (
        <MasterForm
          key={formKey}
          def={getEntityDef(form.entity)}
          entity={form.entity}
          row={form.row ?? null}
          nilaiAwal={form.nilaiAwal}
          options={options}
          pilihanDariMaster={pilihanDariMaster}
          open={terbuka}
          onClose={tutup}
        />
      ) : null}
    </>
  );
}

function BarisRute({
  rute: r,
  terbukaHapus,
  pending,
  onUbah,
  onMintaHapus,
  onBatalHapus,
  onHapus,
}: {
  rute: BarisRutePart;
  terbukaHapus: boolean;
  pending: boolean;
  onUbah: () => void;
  onMintaHapus: () => void;
  onBatalHapus: () => void;
  onHapus: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[13px]">
          <div className="font-semibold text-ink">
            {r.workCenter ?? r.lineCode ?? 'Work center kosong'}
            {r.isPrimary ? ' · Utama' : ''}
            {r.isActive ? '' : ' · Non-aktif'}
          </div>
          <div className="text-ink-soft">
            {r.inputLocationCode ?? '—'} → {r.outputLocationCode ?? '—'}
            {r.transferLocationCode ? ` → ${r.transferLocationCode}` : ''}
          </div>
          <div className="text-[12px] text-ink-muted">
            {r.scanMode ? (SCAN_MODE_LABELS[r.scanMode as ScanMode] ?? r.scanMode) : 'Mode kosong'}
            {' · '}SAP {r.sapProductionEnabled ? 'ya' : 'tidak'}
            {r.requirePairing ? ' · Wajib belanja' : ''}
            {' · '}Seq {r.seqNo}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <TombolKecil label={`Ubah rute ${r.workCenter ?? r.seqNo}`} onClick={onUbah}>
            <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
          </TombolKecil>
          <Hapus
            nama={`rute ${r.workCenter ?? r.seqNo}`}
            terbuka={terbukaHapus}
            pending={pending}
            onMinta={onMintaHapus}
            onBatal={onBatalHapus}
            onYa={onHapus}
          />
        </div>
      </div>
      {r.masalah.length > 0 ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] text-warn">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" strokeWidth={2} aria-hidden />
          {r.masalah.join(' · ')}
        </p>
      ) : null}
    </div>
  );
}

function TombolKecil({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center rounded-full border border-line bg-card text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
    >
      {children}
    </button>
  );
}

function Hapus({
  nama,
  terbuka,
  pending,
  onMinta,
  onBatal,
  onYa,
}: {
  nama: string;
  terbuka: boolean;
  pending: boolean;
  onMinta: () => void;
  onBatal: () => void;
  onYa: () => void;
}) {
  if (!terbuka) {
    return (
      <TombolKecil label={`Hapus ${nama}`} onClick={onMinta}>
        <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
      </TombolKecil>
    );
  }
  return (
    <>
      <span className="text-[12px] text-ink-muted">Hapus?</span>
      <button
        type="button"
        onClick={onYa}
        disabled={pending}
        aria-label={`Ya, hapus ${nama}`}
        className="grid size-8 place-items-center rounded-full bg-ng text-white transition-colors hover:opacity-90 disabled:opacity-50"
      >
        <Check className="size-3.5" strokeWidth={2.4} aria-hidden />
      </button>
      <TombolKecil label="Batal" onClick={onBatal}>
        <X className="size-3.5" strokeWidth={2.2} aria-hidden />
      </TombolKecil>
    </>
  );
}
