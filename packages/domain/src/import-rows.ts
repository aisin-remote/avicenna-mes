/**
 * Pembacaan data tempelan untuk impor massal.
 *
 * Sengaja TANPA pustaka pembaca Excel. Dua alasannya:
 *
 *  1. Menyalin baris di Excel lalu menempelkannya menghasilkan teks ber-tab.
 *     Itu cara paling langsung bagi pengguna — tidak perlu simpan sebagai CSV,
 *     tidak perlu unggah berkas, dan hasilnya terlihat sebelum disimpan.
 *  2. Pustaka pembaca xlsx yang tersedia di npm sudah lama tidak diperbarui
 *     dan membawa kerentanan yang diketahui. Berkas dari supplier adalah
 *     masukan yang tidak tepercaya; memprosesnya dengan pustaka bermasalah
 *     bukan risiko yang perlu diambil untuk kemudahan yang bisa didapat
 *     dengan cara lain.
 *
 * Format yang diterima, dipisah tab, koma, atau titik koma:
 *   part number | jumlah | [satuan] | [nomor lot supplier]
 */

export interface ParsedImportRow {
  /** Nomor baris pada tempelan, untuk menunjuk letak kesalahan. */
  lineNumber: number;
  partNumber: string;
  qty: number;
  uom?: string;
  supplierLotNumber?: string;
  /** Terisi bila baris ini tidak bisa dipakai. */
  error?: string;
}

const HEADER_WORDS = ['part', 'partnumber', 'part number', 'no part', 'kode', 'item'];

/** Menebak pemisah dari baris pertama yang berisi. */
function detectDelimiter(line: string): string {
  if (line.includes('\t')) return '\t';
  if (line.includes(';')) return ';';
  return ',';
}

/**
 * Mengubah angka bergaya Indonesia maupun Inggris menjadi number.
 *
 * Excel berbahasa Indonesia memakai koma sebagai desimal dan titik sebagai
 * pemisah ribuan — kebalikan dari format Inggris. Salah membacanya membuat
 * penerimaan tercatat seribu kali lipat, dan itu kesalahan termahal di modul
 * ini.
 *
 * Aturan yang dipakai:
 *  - Dua jenis pemisah muncul bersama → yang paling belakang adalah desimal.
 *    "1.234,5" = 1234,5 dan "1,234.5" = 1234,5. Ini tidak ambigu.
 *  - Satu jenis pemisah dengan TEPAT 3 angka di belakangnya dan bagian
 *    depannya bukan nol → pemisah ribuan. "1.000" = 1000, "2,500" = 2500.
 *  - Selain itu → pemisah desimal. "0.800" = 0,8 karena tidak ada yang
 *    menulis "nol ribu"; "1,5" = 1,5.
 *
 * Sisa keraguan ditangani di layar: hasil pembacaan ditampilkan lebih dulu
 * sebagai pratinjau sebelum disimpan, jadi angka yang salah baca terlihat
 * oleh orang yang menempelkannya.
 */
export function parseLocaleNumber(raw: string): number {
  const text = raw.trim().replace(/\s/g, '');
  if (!text) return Number.NaN;

  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');

  // Dua jenis pemisah: yang paling belakang adalah desimalnya.
  if (lastComma >= 0 && lastDot >= 0) {
    return lastComma > lastDot
      ? Number(text.replace(/\./g, '').replace(',', '.'))
      : Number(text.replace(/,/g, ''));
  }

  const sepIndex = Math.max(lastComma, lastDot);
  if (sepIndex < 0) return Number(text);

  const head = text.slice(0, sepIndex);
  const tail = text.slice(sepIndex + 1);
  const looksLikeThousands = tail.length === 3 && head !== '' && head !== '0' && !/[.,]/.test(head);

  if (looksLikeThousands) return Number(head + tail);
  return Number(`${head || '0'}.${tail}`);
}

export function parseImportRows(text: string): ParsedImportRow[] {
  /*
   * Baris TIDAK di-trim sebelum dipecah.
   *
   * Menghapus spasi di tepi baris ikut menghapus sel pertama yang kosong,
   * sehingga baris tanpa part number tapi berisi jumlah terbaca seolah
   * jumlahnya adalah part number-nya. Yang di-trim hanya tiap selnya.
   */
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines[0]!);
  const rows: ParsedImportRow[] = [];

  lines.forEach((line, index) => {
    const cells = line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
    const partNumber = cells[0] ?? '';

    // Baris judul dilewati, bukan dilaporkan sebagai kesalahan — menempelkan
    // beserta judulnya adalah hal yang wajar dilakukan orang.
    if (index === 0 && HEADER_WORDS.includes(partNumber.toLowerCase())) return;

    const lineNumber = index + 1;

    if (!partNumber) {
      rows.push({ lineNumber, partNumber: '', qty: 0, error: 'Part number kosong' });
      return;
    }

    const qty = parseLocaleNumber(cells[1] ?? '');
    if (!Number.isFinite(qty)) {
      rows.push({ lineNumber, partNumber, qty: 0, error: 'Jumlah tidak terbaca sebagai angka' });
      return;
    }
    if (qty <= 0) {
      rows.push({ lineNumber, partNumber, qty, error: 'Jumlah harus lebih dari nol' });
      return;
    }

    rows.push({
      lineNumber,
      partNumber,
      qty,
      uom: cells[2] || undefined,
      supplierLotNumber: cells[3] || undefined,
    });
  });

  return rows;
}

/** Menggabungkan baris dengan part number sama, menjumlahkan qty-nya. */
export function mergeByPart(rows: readonly ParsedImportRow[]): ParsedImportRow[] {
  const merged = new Map<string, ParsedImportRow>();
  const failed: ParsedImportRow[] = [];

  for (const row of rows) {
    if (row.error) {
      failed.push(row);
      continue;
    }
    // Baris dengan nomor lot berbeda TIDAK digabung — lot yang berbeda harus
    // tetap terpisah agar ketertelusurannya tidak hilang.
    const key = `${row.partNumber}|${row.supplierLotNumber ?? ''}`;
    const existing = merged.get(key);
    if (existing) existing.qty += row.qty;
    else merged.set(key, { ...row });
  }

  return [...merged.values(), ...failed];
}
