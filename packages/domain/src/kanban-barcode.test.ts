import { describe, it, expect } from 'vitest';
import {
  bacaKanban,
  sepertiKanban,
  susunLabelDn,
  KanbanTidakTerbaca,
  DAFTAR_ATURAN_KANBAN,
  type AturanKanban,
} from './barcode';

/**
 * Bentuk barcode berspasi mengikuti sistem lama: kolom ke-8 back number, ke-9
 * kolom yang empat karakter terakhirnya adalah seri kartu.
 */
const berspasi = (kolom: string[]) => kolom.join(' ');
const isi = (n: number, nilai = 'x') => Array.from({ length: n }, () => nilai);

describe('bacaKanban — format berpemisah', () => {
  it('membaca BACKNUMBER|SERIAL', () => {
    expect(bacaKanban('BN-001|1456')).toEqual({
      raw: 'BN-001|1456',
      backNumber: 'BN-001',
      serialNumber: '1456',
      aturan: 'KANBAN_BERPEMISAH',
    });
  });

  it('spasi di ujung dibuang', () => {
    expect(bacaKanban('  BN-001|1456  ').serialNumber).toBe('1456');
  });
});

describe('bacaKanban — format berspasi sistem lama', () => {
  it('kolom ke-8 back number, seri dari empat karakter terakhir kolom ke-9', () => {
    const b = berspasi([...isi(8), 'CI17', 'PREFIX1456']);
    const h = bacaKanban(b);
    expect(h.backNumber).toBe('CI17');
    expect(h.serialNumber).toBe('1456');
    expect(h.aturan).toBe('KANBAN_BERSPASI');
  });

  it('bergeser satu kolom bila kolom ke-8 berisi "0"', () => {
    /*
     * Perilaku ini dipertahankan apa adanya dari sistem lama. Sebagian kartu
     * punya kolom kosong berisi "0" di depan, dan letak back number bergeser
     * mengikutinya.
     */
    const b = berspasi([...isi(8), '0', 'CI18', 'ABC0295']);
    const h = bacaKanban(b);
    expect(h.backNumber).toBe('CI18');
    expect(h.serialNumber).toBe('0295');
  });

  it('bergeser dua kolom bila kolom ke-9 berisi "0"', () => {
    const b = berspasi([...isi(9), '0', 'EI12', 'ZZ1082']);
    const h = bacaKanban(b);
    expect(h.backNumber).toBe('EI12');
    expect(h.serialNumber).toBe('1082');
  });

  it('seri selalu empat karakter terakhir, bukan seluruh kolom', () => {
    const b = berspasi([...isi(8), 'CI17', '12051421B22A463']);
    expect(bacaKanban(b).serialNumber).toBe('A463');
  });
});

describe('bacaKanban — penolakan', () => {
  it('TIDAK ada aturan penadah: barcode asing ditolak', () => {
    /*
     * Berbeda dari barcode part yang punya aturan SERIAL_SAJA. Kanban yang
     * salah baca berarti barang dikirim atas nama kanban lain, dan itu tidak
     * bisa dilacak balik — lebih baik operator mengulang scan.
     */
    expect(() => bacaKanban('ENTAH-APA-INI')).toThrow(KanbanTidakTerbaca);
  });

  it('barcode kosong ditolak', () => {
    expect(() => bacaKanban('   ')).toThrow(/kosong/);
  });

  it('kolom terlalu sedikit untuk format berspasi', () => {
    expect(() => bacaKanban('a b c d')).toThrow(KanbanTidakTerbaca);
  });

  it('aturan yang cocok tetapi tanpa seri dianggap tidak terbaca', () => {
    // Hasil setengah jadi tidak boleh diteruskan: kartu tanpa seri tidak bisa
    // dicari, dan kegagalannya akan muncul jauh dari sebabnya.
    expect(() => bacaKanban('BN-001|')).toThrow(KanbanTidakTerbaca);
  });
});

