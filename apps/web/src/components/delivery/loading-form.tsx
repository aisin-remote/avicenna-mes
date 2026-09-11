'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, Plus, AlertCircle, Check, Truck, AlertTriangle } from 'lucide-react';
import { catalogAction, submitLoadingAction } from '@/app/(app)/delivery/actions';
import type { CatalogPart } from '@/lib/loading-api';
import { springSoft, durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

interface Option {
  value: number;
  label: string;
}

interface Line {
  key: string;
  partId: number;
  partNumber: string;
  partName: string;
  customerPartId: number | null;
  customerPartNumber: string | null;
  qtyPerKanban: string;
  plannedKanban: string;
}

const todayKey = () => {
  // Kunci tanggal dibentuk dari komponen waktu setempat. toISOString() akan
  // menggeser tanggal satu hari di UTC+7 untuk jam-jam sore.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Formulir loading list.
 *
 * Rencana muat disusun dalam KANBAN, bukan pcs — itulah satuan yang dipegang
 * orang di lapangan: satu kartu sama dengan satu kemasan. Jumlah pcs-nya
 * ditampilkan sebagai hasil hitungan supaya tetap terlihat, tapi bukan yang
 * diketik.
 */
export function LoadingForm({
  plants,
  customers,
  locations,
}: {
  plants: Option[];
  customers: Option[];
  locations: Option[];
}) {
  const [plantId, setPlantId] = useState<number | ''>(plants[0]?.value ?? '');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [pdsNumber, setPdsNumber] = useState('');
  /*
   * Tanggal hari ini diisi SETELAH komponen terpasang, bukan saat render
   * pertama. Server bisa berjalan di zona waktu UTC sementara browser di
   * UTC+7: pada sore hari keduanya menghasilkan tanggal yang berbeda, dan
   * hasil render server tidak akan cocok dengan hasil render klien.
   */
  const [deliveryDate, setDeliveryDate] = useState('');
  useEffect(() => {
    setDeliveryDate((v) => v || todayKey());
  }, []);
  const [cycle, setCycle] = useState('1');
  const [dock, setDock] = useState('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [stagingLocationId, setStagingLocationId] = useState<number | ''>('');
  const [truckNumber, setTruckNumber] = useState('');
  const [driverName, setDriverName] = useState('');

  const [catalog, setCatalog] = useState<CatalogPart[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [pickPartId, setPickPartId] = useState<number | ''>('');

  const [lines, setLines] = useState<Line[]>([]);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [seq, setSeq] = useState(0);
  const router = useRouter();

  async function pickCustomer(id: number | '') {
    setCustomerId(id);
    setCatalog([]);
    setLines([]);
    setPickPartId('');
    if (!id || !plantId) return;
    setLoadingCatalog(true);
    const res = await catalogAction(Number(id), Number(plantId));
    setLoadingCatalog(false);
    if ('error' in res) {
      setMessage({ tone: 'bad', text: res.error });
      return;
    }
    setCatalog(res);
  }

  function addLine(id: number | '') {
    setPickPartId('');
    if (!id) return;
    const part = catalog.find((c) => c.partId === Number(id));
    if (!part) return;
    if (lines.some((l) => l.partId === part.partId)) {
      setMessage({ tone: 'bad', text: `${part.partNumber} sudah ada di daftar.` });
      return;
    }
    const next = seq + 1;
    setSeq(next);
    setLines((prev) => [
      ...prev,
      {
        key: `l-${next}`,
        partId: part.partId,
        partNumber: part.partNumber,
        partName: part.partName,
        customerPartId: part.customerPartId,
        customerPartNumber: part.customerPartNumber,
        qtyPerKanban: String(part.qtyPerKanban || ''),
        plannedKanban: '',
      },
    ]);
    setMessage({ tone: 'ok', text: `${part.partNumber} ditambahkan` });
  }

  function patch(key: string, changes: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...changes } : l)));
  }

  async function submit() {
    if (!plantId) return setMessage({ tone: 'bad', text: 'Pabrik wajib dipilih.' });
    if (!customerId) return setMessage({ tone: 'bad', text: 'Customer wajib dipilih.' });
    if (!deliveryDate) return setMessage({ tone: 'bad', text: 'Tanggal kirim wajib diisi.' });
    if (lines.length === 0) return setMessage({ tone: 'bad', text: 'Belum ada part yang dimuat.' });

    const bad = lines.find((l) => !(Number(l.plannedKanban) > 0));
    if (bad) {
      return setMessage({
        tone: 'bad',
        text: `Jumlah kanban ${bad.partNumber} harus lebih dari nol.`,
      });
    }
    const noQty = lines.find((l) => !(Number(l.qtyPerKanban) > 0));
    if (noQty) {
      return setMessage({
        tone: 'bad',
        text: `Isi per kanban untuk ${noQty.partNumber} belum diisi.`,
      });
    }

    setSaving(true);
    const res = await submitLoadingAction({
      plantId: Number(plantId),
      customerId: Number(customerId),
      pdsNumber: pdsNumber.trim() || undefined,
      cycle: Number(cycle) || 1,
      dock: dock.trim() || undefined,
      locationId: locationId ? Number(locationId) : undefined,
      stagingLocationId: stagingLocationId ? Number(stagingLocationId) : undefined,
      deliveryDate,
      truckNumber: truckNumber.trim() || undefined,
      driverName: driverName.trim() || undefined,
      lines: lines.map((l) => ({
        partId: l.partId,
        customerPartId: l.customerPartId ?? undefined,
        plannedKanban: Number(l.plannedKanban),
        qtyPerKanban: Number(l.qtyPerKanban),
      })),
    });
    setSaving(false);

    if ('error' in res) return setMessage({ tone: 'bad', text: res.error });
    router.push(`/delivery/${res.id}`);
  }

  const unmapped = lines.filter((l) => !l.customerPartNumber).length;
  const totalKanban = lines.reduce((s, l) => s + (Number(l.plannedKanban) || 0), 0);
  const totalQty = lines.reduce(
    (s, l) => s + (Number(l.plannedKanban) || 0) * (Number(l.qtyPerKanban) || 0),
    0,
  );

  return (
    <div className="space-y-5">
      {/* ── Kepala dokumen ──────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card p-5">
        <h2 className="text-[15px] font-bold">Dokumen</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Pabrik">
            <select
              value={plantId}
              onChange={(e) => {
                setPlantId(e.target.value ? Number(e.target.value) : '');
                setCatalog([]);
                setLines([]);
                setCustomerId('');
              }}
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
          </Field>

          <Field label="Customer">
            <select
              value={customerId}
              onChange={(e) => void pickCustomer(e.target.value ? Number(e.target.value) : '')}
              aria-label="Customer"
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {customers.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nomor PDS" hint="rujukan dokumen customer, boleh kosong">
            <input
              value={pdsNumber}
              onChange={(e) => setPdsNumber(e.target.value)}
              placeholder="mis. PDS-00123"
              aria-label="Nomor PDS"
              className={inputClass}
            />
          </Field>

          <Field label="Tanggal kirim">
            <input
              type="date"
              value={deliveryDate}
              onChange={(e) => setDeliveryDate(e.target.value)}
              aria-label="Tanggal kirim"
              className={inputClass}
            />
          </Field>

          <Field label="Rit / cycle">
            <input
              value={cycle}
              onChange={(e) => setCycle(e.target.value)}
              inputMode="numeric"
              aria-label="Rit"
              className={cn(inputClass, 'tabular')}
            />
          </Field>

          <Field label="Dock">
            <input
              value={dock}
              onChange={(e) => setDock(e.target.value)}
              placeholder="mis. D1"
              aria-label="Dock"
              className={inputClass}
            />
          </Field>

          <Field label="SLOC asal" hint="gudang barang jadi, tempat barang diambil saat pulling">
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
              aria-label="SLOC asal"
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {locations.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="SLOC staging" hint="tempat barang menunggu truk; stok di sinilah yang berkurang saat berangkat">
            <select
              value={stagingLocationId}
              onChange={(e) => setStagingLocationId(e.target.value ? Number(e.target.value) : '')}
              aria-label="SLOC staging"
              className={inputClass}
            >
              <option value="">— pilih —</option>
              {locations.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nomor truk">
            <input
              value={truckNumber}
              onChange={(e) => setTruckNumber(e.target.value)}
              placeholder="mis. B 1234 XYZ"
              aria-label="Nomor truk"
              className={inputClass}
            />
          </Field>

          <Field label="Nama sopir">
            <input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              aria-label="Nama sopir"
              className={inputClass}
            />
          </Field>
        </div>
      </section>

      {/* ── Rencana muat ────────────────────────────────────────────────── */}
      <section className="rounded-card border border-line bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">Rencana muat</h2>
          <span className="tabular text-[13px] text-ink-muted">
            {lines.length} part · {totalKanban.toLocaleString('id-ID')} kanban ·{' '}
            {totalQty.toLocaleString('id-ID')} pcs
          </span>
        </header>

        <div className="border-b border-line px-5 py-4">
          {!customerId ? (
            <p className="text-[14px] text-ink-muted">Pilih customer dulu untuk melihat partnya.</p>
          ) : loadingCatalog ? (
            <p className="text-[14px] text-ink-muted">Mengambil daftar part…</p>
          ) : (
            <div className="max-w-xl">
              <label className="mb-2 block text-[14px] font-semibold">Tambah part</label>
              <select
                value={pickPartId}
                onChange={(e) => addLine(e.target.value ? Number(e.target.value) : '')}
                aria-label="Tambah part"
                className={inputClass}
              >
                <option value="">— pilih part —</option>
                {catalog.map((c) => (
                  <option key={c.partId} value={c.partId}>
                    {c.partNumber} — {c.partName}
                    {c.customerPartNumber ? ` (${c.customerPartNumber})` : ' (belum dipetakan)'}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="px-5 py-14 text-center text-[14px] text-ink-muted">
            Belum ada part. Pilih dari daftar di atas.
          </p>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <Th>Part</Th>
                  <Th>No. Customer</Th>
                  <Th>Isi / kanban</Th>
                  <Th>Kanban</Th>
                  <Th>Total pcs</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                <AnimatePresence initial={false}>
                  {lines.map((l) => (
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
                        {l.customerPartNumber ?? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] text-warn">
                            <AlertTriangle className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
                            belum dipetakan
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <input
                          value={l.qtyPerKanban}
                          onChange={(e) => patch(l.key, { qtyPerKanban: e.target.value })}
                          inputMode="numeric"
                          aria-label={`Isi per kanban ${l.partNumber}`}
                          className={numClass}
                        />
                      </td>
                      <td className="px-5 py-3">
                        <input
                          value={l.plannedKanban}
                          onChange={(e) => patch(l.key, { plannedKanban: e.target.value })}
                          inputMode="numeric"
                          aria-label={`Jumlah kanban ${l.partNumber}`}
                          className={numClass}
                        />
                      </td>
                      <td className="tabular px-5 py-3 font-semibold">
                        {(
                          (Number(l.plannedKanban) || 0) * (Number(l.qtyPerKanban) || 0)
                        ).toLocaleString('id-ID')}
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
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Peringatan ini muncul SEBELUM truk datang, bukan saat scan gagal. */}
      {unmapped > 0 ? (
        <p className="flex items-start gap-2 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          <span>
            {unmapped} part belum punya penomoran customer. Barangnya tetap bisa dikirim, tapi
            barcode kanban customer tidak akan cocok otomatis saat muat — petugas harus memilih
            partnya manual. Lengkapi di master Part bila ingin bisa discan.
          </span>
        </p>
      ) : null}

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
              'flex items-center gap-2 text-[14px]',
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

      <div className="flex justify-end">
        <motion.button
          type="button"
          onClick={submit}
          disabled={saving || lines.length === 0}
          whileTap={saving ? undefined : { scale: 0.98 }}
          transition={{ duration: durations.fast, ease: easeSoft }}
          className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-7 text-[15px] font-semibold text-white transition-colors hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Truck className="size-[18px]" strokeWidth={2.2} aria-hidden />
          {saving ? 'Menyimpan…' : 'Simpan loading list'}
        </motion.button>
      </div>
    </div>
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card';

const numClass =
  'tabular h-10 w-28 rounded-xl border border-line bg-surface px-3 text-right outline-none focus:border-ink';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-[14px] font-semibold">{label}</label>
      {children}
      {hint ? <p className="mt-1.5 text-[12px] text-ink-muted">{hint}</p> : null}
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
