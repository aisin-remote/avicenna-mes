import { describe, it, expect } from 'vitest';
import {
  bacaKanban,
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
