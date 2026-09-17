import { describe, it, expect } from 'vitest';
import {
  grupProses,
  prosesDalamGrup,
  halamanAwal,
  bolehScanDi,
  bacaQrLogin,
  sepertiKartuLogin,
  QrLoginTidakTerbaca,
  PROCESS_GROUPS,
  ROLE_KINDS,
  ROLE_KIND_LABELS,
  PROCESS_GROUP_LABELS,
} from './role';
import { PROCESS_TYPES } from '@avicenna/contracts';

describe('grupProses', () => {
  it('WIP dan FG masuk grup yang sama', () => {
    // "Casting lasman" satu orang, mengurus lini Casting WIP maupun Casting FG.
    expect(grupProses('CASTING_WIP')).toBe('CASTING');
    expect(grupProses('CASTING_FG')).toBe('CASTING');
    expect(grupProses('MACHINING_WIP')).toBe('MACHINING');
    expect(grupProses('MACHINING_FG')).toBe('MACHINING');
  });

  it('assembling kedua pabrik masuk grup yang sama', () => {
    expect(grupProses('ASSEMBLING_UNIT')).toBe('ASSEMBLING');
    expect(grupProses('ASSEMBLING_BODY')).toBe('ASSEMBLING');
  });

  it('setiap jenis proses punya grupnya — tidak ada yang tercecer', () => {
    // Menambah jenis proses tanpa menentukan grupnya akan membuat role tidak
    // pernah cocok dengan lini itu, tanpa error apa pun.
    for (const p of PROCESS_TYPES) {
      expect(PROCESS_GROUPS).toContain(grupProses(p));
    }
  });

  it('prosesDalamGrup mengembalikan seluruh anggotanya', () => {
    expect(prosesDalamGrup('CASTING').sort()).toEqual(['CASTING_FG', 'CASTING_WIP']);
    expect(prosesDalamGrup('MELTING')).toEqual(['MELTING']);
  });
});