describe('pemilihan aturan kanban', () => {
  it('format berpemisah menang atas berspasi', () => {
    const b = 'BN-001|1456 ' + isi(12).join(' ');
    expect(bacaKanban(b).aturan).toBe('KANBAN_BERPEMISAH');
  });

  it('aturan berlingkup customer hanya dipakai pada customer itu', () => {
    const khusus: AturanKanban = {
      nama: 'UJI_TMMIN',
      keterangan: 'hanya TMMIN',
      berlaku: (ctx) => ctx.customerFormat === 'TMMIN',
      cocok: (raw) => raw.startsWith('TM'),
      baca: (raw) => ({ raw, backNumber: 'BN', serialNumber: raw.slice(-4) }),
    };
    DAFTAR_ATURAN_KANBAN.unshift(khusus);
    try {
      expect(bacaKanban('TM-9999', { customerFormat: 'TMMIN' }).aturan).toBe('UJI_TMMIN');
      expect(() => bacaKanban('TM-9999', { customerFormat: 'MMKI' })).toThrow(KanbanTidakTerbaca);
    } finally {
      DAFTAR_ATURAN_KANBAN.shift();
    }
  });
});

describe('sepertiKanban — pembeda kartu vs barcode part di layar FG', () => {
  it('kartu berspasi dan BACK|SERI dianggap kartu', () => {
    expect(sepertiKanban('BN-001|1456')).toBe(true);
    expect(sepertiKanban('a b c d e f g h BN-001 xxxx1456 k l')).toBe(true);
  });

  it('barcode part 15 karakter dan PART|BACK|SERIAL|QTY BUKAN kartu', () => {
    expect(sepertiKanban('12051421B22A276')).toBe(false);
    expect(sepertiKanban('243202-10710|EI13|0001|1')).toBe(false);
    expect(sepertiKanban('243202-10710|EI13|0001')).toBe(false);
  });
});

describe('label DN — direct pulling di lini FG (layar D98E lama)', () => {
  it('membaca part customer, nomor DN, dan urutan box', () => {
    const r = bacaKanban('DN~L75~DN-202605-0006~1');
    expect(r.aturan).toBe('KANBAN_LABEL_DN');
    expect(r.customerPartNumber).toBe('L75');
    expect(r.dnNumber).toBe('DN-202605-0006');
    expect(r.dnSeq).toBe(1);
    expect(r.serialNumber).toBe('DN-202605-0006/1');
    expect(r.backNumber).toBeUndefined();
  });

  it('ruas pertama boleh kosong; urutan sampai tiga digit', () => {
    expect(bacaKanban('~L75~LL-20260920-0003~120').dnSeq).toBe(120);
  });

  it('bukan label DN bila ruasnya bukan empat atau urutannya bukan angka', () => {
    expect(() => bacaKanban('L75~DN-1~1')).toThrow(KanbanTidakTerbaca);
    expect(() => bacaKanban('x~L75~DN-1~abc')).toThrow(KanbanTidakTerbaca);
    expect(() => bacaKanban('x~L75~DN-1~1234')).toThrow(KanbanTidakTerbaca);
  });

  it('layar FG menganggapnya kartu', () => {
    expect(sepertiKanban('DN~L75~DN-202605-0006~1')).toBe(true);
  });
});

describe('susunLabelDn — label yang dicetak harus terbaca aturannya sendiri', () => {
  it('bolak-balik utuh', () => {
    const teks = susunLabelDn({
      customerCode: 'TMMIN',
      customerPartNumber: '90210-BZ010',
      dnNumber: 'LL-20260920-0001',
      dnSeq: 7,
    });
    expect(teks).toBe('TMMIN~90210-BZ010~LL-20260920-0001~7');
    const r = bacaKanban(teks);
    expect(r.aturan).toBe('KANBAN_LABEL_DN');
    expect(r.customerPartNumber).toBe('90210-BZ010');
    expect(r.dnNumber).toBe('LL-20260920-0001');
    expect(r.dnSeq).toBe(7);
  });

  it('spasi dan "~" di dalam ruas dibuang supaya ruasnya tetap empat', () => {
    expect(susunLabelDn({ customerCode: 'A B', customerPartNumber: 'X~Y', dnNumber: 'DN 1', dnSeq: 1 })).toBe(
      'AB~XY~DN1~1',
    );
  });
});
