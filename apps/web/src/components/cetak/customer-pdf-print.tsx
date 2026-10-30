'use client';
import { useEffect, useRef, useState } from 'react';
import { loadPdfJs } from '@/lib/customer-pdf';

export function CustomerPdfPrint({
  id,
  filename,
  autoPrint,
}: {
  id: number;
  filename: string;
  autoPrint: boolean;
}) {
  const pages = useRef<HTMLDivElement>(null);
  const didPrint = useRef(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState('Memuat PDF…');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const host = pages.current!;
    host.replaceChildren();
    void (async () => {
      const lib = await loadPdfJs();
      const pdf = await lib.getDocument({
        url: `/api/delivery-documents/${id}`,
        isEvalSupported: false,
      }).promise;
      if (pdf.numPages > 500)
        throw Error(
          'PDF lebih dari 500 halaman. Gunakan Download untuk mencetak melalui pembaca PDF.',
        );
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!active) return;
        setProgress(`Menyiapkan halaman ${i}/${pdf.numPages}…`);
        const page = await pdf.getPage(i),
          original = page.getViewport({ scale: 1 });
        const width = (original.width * 25.4) / 72,
          height = (original.height * 25.4) / 72;
        if (!(width > 0 && height > 0 && width <= 2000 && height <= 2000))
          throw Error('Ukuran halaman PDF tidak didukung.');
        const viewport = page.getViewport({
          scale: Math.min(2, 4096 / original.width, 4096 / original.height),
        });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.display = 'block';
        const context = canvas.getContext('2d');
        if (!context) throw Error('Preview PDF tidak tersedia di browser ini.');
        await page.render({ canvasContext: context, viewport }).promise;
        if (!active) return;
        const sheet = document.createElement('div'),
          paper = `pdf_${id}_${i}`;
        sheet.className = 'pdf-page';
        sheet.style.width = `${width}mm`;
        sheet.style.height = `${height}mm`;
        sheet.style.overflow = 'hidden';
        sheet.style.page = paper;
        sheet.setAttribute('aria-label', `Halaman ${i}`);
        const style = document.createElement('style');
        style.textContent = `@page ${paper} { size: ${width}mm ${height}mm; margin: 0; }`;
        sheet.append(style, canvas);
        host.append(sheet);
      }
      if (!active) return;
      setReady(true);
      if (autoPrint && !didPrint.current) {
        didPrint.current = true;
        requestAnimationFrame(() => {
          if (active) window.print();
        });
      }
    })().catch((e) => {
      if (active) setError(e instanceof Error ? e.message : 'PDF tidak dapat ditampilkan.');
    });
    return () => {
      active = false;
      host.replaceChildren();
    };
  }, [id, autoPrint]);
  return (
    <main className="p-4 print:p-0">
      <style>{`.pdf-page{margin:16px auto;background:white;box-shadow:0 0 0 1px #ddd}
      @media print{html,body{zoom:1!important;margin:0!important}.tanpa-cetak{display:none!important}.pdf-page{margin:0;box-shadow:none;break-inside:avoid;break-after:page}.pdf-page:last-child{break-after:auto}}`}</style>
      <header className="tanpa-cetak mx-auto mb-4 flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="break-all text-xl font-bold">{filename}</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Seluruh halaman PDF dicetak sesuai ukuran aslinya. Pilih printer dan skala 100% pada
            dialog cetak.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/api/delivery-documents/${id}?download=1`}
            className="rounded-full border px-4 py-3 text-sm font-semibold"
          >
            Download
          </a>
          <button
            disabled={!ready || !!error}
            onClick={() => window.print()}
            className="rounded-full bg-black px-5 py-3 text-sm font-semibold text-white disabled:opacity-40"
          >
            Cetak
          </button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="tanpa-cetak rounded-xl bg-red-50 p-4 text-red-700">
          {error}
        </p>
      ) : !ready ? (
        <p role="status" className="tanpa-cetak p-6 text-center">
          {progress}
        </p>
      ) : null}
      <div ref={pages} className="overflow-auto print:overflow-visible" />
    </main>
  );
}
