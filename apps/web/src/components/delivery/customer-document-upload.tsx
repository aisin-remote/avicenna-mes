'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  DELIVERY_DOCUMENT_KINDS,
  DELIVERY_DOCUMENT_LABELS,
  MAX_DELIVERY_DOCUMENT_BYTES,
  type DeliveryDocumentFile,
  type KanbanCropProfile,
} from '@avicenna/contracts';
import {
  documentUploadTargetAction,
  resolveDocumentUploadAction,
  uploadDeliveryDocumentAction,
} from '@/app/(app)/kanban/actions';
import { cutCustomerKanban } from '@/lib/customer-pdf';
import { useToast } from '../ui/toast';

export interface DocumentUploadTarget {
  id: number;
  documentNumber: string;
  pdsNumber: string | null;
  deliveryDate: string;
  customerId: number;
  customerName: string | null;
}
export function CustomerDocumentUpload({
  profiles,
  initialTarget,
  initialKind,
}: {
  profiles: KanbanCropProfile[];
  initialTarget: DocumentUploadTarget | null;
  initialKind: DeliveryDocumentFile['kind'];
}) {
  const toast = useToast();
  const [target, setTarget] = useState(initialTarget);
  const [code, setCode] = useState(initialTarget?.documentNumber ?? '');
  const [matches, setMatches] = useState<
    Array<{ id: number; documentNumber: string; customerName: string | null }>
  >([]);
  const [kind, setKind] = useState(initialKind);
  const [file, setFile] = useState<File | null>(null);
  const [alreadyCut, setAlreadyCut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const profile = profiles.find((p) => p.customerId === target?.customerId);
  async function choose(id: number) {
    const result = await documentUploadTargetAction(id);
    if ('error' in result) return toast.galat(result.error ?? 'Dokumen belum dapat dibuka.');
    setTarget(result.data);
    setMatches([]);
    setSaved(null);
  }
  async function resolve() {
    setBusy(true);
    try {
      const result = await resolveDocumentUploadAction(code.trim());
      if ('error' in result) return toast.galat(result.error ?? 'Dokumen belum dapat dicari.');
      if (result.matches.length === 1) await choose(result.matches[0]!.id);
      else {
        setMatches(result.matches);
        setTarget(null);
      }
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    if (!target || !file || busy) return;
    if (!file.size || file.size > MAX_DELIVERY_DOCUMENT_BYTES)
      return toast.galat('Pilih PDF maksimal 20 MB.');
    setBusy(true);
    setSaved(null);
    try {
      const raw = await file.arrayBuffer();
      let uploadFile = file;
      if (kind === 'CUSTOMER_KANBAN' && !alreadyCut) {
        if (!profile?.configured)
          return toast.galat(
            'Simpan master garis potong customer terlebih dulu, atau pilih PDF yang sudah dipotong.',
          );
        const result = await cutCustomerKanban(raw, profile);
        uploadFile = new File(
          [result.bytes as BlobPart],
          `${file.name.replace(/\.pdf$/i, '').slice(0, 240)}-cut.pdf`,
          { type: 'application/pdf' },
        );
      } else {
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.load(raw);
        if (!pdf.getPageCount()) throw Error('PDF tidak mempunyai halaman.');
      }
      const form = new FormData();
      form.set('file', uploadFile);
      form.set('kind', kind);
      form.set('deliveryId', String(target.id));
      const result = await uploadDeliveryDocumentAction(form);
      if ('error' in result) return toast.galat(result.error ?? 'PDF belum dapat disimpan.');
      setSaved(result.id);
      toast.ok(
        result.alreadyStored
          ? 'File yang sama sudah ada di arsip PDS ini.'
          : `${DELIVERY_DOCUMENT_LABELS[kind]} tersimpan di arsip.`,
      );
    } catch (error) {
      toast.galat(error instanceof Error ? error.message : 'PDF tidak dapat diproses.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mb-6 rounded-card border border-line bg-card p-5 sm:p-6">
      <h2 className="text-lg font-bold">Upload dokumen customer ke PDS</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Arsip PDF portal customer untuk dicetak dari Preparation Monitoring.
      </p>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void resolve();
        }}
      >
        <label htmlFor="upload-document-code" className="sr-only">
          PDS, manifest, atau loading list
        </label>
        <input
          id="upload-document-code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={busy}
          placeholder="Cari PDS / manifest / loading list…"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-3 text-sm"
        />
        <button
          disabled={busy || !code.trim()}
          className="rounded-xl border border-line px-4 py-3 text-sm font-semibold disabled:opacity-50"
        >
          Cari dokumen
        </button>
      </form>
      {matches.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {matches.map((m) => (
            <button
              key={m.id}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void choose(m.id).finally(() => setBusy(false));
              }}
              className="rounded-xl border border-line px-3 py-2 text-left text-sm"
            >
              {m.documentNumber} · {m.customerName}
            </button>
          ))}
        </div>
      ) : null}
      {target ? (
        <>
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-3 text-sm">
            <strong>{target.customerName}</strong>
            <p>
              {target.documentNumber} · PDS {target.pdsNumber ?? 'belum tersedia'}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Gunakan PDF untuk PDS yang dipilih. Pisahkan PDF yang memuat beberapa PDS sebelum
              upload.
            </p>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">
              Jenis dokumen
              <select
                value={kind}
                disabled={busy}
                onChange={(e) => {
                  setKind(e.target.value as typeof kind);
                  setFile(null);
                  setSaved(null);
                }}
                className="mt-2 w-full rounded-xl border border-line bg-surface px-3 py-3"
              >
                {DELIVERY_DOCUMENT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {DELIVERY_DOCUMENT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-semibold">
              PDF portal customer (maks. 20 MB)
              <input
                key={kind}
                type="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setSaved(null);
                }}
                className="mt-2 block w-full rounded-xl border border-line p-2 text-sm"
              />
            </label>
          </div>
          {kind === 'CUSTOMER_KANBAN' ? (
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={alreadyCut}
                disabled={busy}
                onChange={(e) => setAlreadyCut(e.target.checked)}
              />
              PDF kanban ini sudah dipotong
            </label>
          ) : (
            <p className="mt-3 text-xs text-ink-muted">
              PDF manifest dan skid label disimpan dengan seluruh halaman dan ukuran aslinya.
            </p>
          )}
          {kind === 'CUSTOMER_KANBAN' && !alreadyCut ? (
            <p className="mt-2 text-xs text-ink-muted">
              Pemotongan memakai master tersimpan untuk{' '}
              {profile?.customerName ?? target.customerName}. Atur garisnya pada Master pemotongan
              di bawah.
            </p>
          ) : null}
          <button
            type="button"
            disabled={busy || !file}
            onClick={() => void upload()}
            className="mt-4 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy
              ? 'Memproses…'
              : kind === 'CUSTOMER_KANBAN' && !alreadyCut
                ? 'Potong & simpan arsip'
                : 'Upload & simpan arsip'}
          </button>
          {saved ? (
            <p role="status" className="mt-4 text-sm text-emerald-500">
              Tersimpan.{' '}
              <Link
                className="font-semibold underline"
                href={`/delivery-documents/${saved}/print`}
                target="_blank"
              >
                Preview PDF
              </Link>
              {' · '}
              <Link
                className="font-semibold underline"
                href={`/preparation-monitoring?from=${target.deliveryDate}&to=${target.deliveryDate}&document=${target.id}`}
              >
                Buka Preparation Monitoring
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">
          Pilih loading list yang sesuai sebelum mengupload. File dihubungkan ke customer, pabrik,
          dan PDS dokumen tersebut.
        </p>
      )}
    </section>
  );
}
