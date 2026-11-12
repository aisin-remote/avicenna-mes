import { laporanProduksi } from '@/lib/laporan-api';
import { getSessionUser } from '@/lib/session';

/** Satu sel CSV: dikutip bila berisi pemisah, kutip, atau baris baru. */
function sel(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Laporan produksi sebagai CSV — satu baris per part per line per shift.
 *
 * Pemisah titik koma dan koma desimal: Excel berlokal Indonesia membaca
 * berkas seperti ini langsung menjadi kolom, tanpa wizard impor.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return new Response('Sesi berakhir', { status: 401 });

  const p = new URL(request.url).searchParams;
  const lap = await laporanProduksi({
    plant: p.get('plant') ?? undefined,
    dari: p.get('dari') ?? undefined,
    sampai: p.get('sampai') ?? undefined,
  });

  const angka = (v: number | null) => (v === null ? '' : String(v).replace('.', ','));
  const kepala = [
    'Tanggal',
    'Shift',
    'Line',
    'Part Number',
    'Back Number',
    'Part Name',
    'OK',
    'RIL',
    'ROL',
    'Cycle Time (detik)',
    'Menit Hasil',
    'Menit Kerja Line',
    'Berhenti Line (menit)',
    'Efisiensi Line (%)',
    'RIL Line (%)',
    'ROL Line (%)',
  ];
  const baris = lap.ringkas.flatMap((r) =>
    r.baris.map((b) =>
      [
        r.tanggal,
        r.shift,
        r.lineCode,
        b.partNumber,
        b.backNumber,
        b.partName,
        b.ok,
        b.ril,
        b.rol,
        angka(b.cycleTime),
        angka(b.menitDihasilkan),
        r.menitBersih,
        r.menitBerhenti,
        angka(r.efisiensi),
        angka(r.rilPct),
        angka(r.rolPct),
      ]
        .map(sel)
        .join(';'),
    ),
  );

  const isi = '﻿' + [kepala.join(';'), ...baris].join('\r\n');
  const nama = `laporan-produksi-${lap.plant?.code ?? 'semua'}-${lap.dari}_${lap.sampai}.csv`;
  return new Response(isi, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nama}"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
