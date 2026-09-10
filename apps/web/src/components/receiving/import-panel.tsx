'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ClipboardPaste, ChevronDown, AlertCircle, Plus } from 'lucide-react';
import { parseImportRows, mergeByPart, type ParsedImportRow } from '@avicenna/domain';
import type { ResolvedPart } from '@avicenna/contracts';
import { resolveBulkAction } from '@/app/(app)/receiving/actions';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

export interface ImportedLine {
  partId: number;
  partNumber: string;
  partName: string;
  uom: string;
  trackingMode: string;
  qty: number;
  supplierLotNumber?: string;
}

interface PreviewRow extends ParsedImportRow {
  resolved?: ResolvedPart;
}

/**
 * Impor massal dengan menempel dari Excel.
 *
 * Pengguna memilih baris di Excel, menyalin, lalu menempelkannya di sini —
 * tidak perlu menyimpan sebagai CSV maupun mengunggah berkas.
 *
 * Hasil pembacaan SELALU ditampilkan sebagai pratinjau sebelum masuk daftar.
 * Angka bergaya Indonesia dan Inggris tidak selalu bisa dibedakan secara pasti
 * ("1.000" bisa berarti seribu atau satu koma nol), jadi orang yang menempel
 * harus melihat hasil bacanya lebih dulu. Pratinjau inilah pengamannya, bukan
 * kepintaran parsernya.
 */
export function ImportPanel({ onImport }: { onImport: (lines: ImportedLine[]) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<PreviewRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    const parsed = mergeByPart(parseImportRows(text));
    if (parsed.length === 0) {
      setRows([]);
      return;
    }

    setBusy(true);
    const lookup = await resolveBulkAction(
      parsed.filter((r) => !r.error).map((r) => r.partNumber),
    );
    setBusy(false);

    setRows(parsed.map((r) => ({ ...r, resolved: lookup[r.partNumber] })));
  }

  const valid = (rows ?? []).filter((r) => !r.error && r.resolved?.found);
  const invalid = (rows ?? []).filter((r) => r.error || !r.resolved?.found);

  function addValid() {
    onImport(
      valid.map((r) => ({
        partId: r.resolved!.partId!,
        partNumber: r.resolved!.partNumber!,
        partName: r.resolved!.name ?? '',
        uom: r.uom || r.resolved!.uom || 'pcs',
        trackingMode: r.resolved!.trackingMode ?? 'LOT',
        qty: r.qty,
        supplierLotNumber: r.supplierLotNumber,
      })),
    );
    setText('');
    setRows(null);
    setOpen(false);
  }

  return (
    <section className="rounded-card border border-line bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <ClipboardPaste className="size-[18px] text-ink-muted" strokeWidth={1.8} aria-hidden />
        <span className="flex-1 text-[15px] font-bold">Impor dari Excel</span>
        <span className="text-[13px] text-ink-muted">
          Salin baris di Excel lalu tempel di sini
        </span>
        <motion.span
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: durations.base, ease: easeSoft }}
        >
          <ChevronDown className="size-4 text-ink-muted" strokeWidth={2} aria-hidden />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="overflow-hidden border-t border-line"
          >
            <div className="space-y-4 px-5 py-5">
              <div>
                <label htmlFor="import-text" className="mb-2 block text-[14px] font-semibold">
                  Tempel di sini
                </label>
                <textarea
                  id="import-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                  spellCheck={false}
                  placeholder={'CMP-B-001\t500\tpcs\tSL-77\nRM-D-001\t250\tkg'}
                  className="tabular w-full rounded-2xl border border-line bg-surface p-4 font-mono text-[13px] outline-none transition-colors focus:border-line-strong focus:bg-card"
                />
                <p className="mt-2 text-[13px] text-ink-muted">
                  Urutan kolom: part number, jumlah, satuan (opsional), nomor lot supplier
                  (opsional). Baris judul otomatis dilewati.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={preview}
                  disabled={busy || !text.trim()}
                  className="h-11 rounded-full border border-line bg-card px-5 text-[14px] font-semibold transition-colors hover:border-line-strong hover:bg-surface disabled:opacity-50"
                >
                  {busy ? 'Membaca…' : 'Baca & periksa'}
                </button>
                {valid.length > 0 ? (
                  <button
                    type="button"
                    onClick={addValid}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
                  >
                    <Plus className="size-4" strokeWidth={2.4} aria-hidden />
                    Tambahkan {valid.length} baris
                  </button>
                ) : null}
              </div>

              {rows ? (
                rows.length === 0 ? (
                  <p className="text-[14px] text-ink-muted">
                    Tidak ada baris yang terbaca dari tempelan itu.
                  </p>
                ) : (
                  <div className="scroll-slim overflow-x-auto rounded-2xl border border-line">
                    <table className="w-full text-[13px]">
                      <thead>
                        <tr className="border-b border-line text-left">
                          <th className="px-4 py-2.5 font-semibold text-ink-muted">Baris</th>
                          <th className="px-4 py-2.5 font-semibold text-ink-muted">Part</th>
                          <th className="px-4 py-2.5 text-right font-semibold text-ink-muted">
                            Terbaca sebagai
                          </th>
                          <th className="px-4 py-2.5 font-semibold text-ink-muted">Satuan</th>
                          <th className="px-4 py-2.5 font-semibold text-ink-muted">Lot</th>
                          <th className="px-4 py-2.5 font-semibold text-ink-muted">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => {
                          const bad = Boolean(r.error) || !r.resolved?.found;
                          return (
                            <tr
                              key={`${r.lineNumber}-${i}`}
                              className={cn('border-b border-line last:border-0', bad && 'bg-ng/5')}
                            >
                              <td className="tabular px-4 py-2.5 text-ink-muted">{r.lineNumber}</td>
                              <td className="px-4 py-2.5">
                                <div className="font-semibold">{r.partNumber || '—'}</div>
                                {r.resolved?.found ? (
                                  <div className="text-ink-muted">{r.resolved.name}</div>
                                ) : null}
                              </td>
                              <td className="tabular px-4 py-2.5 text-right font-semibold">
                                {r.error ? '—' : r.qty.toLocaleString('id-ID')}
                              </td>
                              <td className="px-4 py-2.5 text-ink-muted">
                                {r.uom || r.resolved?.uom || '—'}
                              </td>
                              <td className="px-4 py-2.5 text-ink-muted">
                                {r.supplierLotNumber ?? '—'}
                              </td>
                              <td className="px-4 py-2.5">
                                {bad ? (
                                  <span className="inline-flex items-center gap-1.5 text-ng">
                                    <AlertCircle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                                    {r.error ?? r.resolved?.message ?? 'Tidak ditemukan'}
                                  </span>
                                ) : (
                                  <span className="text-ok">Siap</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}

              {invalid.length > 0 ? (
                <p className="text-[13px] text-ink-muted">
                  {invalid.length} baris bermasalah tidak akan ikut ditambahkan. Perbaiki di Excel
                  lalu tempel ulang, atau tambahkan part-nya dulu di Master Part.
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