describe('halamanAwal', () => {
  it('lasman casting dibawa ke halaman scan casting', () => {
    expect(halamanAwal({ kind: 'SCANNING', processGroup: 'CASTING' })).toBe('/scan/proses/casting');
  });

  it('jp dan leader dibawa ke pemantauan, disaring prosesnya', () => {
    expect(halamanAwal({ kind: 'VIEW', processGroup: 'CASTING' })).toBe('/monitor?proses=casting');
  });

  it('admin ke dashboard', () => {
    expect(halamanAwal({ kind: 'ADMIN' })).toBe('/dashboard');
  });

  it('tanpa lingkup proses: pemilih lini / pemantauan penuh', () => {
    expect(halamanAwal({ kind: 'SCANNING' })).toBe('/scan');
    expect(halamanAwal({ kind: 'VIEW' })).toBe('/monitor');
    expect(halamanAwal({ kind: 'VIEW', processGroup: null })).toBe('/monitor');
  });

  it('setiap kombinasi menghasilkan alamat, bukan kosong', () => {
    for (const kind of ROLE_KINDS) {
      for (const g of [null, ...PROCESS_GROUPS]) {
        expect(halamanAwal({ kind, processGroup: g })).toMatch(/^\//);
      }
    }
  });
});

describe('bolehScanDi', () => {
  it('lasman casting boleh di kedua lini casting', () => {
    const r = { kind: 'SCANNING', processGroup: 'CASTING' } as const;
    expect(bolehScanDi(r, 'CASTING_WIP')).toBe(true);
    expect(bolehScanDi(r, 'CASTING_FG')).toBe(true);
  });

  it('lasman casting TIDAK boleh di lini machining', () => {
    const r = { kind: 'SCANNING', processGroup: 'CASTING' } as const;
    expect(bolehScanDi(r, 'MACHINING_WIP')).toBe(false);
  });

  it('jp dan leader tidak men-scan sama sekali', () => {
    // Mereka memeriksa data. Membiarkannya men-scan berarti hasil produksi bisa
    // bertambah dari orang yang tidak berdiri di lini.
    expect(bolehScanDi({ kind: 'VIEW', processGroup: 'CASTING' }, 'CASTING_WIP')).toBe(false);
  });

  it('admin boleh di mana saja', () => {
    for (const p of PROCESS_TYPES) {
      expect(bolehScanDi({ kind: 'ADMIN' }, p)).toBe(true);
    }
  });

  it('scanning tanpa lingkup boleh di mana saja', () => {
    expect(bolehScanDi({ kind: 'SCANNING' }, 'PAINTING')).toBe(true);
  });
});

describe('bacaQrLogin', () => {
  it('membaca NPK|password', () => {
    expect(bacaQrLogin('000701|123456')).toEqual({ npk: '000701', password: '123456' });
  });

  it('NPK dirapikan — bentuknya pasti, hanya angka', () => {
    expect(bacaQrLogin('  000701 | 123456  ').npk).toBe('000701');
  });

  it('kata sandi TIDAK dirapikan — kredensial tidak diubah diam-diam', () => {
    /*
     * Kata sandi yang sah bisa diawali spasi. Memangkasnya membuat orangnya
     * tidak pernah bisa masuk tanpa petunjuk apa pun di layar.
     *
     * Akibatnya kartu yang dicetak dengan spasi ditolak sebagai sandi salah —
     * disengaja, karena memperbaikinya di sini berarti menebak mana spasi yang
     * berarti dan mana yang tidak.
     */
    expect(bacaQrLogin('000701| 123456').password).toBe(' 123456');
    expect(bacaQrLogin('000701|123456 ').password).toBe('123456');
  });

  it('kata sandi ber-"|" tidak terpotong', () => {
    /*
     * Dipecah pada pemisah PERTAMA saja. Memecah seluruhnya akan memotong kata
     * sandi seperti "a|b|c" menjadi "a", dan orangnya ditolak masuk tanpa sebab
     * yang terlihat di layar.
     */
    expect(bacaQrLogin('000701|a|b|c').password).toBe('a|b|c');
  });

  it('tanpa pemisah ditolak', () => {
    expect(() => bacaQrLogin('000701')).toThrow(QrLoginTidakTerbaca);
  });

  it('NPK atau kata sandi kosong ditolak', () => {
    expect(() => bacaQrLogin('|123456')).toThrow(QrLoginTidakTerbaca);
    expect(() => bacaQrLogin('000701|')).toThrow(QrLoginTidakTerbaca);
    expect(() => bacaQrLogin('   ')).toThrow(QrLoginTidakTerbaca);
  });
});

describe('label', () => {
  it('setiap jabatan dan grup punya labelnya', () => {
    for (const k of ROLE_KINDS) expect(ROLE_KIND_LABELS[k]).toBeTruthy();
    for (const g of PROCESS_GROUPS) expect(PROCESS_GROUP_LABELS[g]).toBeTruthy();
  });
});

describe('sepertiKartuLogin', () => {
  it('mengenali kartu login', () => {
    expect(sepertiKartuLogin('000701|123456')).toBe(true);
    expect(sepertiKartuLogin('ADMIN|admin123')).toBe(true);
  });

  it('kartu kanban TIDAK dianggap kartu login', () => {
    /*
     * Ini kegagalan yang paling mahal: operator lini FG men-scan kanban, lalu
     * dikeluarkan dari sesinya di tengah shift. Serinya empat angka, jadi
     * syarat panjang sandi yang menyingkirkannya.
     */
    expect(sepertiKartuLogin('BN-001|1001')).toBe(false);
    expect(sepertiKartuLogin('TB-001|9612')).toBe(false);
  });

  it('barcode part berpemisah TIDAK dianggap kartu login', () => {
    expect(sepertiKartuLogin('BL-98765-002|BN-001|9612925764la|20')).toBe(false);
    expect(sepertiKartuLogin('AV-12345-001|BN-001|SER123')).toBe(false);
  });

  it('barcode program 15 karakter tanpa pemisah', () => {
    expect(sepertiKartuLogin('12NGTEST00000A1')).toBe(false);
  });

  it('bentuk yang cacat ditolak', () => {
    expect(sepertiKartuLogin('000701')).toBe(false);
    expect(sepertiKartuLogin('|123456')).toBe(false);
    expect(sepertiKartuLogin('000701|')).toBe(false);
    // Sandi lebih pendek dari minimum yang diterima server.
    expect(sepertiKartuLogin('000701|123')).toBe(false);
    // NPK tidak pernah memuat spasi.
    expect(sepertiKartuLogin('000 701|123456')).toBe(false);
  });

  it('sandi ber-"|" tidak dianggap kartu login', () => {
    /*
     * Disengaja: dengan dua pemisah, bentuknya tidak bisa dibedakan dari
     * barcode part tiga bagian. Kartu login yang sandinya memuat "|" hanya bisa
     * dipakai di halaman masuk, tempat tidak ada barcode lain yang bersaing.
     */
    expect(sepertiKartuLogin('000701|a|bcdef')).toBe(false);
  });

  it('yang lolos saringan selalu bisa dibaca bacaQrLogin', () => {
    // Saringan yang meloloskan bentuk yang kemudian gagal diurai akan membuat
    // operator melihat "kartu tidak terbaca" untuk barcode yang sebenarnya
    // bukan kartu sama sekali.
    for (const kartu of ['000701|123456', 'ADMIN|admin123', 'a.b-c_d|rahasia']) {
      expect(sepertiKartuLogin(kartu)).toBe(true);
      expect(() => bacaQrLogin(kartu)).not.toThrow();
    }
  });
});
