import { normalisasiGarisPotong, susunPotonganKanbanDariGaris } from '@avicenna/domain';

interface PdfPage {
  getViewport(input: { scale: number }): { width: number; height: number };
  render(input: {
    canvasContext: CanvasRenderingContext2D;
    viewport: { width: number; height: number };
  }): { promise: Promise<void> };
}
interface PdfLibrary {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(input: { data?: ArrayBuffer; url?: string; isEvalSupported: boolean }): {
    promise: Promise<{ numPages: number; getPage(page: number): Promise<PdfPage> }>;
  };
}
declare global {
  interface Window {
    pdfjsLib?: PdfLibrary;
  }
}
let pdfPromise: Promise<PdfLibrary> | null = null;
export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (pdfPromise) return pdfPromise;
  pdfPromise = new Promise<PdfLibrary>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      if (!window.pdfjsLib) return reject(Error('PDF.js gagal dimuat.'));
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      resolve(window.pdfjsLib);
    };
    script.onerror = () => {
      pdfPromise = null;
      script.remove();
      reject(Error('Preview PDF gagal dimuat. Periksa koneksi internet.'));
    };
    document.head.appendChild(script);
  });
  return pdfPromise;
}

export async function cutCustomerKanban(
  data: ArrayBuffer,
  rule: { horizontalLines: number[]; verticalLines: number[] },
) {
  const { PDFDocument } = await import('pdf-lib');
  const source = await PDFDocument.load(data),
    output = await PDFDocument.create();
  if (!source.getPageCount()) throw Error('PDF tidak mempunyai halaman.');
  let total = 0;
  for (const page of source.getPages()) {
    const height = page.getHeight();
    const layout = susunPotonganKanbanDariGaris(
      {
        horizontalLines: normalisasiGarisPotong(rule.horizontalLines),
        verticalLines: normalisasiGarisPotong(rule.verticalLines),
      },
      page.getWidth(),
      height,
    );
    for (const cell of layout.cells) {
      const top = height - cell.top;
      const embedded = await output.embedPage(page, {
        left: cell.left,
        bottom: top - cell.height,
        right: cell.left + cell.width,
        top,
      });
      output
        .addPage([cell.width, cell.height])
        .drawPage(embedded, { x: 0, y: 0, width: cell.width, height: cell.height });
      total++;
    }
  }
  return { bytes: await output.save(), total };
}
