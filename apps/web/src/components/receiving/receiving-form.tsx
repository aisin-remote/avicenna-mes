'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { ScanLine, Trash2, Check, AlertCircle, PackagePlus } from 'lucide-react';
import {
  resolveBarcodeAction,
  submitReceiptAction,
  updateReceiptAction,
} from '@/app/(app)/receiving/actions';
import { ImportPanel, type ImportedLine } from './import-panel';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

interface Option {
  value: number;
  label: string;
}

export interface ExistingReceipt {
  id: number;
  documentNumber: string;
  supplierDocNumber: string | null;
  supplierName: string | null;
  lines: Array<{
    id: number;
    partId: number;
    partNumber: string;
    partName: string;
    qty: string;
    uom: string;
    trackingMode: string;
    supplierLotNumber: string | null;
  }>;
}

interface Line {
  key: string;
  /** Terisi untuk baris yang sudah tersimpan; kosong untuk baris baru. */
  existingId?: number;
  partId: number;
  partNumber: string;
  partName: string;
  uom: string;
  trackingMode: string;
  qty: string;
  supplierLotNumber: string;
}

/**
 * Meja penerimaan barang.
 *
 * Alurnya mengikuti kenyataan di gudang: surat jalan supplier dicatat sekali
 * di atas, lalu barangnya discan satu per satu. Fokus dikembalikan ke kolom
 * scan setelah setiap barang masuk, sama seperti stasiun scan produksi —
 * kalau fokus lepas, scan berikutnya hilang tanpa jejak.
 *
 * Baris disimpan di layar dulu, baru dikirim sekali saat ditutup. Satu
 * kedatangan menghasilkan satu dokumen, dan dokumen setengah jadi jauh lebih
 * sulit dibereskan daripada mengulang dari awal.
 */
