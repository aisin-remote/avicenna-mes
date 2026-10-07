'use client';

import { useRef, useState, useTransition } from 'react';
import { Download, FileUp, MoveHorizontal, MoveVertical, Save, X } from 'lucide-react';
import type { KanbanCropProfile, KanbanCropProfileInput } from '@avicenna/contracts';
import { normalisasiGarisPotong, susunPotonganKanbanDariGaris } from '@avicenna/domain';
import { saveKanbanCropAction } from '@/app/(app)/kanban/actions';
import { useToast } from '../ui/toast';

const PDF_JS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

interface PdfJsPage {
  getViewport(input: { scale: number }): { width: number; height: number };
  render(input: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}

interface PdfJsLibrary {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(input: { data: ArrayBuffer }): {
    promise: Promise<{ getPage(page: number): Promise<PdfJsPage> }>;
  };
}

declare global {
  interface Window {
    pdfjsLib?: PdfJsLibrary;
  }
}

let pdfJsPromise: Promise<PdfJsLibrary> | null = null;

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDF_JS_URL;
    script.onload = () => {
      if (!window.pdfjsLib) return reject(new Error('pdf.js gagal dimuat.'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
      resolve(window.pdfjsLib);
    };
    script.onerror = () => reject(new Error('Preview PDF gagal dimuat. Periksa koneksi internet.'));
    document.head.appendChild(script);
  });
  return pdfJsPromise;
}

type Axis = 'horizontal' | 'vertical';
type DragState = { axis: Axis; index: number; pointerId: number };

