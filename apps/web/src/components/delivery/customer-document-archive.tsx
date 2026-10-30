'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  DELIVERY_DOCUMENT_KINDS,
  DELIVERY_DOCUMENT_LABELS,
  type DeliveryDocumentArchive,
} from '@avicenna/contracts';
import { listDeliveryDocumentsAction } from '@/app/(app)/kanban/actions';

export function CustomerDocumentArchive({ deliveryId }: { deliveryId: number }) {
  const [archive, setArchive] = useState<DeliveryDocumentArchive | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setArchive(null);
    setError('');
    void listDeliveryDocumentsAction(deliveryId).then((result) => {
      if (!active) return;
      if ('error' in result) setError(result.error ?? 'Arsip belum dapat dimuat.');
      else setArchive(result.data);
    });
    const focus = () => setVersion((v) => v + 1);
    window.addEventListener('focus', focus);
    return () => {
      active = false;
      window.removeEventListener('focus', focus);
    };
  }, [deliveryId, version]);
  return (
    <section className="mb-5 rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-bold">Dokumen Customer</h3>
          <p className="mt-1 text-xs text-ink-muted">
            {archive
              ? `${archive.reference.type} ${archive.reference.number}`
              : 'Arsip kanban customer, manifest, dan skid label'}
          </p>
        </div>
        <button
          onClick={() => setVersion((v) => v + 1)}
          className="rounded-lg border border-line px-3 py-2 text-xs font-semibold"
        >
          Perbarui arsip
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      ) : !archive ? (
        <p role="status" className="py-3 text-sm text-ink-muted">
          Memuat arsip PDF…
        </p>
      ) : (
        <div className="space-y-3">
          {DELIVERY_DOCUMENT_KINDS.map((kind) => {
            const files = archive.data.filter((file) => file.kind === kind);
            return (
              <div key={kind} className="rounded-xl border border-line bg-card p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-sm">{DELIVERY_DOCUMENT_LABELS[kind]}</strong>
                  <Link
                    href={`/kanban?deliveryId=${deliveryId}&kind=${kind}`}
                    target="_blank"
                    className="text-xs font-semibold text-accent underline"
                  >
                    Upload PDF
                  </Link>
                </div>
                {!files.length ? (
                  <p className="mt-2 text-xs text-ink-muted">
                    Belum ada PDF yang diupload
                    {kind === 'CUSTOMER_KANBAN' ? ' / hasil potong yang disimpan' : ''}.
                  </p>
                ) : (
                  files.map((file) => (
                    <div
                      key={file.id}
                      className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3"
                    >
                      <div className="min-w-0">
                        <p className="break-all text-sm font-semibold">{file.filename}</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {new Date(file.createdAt).toLocaleString('id-ID', {
                            timeZone: 'Asia/Jakarta',
                          })}{' '}
                          WIB · {(file.byteSize / 1024).toFixed(0)} KB
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-semibold">
                        <Link
                          href={`/delivery-documents/${file.id}/print?print=1`}
                          target="_blank"
                          className="rounded-lg bg-accent px-3 py-2 text-white"
                        >
                          Cetak
                        </Link>
                        <Link
                          href={`/delivery-documents/${file.id}/print`}
                          target="_blank"
                          className="rounded-lg border border-line px-3 py-2"
                        >
                          Preview
                        </Link>
                        <a
                          href={`/api/delivery-documents/${file.id}?download=1`}
                          className="rounded-lg border border-line px-3 py-2"
                        >
                          Download
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