export function ReceivingForm({
  plants,
  suppliers,
  existing,
}: {
  plants: Option[];
  suppliers: Option[];
  /** Diisi untuk mode ubah. Kosong berarti penerimaan baru. */
  existing?: ExistingReceipt;
}) {
  const editing = Boolean(existing);
  const [plantId, setPlantId] = useState<number | ''>(plants[0]?.value ?? '');
  const [supplierId, setSupplierId] = useState<number | ''>('');
  const [docNumber, setDocNumber] = useState(existing?.supplierDocNumber ?? '');
  const [reason, setReason] = useState('');
  const [code, setCode] = useState('');
  const [lines, setLines] = useState<Line[]>(
    existing
      ? existing.lines.map((l, i) => ({
          key: `exist-${l.id}-${i}`,
          existingId: l.id,
          partId: l.partId,
          partNumber: l.partNumber,
          partName: l.partName,
          uom: l.uom,
          trackingMode: l.trackingMode,
          qty: String(Number(l.qty)),
          supplierLotNumber: l.supplierLotNumber ?? '',
        }))
      : [],
  );
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  const scanRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const seq = useRef(0);

  const focusScan = useCallback(() => {
    scanRef.current?.focus();
    scanRef.current?.select();
  }, []);

  useEffect(() => {
    if (!busy) focusScan();
  }, [busy, focusScan]);

  async function handleScan(raw: string) {
    const value = raw.trim();
    if (!value || busy) return;

    setBusy(true);
    setMessage(null);
    const found = await resolveBarcodeAction(value);
    setCode('');
    setBusy(false);

    if (!found.found || !found.partId) {
      setMessage({ tone: 'bad', text: found.message });
      return;
    }

    // Barang yang sama discan dua kali menambah jumlah, bukan membuat baris
    // baru — di gudang, satu part biasanya datang dalam beberapa kemasan.
    const existing = lines.find((l) => l.partId === found.partId && !l.supplierLotNumber);
    if (existing) {
      setLines((prev) =>
        prev.map((l) =>
          l.key === existing.key ? { ...l, qty: String(Number(l.qty || 0) + 1) } : l,
        ),
      );
      setMessage({ tone: 'ok', text: `${found.partNumber} — jumlah ditambah` });
      return;
    }

    seq.current += 1;
    setLines((prev) => [
      {
        key: `${found.partId}-${seq.current}`,
        partId: found.partId!,
        partNumber: found.partNumber ?? '—',
        partName: found.name ?? '',
        uom: found.uom ?? 'pcs',
        trackingMode: found.trackingMode ?? 'LOT',
        qty: '1',
        supplierLotNumber: '',
      },
      ...prev,
    ]);
    setMessage({ tone: 'ok', text: `${found.partNumber} ditambahkan` });
  }

  /**
   * Menambahkan hasil impor ke daftar.
   *
   * Part yang sudah ada di daftar ditambahkan jumlahnya, bukan dijadikan baris
   * kedua — kecuali nomor lotnya berbeda, karena lot berbeda harus tetap
   * terpisah agar ketertelusurannya tidak hilang.
   */
  function addImported(imported: ImportedLine[]) {
    setLines((prev) => {
      const next = [...prev];
      for (const item of imported) {
        const idx = next.findIndex(
          (l) =>
            l.partId === item.partId &&
            (l.supplierLotNumber || '') === (item.supplierLotNumber || ''),
        );
        if (idx >= 0) {
          next[idx] = { ...next[idx]!, qty: String(Number(next[idx]!.qty || 0) + item.qty) };
          continue;
        }
        seq.current += 1;
        next.unshift({
          key: `${item.partId}-imp-${seq.current}`,
          partId: item.partId,
          partNumber: item.partNumber,
          partName: item.partName,
          uom: item.uom,
          trackingMode: item.trackingMode,
          qty: String(item.qty),
          supplierLotNumber: item.supplierLotNumber ?? '',
        });
      }
      return next;
    });
    setMessage({ tone: 'ok', text: `${imported.length} baris ditambahkan dari impor` });
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  async function submit() {
    if (!editing && (!plantId || !supplierId)) {
      setMessage({ tone: 'bad', text: 'Pabrik dan supplier wajib dipilih.' });
      return;
    }
    if (lines.length === 0) {
      setMessage({ tone: 'bad', text: 'Belum ada barang yang discan.' });
      return;
    }
    const invalid = lines.find((l) => !(Number(l.qty) > 0));
    if (invalid) {
      setMessage({ tone: 'bad', text: `Jumlah ${invalid.partNumber} harus lebih dari nol.` });
      return;
    }

    setSaving(true);
    const payloadLines = lines.map((l) => ({
      id: l.existingId,
      partId: l.partId,
      qty: Number(l.qty),
      uom: l.uom,
      supplierLotNumber: l.supplierLotNumber.trim() || undefined,
    }));

    const res = existing
      ? await updateReceiptAction({
          id: existing.id,
          supplierDocNumber: docNumber.trim() || undefined,
          reason: reason.trim() || undefined,
          lines: payloadLines,
        })
      : await submitReceiptAction({
          plantId: Number(plantId),
          supplierId: Number(supplierId),
          supplierDocNumber: docNumber.trim() || undefined,
          lines: payloadLines.map(({ id: _id, ...rest }) => rest),
        });
    setSaving(false);

    if ('error' in res) {
      setMessage({ tone: 'bad', text: res.error });
      return;
    }
    router.push(`/receiving/${res.id}`);
  }

  const totalQty = lines.reduce((s, l) => s + (Number(l.qty) || 0), 0);

  return (
    <div className="space-y-5">
      {/* ── Identitas kedatangan ─────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[15px] font-bold">Surat jalan</h2>

        {editing ? (
          <>
            <p className="mt-2 text-[13px] text-ink-muted">
              Dokumen {existing!.documentNumber} · {existing!.supplierName ?? '—'}. Pabrik dan
              supplier tidak bisa diubah — buat dokumen baru bila keduanya keliru.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="No. surat jalan supplier">
                <input
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Alasan perubahan">
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="mis. salah hitung saat bongkar"
                  className={inputClass}
                />
              </Field>
            </div>
            <p className="mt-3 text-[13px] text-ink-muted">
              Perubahan dicatat sebagai koreksi. Mutasi stok yang lama tidak dihapus, dan
              selisihnya bisa ditelusuri kapan saja.
            </p>
          </>
        ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Field label="Pabrik" required>
            <select
              value={plantId}
              onChange={(e) => setPlantId(e.target.value ? Number(e.target.value) : '')}
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {plants.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Supplier" required>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {suppliers.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="No. surat jalan supplier">
            <input
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="mis. SJ-2026-0912"
              className={inputClass}
            />
          </Field>
        </div>
        )}
      </section>

      <ImportPanel onImport={addImported} />

      {/* ── Scan barang ──────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <label className="mb-2 block text-[14px] font-semibold">Scan barang</label>
            <div className="relative">
              <ScanLine
                className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-ink-muted"
                strokeWidth={1.8}
                aria-hidden
              />
              <input
                ref={scanRef}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleScan(code);
                  }
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label="Barcode barang"
                placeholder="Fokus di sini lalu scan barcode"
                className="tabular h-14 w-full rounded-2xl border-2 border-line bg-surface pl-12 pr-4 text-[17px] font-semibold outline-none transition-colors duration-200 placeholder:text-[15px] placeholder:font-normal placeholder:text-ink-muted focus:border-ink focus:bg-card"
              />
            </div>
          </div>
          <div className="text-right">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
              Total baris
            </div>
            <div className="tabular mt-1 text-[30px] font-extrabold leading-none">
              {lines.length}
            </div>
          </div>
        </div>

        <AnimatePresence>
          {message ? (
            <motion.p
              key={message.text}
              role="status"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className={cn(
                'mt-3 flex items-center gap-2 text-[14px]',
                message.tone === 'ok' ? 'text-ok' : 'text-ng',
              )}
            >
              {message.tone === 'ok' ? (
                <Check className="size-4 shrink-0" strokeWidth={2.4} aria-hidden />
              ) : (
                <AlertCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              )}
              {message.text}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </section>

      {/* ── Daftar barang ────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">Barang diterima</h2>
          <span className="tabular text-[13px] text-ink-muted">total {totalQty}</span>
        </header>

        {lines.length === 0 ? (
          <p className="px-5 py-14 text-center text-[14px] text-ink-muted">
            Belum ada barang. Scan barcode di atas untuk menambahkan.
          </p>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Part</Th>
                  <Th>Jumlah</Th>
                  <Th>Satuan</Th>
                  <Th>No. lot supplier</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {lines.map((l) => (
                    <motion.tr
                      key={l.key}
                      layout
                      initial={{ opacity: 0, backgroundColor: 'rgba(22,163,74,0.10)' }}
                      animate={{ opacity: 1, backgroundColor: 'rgba(22,163,74,0)' }}
                      exit={{ opacity: 0 }}
                      transition={{ layout: springSoft, backgroundColor: { duration: 1.2 } }}
                      className="border-b border-line last:border-0"
                    >
                      <td className="px-5 py-3">
                        <div className="font-semibold">{l.partNumber}</div>
                        <div className="text-[13px] text-ink-muted">{l.partName}</div>
                      </td>
                      <td className="px-5 py-3">
                        <input
                          value={l.qty}
                          onChange={(e) => updateLine(l.key, { qty: e.target.value })}
                          inputMode="decimal"
                          aria-label={`Jumlah ${l.partNumber}`}
                          className="tabular h-10 w-28 rounded-xl border border-line bg-surface px-3 text-right outline-none focus:border-ink"
                        />
                      </td>
                      <td className="px-5 py-3 text-ink-muted">{l.uom}</td>
                      <td className="px-5 py-3">
                        {l.trackingMode === 'LOT' ? (
                          <input
                            value={l.supplierLotNumber}
                            onChange={(e) =>
                              updateLine(l.key, { supplierLotNumber: e.target.value })
                            }
                            placeholder="opsional"
                            aria-label={`Nomor lot supplier ${l.partNumber}`}
                            className="h-10 w-44 rounded-xl border border-line bg-surface px-3 outline-none focus:border-ink"
                          />
                        ) : (
                          <span className="text-ink-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setLines((prev) => prev.filter((x) => x.key !== l.key));
                            focusScan();
                          }}
                          aria-label={`Hapus ${l.partNumber}`}
                          className="grid size-9 place-items-center rounded-full border border-line text-ink-muted transition-colors hover:border-ng/40 hover:text-ng"
                        >
                          <Trash2 className="size-4" strokeWidth={1.8} aria-hidden />
                        </button>
                      </td>
                    </motion.tr>
                  ))}
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
          <PackagePlus className="size-[18px]" strokeWidth={2.2} aria-hidden />
          {saving ? 'Menyimpan…' : editing ? 'Simpan koreksi' : 'Simpan penerimaan'}
        </motion.button>
      </div>
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-[14px] font-semibold">
        {label}
        {required ? <span className="ml-1 text-ng">*</span> : null}
      </label>
      {children}
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
