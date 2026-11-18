import { KARTU_LEBAR_MM, KARTU_TINGGI_MM, type KartuKanbanCetak } from '@avicenna/contracts';

/**
 * Logo di atas back number. Hitam di latar putih, supaya tetap terbaca di
 * printer laser hitam-putih dan tidak menghabiskan tinta.
 */
const LOGO_AISIN = '/images/aisin-logo.png';

/**
 * Satu kartu kanban produksi, 105 × 74,2 mm — seperdelapan lembar A4.
 *
 * ── Tata letak ──────────────────────────────────────────────────────────────
 *
 *   0–11 mm    pita hitam "KANBAN PRODUKSI", tegak
 *   17 mm →    logo, back number, nomor part, nama part
 *   43 mm      garis, lalu dua kolom: line produksi / SLOC tujuan di kiri,
 *              quantity / serial di kanan
 *   pojok      QR 22 × 22 mm, 5 mm dari tepi atas dan kanan, nama pabrik di
 *              bawahnya
 */
export function KartuKanban({ kartu: k, svg }: { kartu: KartuKanbanCetak; svg: string }) {
  return (
    <article
      /*
       * Garis potong hanya di KANAN dan BAWAH. Garis penuh di empat sisi
       * menghasilkan dua garis berdampingan di tiap potongan, dan kartunya
       * terlihat seperti dipotong miring meskipun lurus.
       */
      className="kartu relative flex border-b border-r border-dashed border-neutral-400 bg-white text-black"
      style={{ width: `${KARTU_LEBAR_MM}mm`, height: `${KARTU_TINGGI_MM}mm` }}
    >
      {/*
        print-color-adjust: exact — tanpa itu browser membuang latar saat
        mencetak (pilihan "Background graphics" mati secara bawaan), dan pita
        hitamnya hilang bersama tulisan putihnya.
      */}
      <div className="flex w-[11mm] shrink-0 items-center justify-center bg-black [-webkit-print-color-adjust:exact] [print-color-adjust:exact]">
        <span className="rotate-180 whitespace-nowrap text-[17px] font-extrabold uppercase tracking-[0.1em] text-white [writing-mode:vertical-rl]">
          Kanban produksi
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col pl-[6mm] pr-[4mm] pt-[5mm]">
        {/* Bantalan kanan 26 mm: tulisan tidak boleh masuk ke zona tenang QR. */}
        <div className="flex min-w-0 flex-col pr-[26mm]">
          <img src={LOGO_AISIN} alt="AISIN" className="h-[4.3mm] w-auto self-start" />
          {/*
            Back number paling besar. Itulah kode yang dipakai orang di lantai
            untuk mencocokkan kartu dengan rak dan box — nomor part yang panjang
            dibaca saat ragu, bukan saat memilih.
          */}
          <div className="mt-[4.2mm] truncate text-[51px] font-extrabold leading-[0.8] tracking-tight">
            {k.backNumber ?? '—'}
          </div>
          <div className="tabular mt-[3.9mm] truncate text-[22px] font-bold leading-[0.8]">
            {k.partNumber}
          </div>
          <div className="mt-[2.1mm] truncate text-[13px] leading-none text-neutral-700">
            {k.partName}
          </div>
        </div>

        <div className="mt-[4.6mm] grid grid-cols-[56mm_1fr] gap-y-[4mm] border-t-2 border-black pt-[2mm]">
          {[
            { label: 'Line produksi', nilai: k.lineWorkCenter, besar: false },
            { label: 'Quantity', nilai: String(k.qtyPerBox), besar: true },
            /* Nilainya rata kanan dengan labelnya, seperti di desain kartu. */
            { label: 'SLOC tujuan', nilai: k.slocTujuan, besar: false, rataKanan: true },
            { label: 'Serial', nilai: k.serialNumber, besar: true },
          ].map((kolom) => (
            <div key={kolom.label} className={`min-w-0 ${kolom.rataKanan ? 'w-fit text-right' : ''}`}>
              <div
                className={`whitespace-nowrap font-bold uppercase leading-none tracking-[0.18em] text-neutral-500 ${
                  kolom.besar ? 'text-[11px]' : 'text-[10px]'
                }`}
              >
                {kolom.label}
              </div>
              <div
                className={`tabular mt-[0.5mm] truncate font-extrabold leading-none ${
                  kolom.besar ? 'text-[20px]' : 'text-[17px]'
                }`}
              >
                {kolom.nilai}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/*
        QR di pojok kanan atas: 5 mm dari tepi atas dan 5 mm dari tepi kanan,
        diukur sampai modul hitamnya (QR dibuat tanpa margin). Lima milimeter
        kosong itu sendiri zona tenangnya di dua sisi tersebut.
      */}
      <div
        className="absolute right-[5mm] top-[5mm] size-[22mm] [&>svg]:size-full"
        // SVG dihasilkan dari kode kartu kita sendiri, bukan masukan orang.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <div className="absolute right-[5mm] top-[29mm] w-[22mm] whitespace-nowrap text-center text-[12px] font-bold uppercase tracking-[0.08em] text-neutral-500">
        {k.plantCode ?? '—'} plant
      </div>
    </article>
  );
}
