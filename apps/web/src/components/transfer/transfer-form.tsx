'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Trash2, Plus, MoveRight } from 'lucide-react';
import type { StockAvailability } from '@avicenna/contracts';
import { availabilityAction, submitTransferAction } from '@/app/(app)/transfer/actions';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

interface Option {
  value: number;
  label: string;
}

interface Line {
  key: string;
  partId: number;
  partNumber: string;
  partName: string;
  uom: string;
  trackingMode: string;
  lotId?: number;
  lotNumber?: string;
  lotRemaining?: number;
  qty: string;
}

/**
 * Formulir pemindahan barang antar line atau lokasi.
 *
 * Stok yang tercatat ditampilkan SEBELUM pengguna menyimpan. Sistem tidak
 * menolak pemindahan yang melebihi catatan — barangnya sudah dipindahkan
 * secara fisik, dan menolak mencatatnya hanya membuat catatan makin jauh dari
 * kenyataan. Karena itu satu-satunya kesempatan orang menyadari ada yang tidak
 * beres adalah melihat angkanya di layar ini, jadi angka itu dibuat menonjol.
 */
export function TransferForm({
  plants,
  lines: lineOptions,
  locations,
  parts,
}: {
  plants: Option[];
  lines: Option[];
  locations: Option[];
  parts: Option[];
}) {
  const [plantId, setPlantId] = useState<number | ''>(plants[0]?.value ?? '');
  const [fromKind, setFromKind] = useState<'line' | 'location'>('location');
  const [toKind, setToKind] = useState<'line' | 'location'>('line');
  const [fromId, setFromId] = useState<number | ''>('');
  const [toId, setToId] = useState<number | ''>('');
  const [note, setNote] = useState('');

  const [partId, setPartId] = useState<number | ''>('');
  const [stock, setStock] = useState<StockAvailability | null>(null);
  const [loadingStock, setLoadingStock] = useState(false);

  const [lines, setLines] = useState<Line[]>([]);
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [seq, setSeq] = useState(0);

  async function pickPart(id: number | '') {
    setPartId(id);
    setStock(null);
    if (!id) return;
    setLoadingStock(true);
    const res = await availabilityAction(Number(id));
    setLoadingStock(false);
    if ('error' in res) {
      toast.galat(res.error);
      return;
    }
    setStock(res);
  }

  function addLine(lotId?: number, lotNumber?: string, remaining?: number) {
    if (!stock) return;
    // Part ber-lot tanpa lot membuat telusurnya putus di titik ini.
    if (stock.trackingMode === 'LOT' && !lotId) {
      toast.galat('Pilih lot yang dipindahkan.');
      return;
    }
    const next = seq + 1;
    setSeq(next);
    setLines((prev) => [
      {
        key: `l-${next}`,
        partId: stock.partId,
        partNumber: stock.partNumber,
        partName: stock.partName,
        uom: stock.uom,
        trackingMode: stock.trackingMode,
        lotId,
        lotNumber,
        lotRemaining: remaining,
        qty: '',
      },
      ...prev,
    ]);
    toast.ok(`${stock.partNumber} ditambahkan`);
  }

  async function submit() {
    if (!plantId) return toast.galat('Pabrik wajib dipilih.');
    if (!fromId) return toast.galat('Asal wajib dipilih.');
    if (!toId) return toast.galat('Tujuan wajib dipilih.');
    if (lines.length === 0) return toast.galat('Belum ada barang.');

    const bad = lines.find((l) => !(Number(l.qty) > 0));
    if (bad) return toast.galat(`Jumlah ${bad.partNumber} harus lebih dari nol.`);

    setSaving(true);
    const res = await submitTransferAction({
      plantId: Number(plantId),
      fromLineId: fromKind === 'line' ? Number(fromId) : undefined,
      fromLocationId: fromKind === 'location' ? Number(fromId) : undefined,
      toLineId: toKind === 'line' ? Number(toId) : undefined,
      toLocationId: toKind === 'location' ? Number(toId) : undefined,
      note: note.trim() || undefined,
      lines: lines.map((l) => ({ partId: l.partId, lotId: l.lotId, qty: Number(l.qty) })),
    });
    setSaving(false);

    if ('error' in res) return toast.galat(res.error);
    router.push(`/transfer/${res.id}`);
  }

  const fromOptions = fromKind === 'line' ? lineOptions : locations;
  const toOptions = toKind === 'line' ? lineOptions : locations;

  return (
    <div className="space-y-5">
      {/* ── Asal & tujuan ────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[15px] font-bold">Asal dan tujuan</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <EndpointPicker
            title="Dari"
            kind={fromKind}
            onKindChange={(k) => {
              setFromKind(k);
              setFromId('');
            }}
            value={fromId}
            onChange={setFromId}
            options={fromOptions}
          />
          <div className="hidden items-end pb-3 lg:flex">
            <ArrowRight className="size-6 text-ink-muted" strokeWidth={1.8} aria-hidden />
          </div>
          <EndpointPicker
            title="Ke"
            kind={toKind}
            onKindChange={(k) => {
              setToKind(k);
              setToId('');
            }}
            value={toId}
            onChange={setToId}
            options={toOptions}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-[14px] font-semibold">Pabrik</label>
            <select
              value={plantId}
              onChange={(e) => setPlantId(e.target.value ? Number(e.target.value) : '')}
              aria-label="Pabrik"
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {plants.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-[14px] font-semibold">Catatan</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="mis. persiapan produksi shift 2"
              className={inputClass}
            />
          </div>
        </div>
      </section>

      {/* ── Pilih barang ─────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[15px] font-bold">Pilih barang</h2>
        <div className="mt-4">
          <label className="mb-2 block text-[14px] font-semibold">Part</label>
          <select
            value={partId}
            onChange={(e) => void pickPart(e.target.value ? Number(e.target.value) : '')}
            aria-label="Part"
            className={cn(inputClass, 'max-w-xl')}
          >
            <option value="">— pilih part —</option>
            {parts.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        {loadingStock ? (
          <p className="mt-4 text-[14px] text-ink-muted">Mengambil stok…</p>
        ) : stock ? (
          <div className="mt-4">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="text-[14px] font-semibold">Stok tercatat</span>
              <span className="tabular text-[24px] font-extrabold">
                {stock.total.toLocaleString('id-ID')}
              </span>
              <span className="text-[14px] text-ink-muted">{stock.uom}</span>
            </div>

            {stock.trackingMode === 'LOT' ? (
              stock.lots.length === 0 ? (
                <p className="mt-3 text-[14px] text-ng">
                  Tidak ada lot dengan sisa stok. Catat penerimaannya lebih dulu.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-[13px] text-ink-muted">
                    Pilih lot yang dipindahkan — urut dari yang paling lama diterima.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {stock.lots.map((l) => (
                      <button
                        key={l.lotId}
                        type="button"
                        onClick={() => addLine(l.lotId, l.lotNumber, l.remaining)}
                        className="group inline-flex items-center gap-2 rounded-2xl border border-line px-4 py-2.5 text-left transition-colors hover:border-ink hover:bg-surface"
                      >
                        <Plus
                          className="size-4 text-ink-muted transition-colors group-hover:text-ink"
                          strokeWidth={2.2}
                          aria-hidden
                        />
                        <span>
                          <span className="tabular block text-[13px] font-semibold">
                            {l.lotNumber}
                          </span>
                          <span className="tabular block text-[12px] text-ink-muted">
                            sisa {l.remaining.toLocaleString('id-ID')} {stock.uom}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            ) : (
              <button
                type="button"
                onClick={() => addLine()}
                className="mt-3 inline-flex h-11 items-center gap-2 rounded-full border border-line px-5 text-[14px] font-semibold transition-colors hover:border-ink hover:bg-surface"
              >
                <Plus className="size-4" strokeWidth={2.4} aria-hidden />
                Tambahkan ke daftar
              </button>
            )}
          </div>
        ) : null}

      </section>

      {/* ── Daftar ───────────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">Barang yang dipindahkan</h2>
          <span className="text-[13px] text-ink-muted">{lines.length} baris</span>
        </header>

        {lines.length === 0 ? (
          <p className="px-5 py-14 text-center text-[14px] text-ink-muted">
            Belum ada barang. Pilih part di atas lalu tambahkan lotnya.
          </p>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Part</Th>
                  <Th>Lot</Th>
                  <Th>Jumlah</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {lines.map((l) => {
                    const over =
                      l.lotRemaining !== undefined && Number(l.qty) > l.lotRemaining;
                    return (
                      <motion.tr
                        key={l.key}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ layout: springSoft }}
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-5 py-3">
                          <div className="font-semibold">{l.partNumber}</div>
                          <div className="text-[13px] text-ink-muted">{l.partName}</div>
                        </td>
                        <td className="tabular px-5 py-3">
                          {l.lotNumber ?? <span className="text-ink-muted">—</span>}
                          {l.lotRemaining !== undefined ? (
                            <div className="tabular text-[13px] text-ink-muted">
                              sisa {l.lotRemaining.toLocaleString('id-ID')}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3">
                          <input
                            value={l.qty}
                            onChange={(e) =>
                              setLines((prev) =>
                                prev.map((x) =>
                                  x.key === l.key ? { ...x, qty: e.target.value } : x,
                                ),
                              )
                            }
                            inputMode="decimal"
                            aria-label={`Jumlah ${l.partNumber}`}
                            className={cn(
                              'tabular h-10 w-32 rounded-xl border bg-surface px-3 text-right outline-none focus:border-ink',
                              over ? 'border-ng' : 'border-line',
                            )}
                          />
                          <span className="ml-2 text-[13px] text-ink-muted">{l.uom}</span>
                          {over ? (
                            <div className="mt-1 text-[12px] text-ng">
                              Melebihi sisa tercatat — tetap bisa disimpan, tapi saldo akan minus.
                            </div>
                          ) : null}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                            aria-label={`Hapus ${l.partNumber}`}
                            className="grid size-9 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ng/40 hover:text-ng"
                          >
                            <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
                          </button>
                        </td>
                      </motion.tr>
                    );
                  })}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <motion.button
          type="button"
          onClick={submit}
          disabled={saving || lines.length === 0}
          whileTap={saving ? undefined : { scale: 0.98 }}
          transition={{ duration: durations.fast, ease: easeSoft }}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <MoveRight className="size-[18px]" strokeWidth={2.2} aria-hidden />
          {saving ? 'Menyimpan…' : 'Simpan pemindahan'}
        </motion.button>
      </div>
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

function EndpointPicker({
  title,
  kind,
  onKindChange,
  value,
  onChange,
  options,
}: {
  title: string;
  kind: 'line' | 'location';
  onKindChange: (k: 'line' | 'location') => void;
  value: number | '';
  onChange: (v: number | '') => void;
  options: Option[];
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="text-[14px] font-semibold">{title}</span>
        <div className="flex gap-1">
          {(['location', 'line'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onKindChange(k)}
              className={cn(
                'rounded-full px-3 py-1 text-[12px] font-semibold transition-colors',
                kind === k ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface',
              )}
            >
              {k === 'location' ? 'Lokasi' : 'Line'}
            </button>
          ))}
        </div>
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
        aria-label={`${title} ${kind === 'line' ? 'line' : 'lokasi'}`}
        className={inputClass}
      >
        <option value="">— pilih —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-5 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </th>
  );
}