export function KanbanCropManager({ initialProfiles }: { initialProfiles: KanbanCropProfile[] }) {
  const toast = useToast();
  const [profiles, setProfiles] = useState(initialProfiles);
  const [customerId, setCustomerId] = useState(initialProfiles[0]?.customerId ?? 0);
  const selected = profiles.find((profile) => profile.customerId === customerId);
  const [horizontalLines, setHorizontalLines] = useState(
    initialProfiles[0]?.horizontalLines ?? [1 / 3, 2 / 3],
  );
  const [verticalLines, setVerticalLines] = useState(initialProfiles[0]?.verticalLines ?? []);
  const [file, setFile] = useState<File | null>(null);
  const [previewState, setPreviewState] = useState<'empty' | 'loading' | 'ready' | 'error'>(
    'empty',
  );
  const [pageRatio, setPageRatio] = useState(210 / 297);
  const [processing, setProcessing] = useState(false);
  const [pending, startTransition] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<DragState | null>(null);

  const pieces = (horizontalLines.length + 1) * (verticalLines.length + 1);

  function selectCustomer(nextId: number) {
    setCustomerId(nextId);
    const next = profiles.find((profile) => profile.customerId === nextId);
    if (!next) return;
    setHorizontalLines(next.horizontalLines);
    setVerticalLines(next.verticalLines);
  }

  async function choosePdf(next: File | null) {
    setFile(next);
    if (!next) return setPreviewState('empty');
    setPreviewState('loading');
    try {
      const pdfJs = await loadPdfJs();
      const document = await pdfJs.getDocument({ data: await next.arrayBuffer() }).promise;
      const page = await document.getPage(1);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) throw new Error('Canvas preview tidak tersedia.');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      setPageRatio(viewport.width / viewport.height);
      await page.render({ canvasContext: context, viewport }).promise;
      setPreviewState('ready');
    } catch (error) {
      setPreviewState('error');
      toast.galat(error instanceof Error ? error.message : 'PDF tidak dapat dibuka.');
    }
  }

  function addLine(axis: Axis, position = 0.5) {
    const update = axis === 'horizontal' ? setHorizontalLines : setVerticalLines;
    update((current) => normalisasiGarisPotong([...current, position]));
  }

  function removeLine(axis: Axis, index: number) {
    const update = axis === 'horizontal' ? setHorizontalLines : setVerticalLines;
    update((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function startDrag(event: React.PointerEvent, axis: Axis, index: number) {
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = { axis, index, pointerId: event.pointerId };
    overlayRef.current?.setPointerCapture(event.pointerId);
  }

  function moveLine(event: React.PointerEvent<HTMLDivElement>) {
    const dragging = draggingRef.current;
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!dragging || !bounds) return;
    const raw =
      dragging.axis === 'horizontal'
        ? (event.clientY - bounds.top) / bounds.height
        : (event.clientX - bounds.left) / bounds.width;
    const value = Math.min(0.98, Math.max(0.02, raw));
    const update = dragging.axis === 'horizontal' ? setHorizontalLines : setVerticalLines;
    update((current) => current.map((line, index) => (index === dragging.index ? value : line)));
  }

  function finishDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    if (overlayRef.current?.hasPointerCapture(event.pointerId)) {
      overlayRef.current.releasePointerCapture(event.pointerId);
    }
    draggingRef.current = null;
    setHorizontalLines((current) => normalisasiGarisPotong(current));
    setVerticalLines((current) => normalisasiGarisPotong(current));
  }

  function addFromPreview(event: React.MouseEvent<HTMLDivElement>) {
    const bounds = overlayRef.current?.getBoundingClientRect();
    if (!bounds) return;
    if (event.shiftKey) addLine('vertical', (event.clientX - bounds.left) / bounds.width);
    else addLine('horizontal', (event.clientY - bounds.top) / bounds.height);
  }

  function save() {
    if (!selected) return;
    const input: KanbanCropProfileInput = {
      customerId,
      horizontalLines: normalisasiGarisPotong(horizontalLines),
      verticalLines: normalisasiGarisPotong(verticalLines),
    };
    startTransition(async () => {
      const result = await saveKanbanCropAction(input);
      if ('error' in result) return toast.galat(result.error);
      setProfiles((current) =>
        current.map((row) => (row.customerId === customerId ? result : row)),
      );
      setHorizontalLines(result.horizontalLines);
      setVerticalLines(result.verticalLines);
      toast.ok(`Master Kanban ${result.customerCode} tersimpan.`);
    });
  }

  async function processPdf() {
    if (!file || !selected) return;
    setProcessing(true);
    try {
      const { PDFDocument } = await import('pdf-lib');
      const source = await PDFDocument.load(await file.arrayBuffer());
      const output = await PDFDocument.create();
      const rule = {
        horizontalLines: normalisasiGarisPotong(horizontalLines),
        verticalLines: normalisasiGarisPotong(verticalLines),
      };
      let total = 0;

      for (const sourcePage of source.getPages()) {
        const pageHeight = sourcePage.getHeight();
        const layout = susunPotonganKanbanDariGaris(rule, sourcePage.getWidth(), pageHeight);
        for (const cell of layout.cells) {
          const left = cell.left;
          const right = cell.left + cell.width;
          const top = pageHeight - cell.top;
          const bottom = top - cell.height;
          const embedded = await output.embedPage(sourcePage, { left, bottom, right, top });
          const target = output.addPage([cell.width, cell.height]);
          target.drawPage(embedded, { x: 0, y: 0, width: cell.width, height: cell.height });
          total += 1;
        }
      }

      output.setTitle(`Kanban ${selected.customerCode}`);
      const bytes = await output.save();
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${file.name.replace(/\.pdf$/i, '')}-${selected.customerCode}-cut.pdf`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.ok(`${total} potongan Kanban berhasil dibuat.`);
    } catch (error) {
      toast.galat(error instanceof Error ? error.message : 'PDF tidak bisa diproses.');
    } finally {
      setProcessing(false);
    }
  }

  if (!selected) {
    return (
      <p className="border-t border-line p-6 text-sm text-ink-muted">Belum ada customer aktif.</p>
    );
  }

  return (
    <div className="border-t border-line">
      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(240px,360px)_minmax(0,1fr)]">
        <label className="block">
          <span className="mb-2 block text-sm font-bold">Customer</span>
          <select
            value={customerId}
            onChange={(event) => selectCustomer(Number(event.target.value))}
            className="h-11 w-full rounded-xl border border-line bg-card px-3 text-sm outline-none focus:border-ink"
          >
            {profiles.map((profile) => (
              <option key={profile.customerId} value={profile.customerId}>
                {profile.customerCode} — {profile.customerName}
                {profile.configured ? '' : ' (belum dimasterkan)'}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-bold">PDF contoh customer</span>
          <span className="flex h-11 items-center rounded-xl border border-line bg-card px-3">
            <FileUp className="mr-2 size-4 shrink-0 text-ink-muted" aria-hidden />
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => void choosePdf(event.target.files?.[0] ?? null)}
              className="min-w-0 flex-1 text-sm file:mr-3 file:rounded-full file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-semibold file:text-card"
            />
          </span>
        </label>
      </div>

      <section className={`border-y border-blue-200 bg-blue-50/50 ${file ? '' : 'hidden'}`}>
        <header className="flex flex-wrap items-center gap-3 border-b border-blue-200 bg-blue-100/70 px-4 py-3">
          <div className="min-w-0 flex-1 font-semibold text-blue-950">
            <span className="block truncate">
              {file?.name ?? 'Pilih PDF untuk melihat preview'}
            </span>
            <span className="text-xs font-normal text-blue-700">{pieces} bidang potong</span>
          </div>
          <span className="rounded-full bg-blue-600 px-3 py-1 text-xs font-bold text-white">
            MASTER
          </span>
          <button
            type="button"
            onClick={() => addLine('horizontal')}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
          >
            <MoveHorizontal className="size-4" aria-hidden /> + Garis tidur
          </button>
          <button
            type="button"
            onClick={() => addLine('vertical')}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <MoveVertical className="size-4" aria-hidden /> + Garis berdiri
          </button>
          <button
            type="button"
            onClick={() => {
              setHorizontalLines([]);
              setVerticalLines([]);
            }}
            className="h-10 rounded-lg border border-blue-500 bg-white px-4 text-sm font-semibold text-blue-700"
          >
            Clear
          </button>
        </header>

        <div className="overflow-auto p-4 sm:p-6">
          <div
            className="relative mx-auto w-full max-w-[920px] overflow-hidden bg-white shadow-xl ring-1 ring-black/10"
            style={{ aspectRatio: pageRatio }}
          >
            <canvas ref={canvasRef} width={794} height={1123} className="block size-full" />
            {previewState !== 'ready' ? (
              <div className="absolute inset-0 grid place-items-center bg-white text-center text-sm text-slate-500">
                {previewState === 'loading'
                  ? 'Memuat preview PDF…'
                  : previewState === 'error'
                    ? 'Preview gagal dimuat. Pilih ulang PDF.'
                    : 'Upload PDF customer, lalu atur garis potong di sini.'}
              </div>
            ) : null}
            <div
              ref={overlayRef}
              className="absolute inset-0 touch-none select-none"
              onDoubleClick={addFromPreview}
              onPointerMove={moveLine}
              onPointerUp={finishDrag}
              onPointerCancel={finishDrag}
            >
              {horizontalLines.map((position, index) => (
                <div
                  key={`h-${index}`}
                  role="slider"
                  aria-label={`Garis tidur ${index + 1}`}
                  aria-valuenow={Math.round(position * 100)}
                  tabIndex={0}
                  onPointerDown={(event) => startDrag(event, 'horizontal', index)}
                  className="absolute inset-x-0 z-10 h-1 -translate-y-1/2 cursor-ns-resize bg-blue-600 shadow-[0_0_0_1px_rgba(255,255,255,.7)]"
                  style={{ top: `${position * 100}%` }}
                >
                  <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-2 rounded-full bg-blue-600 py-1.5 pl-3 pr-1.5 text-xs font-bold text-white shadow-lg">
                    ↕ garis {index + 1} — {Math.round(position * 100)}%
                    <button
                      type="button"
                      aria-label={`Hapus garis tidur ${index + 1}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => removeLine('horizontal', index)}
                      className="grid size-7 place-items-center rounded-full bg-white text-blue-700"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
              {verticalLines.map((position, index) => (
                <div
                  key={`v-${index}`}
                  role="slider"
                  aria-label={`Garis berdiri ${index + 1}`}
                  aria-valuenow={Math.round(position * 100)}
                  tabIndex={0}
                  onPointerDown={(event) => startDrag(event, 'vertical', index)}
                  className="absolute inset-y-0 z-10 w-1 -translate-x-1/2 cursor-ew-resize bg-emerald-600 shadow-[0_0_0_1px_rgba(255,255,255,.7)]"
                  style={{ left: `${position * 100}%` }}
                >
                  <span className="absolute left-1/2 top-2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-emerald-600 py-1 pl-2.5 pr-1 text-xs font-bold text-white shadow-lg">
                    ↔ {Math.round(position * 100)}%
                    <button
                      type="button"
                      aria-label={`Hapus garis berdiri ${index + 1}`}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => removeLine('vertical', index)}
                      className="grid size-6 place-items-center rounded-full bg-white text-emerald-700"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className="mx-auto mt-3 max-w-[920px] text-xs text-blue-900/70">
            Geser garis dengan mouse atau sentuhan. Klik dua kali untuk garis tidur, Shift + klik
            dua kali untuk garis berdiri.
          </p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 p-5">
        <p className="text-sm text-ink-muted">
          {horizontalLines.length} garis tidur · {verticalLines.length} garis berdiri · {pieces}{' '}
          hasil potong per halaman
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            <Save className="size-4" aria-hidden /> {pending ? 'Menyimpan…' : 'Simpan master'}
          </button>
          <button
            type="button"
            onClick={() => void processPdf()}
            disabled={!file || processing}
            className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-card px-5 text-sm font-semibold disabled:opacity-50"
          >
            <Download className="size-4" aria-hidden />{' '}
            {processing ? 'Memotong…' : 'Proses & download'}
          </button>
        </div>
      </div>
    </div>
  );
}
