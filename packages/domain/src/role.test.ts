import { BARIS_UJI, KATALOG_UJI } from './katalog-uji';
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

describe('grupProses', () => {
  it('WIP dan FG masuk grup yang sama', () => {
    // "Casting lasman" satu orang, mengurus lini Casting WIP maupun Casting FG.
    expect(grupProses(KATALOG_UJI, 'CASTING_WIP')).toBe('CASTING');
    expect(grupProses(KATALOG_UJI, 'CASTING_FG')).toBe('CASTING');
    expect(grupProses(KATALOG_UJI, 'MACHINING_WIP')).toBe('MACHINING');
    expect(grupProses(KATALOG_UJI, 'MACHINING_FG')).toBe('MACHINING');
  });

  it('assembling kedua pabrik masuk grup yang sama', () => {
    expect(grupProses(KATALOG_UJI, 'ASSEMBLING_UNIT_FG')).toBe('ASSEMBLING');
    expect(grupProses(KATALOG_UJI, 'ASSEMBLING_BODY_FG')).toBe('ASSEMBLING');
  });

  it('setiap jenis proses punya grupnya — tidak ada yang tercecer', () => {
    // Menambah jenis proses tanpa menentukan grupnya akan membuat role tidak
    // pernah cocok dengan lini itu, tanpa error apa pun.
    for (const p of KATALOG_UJI.kode) {
      expect(PROCESS_GROUPS).toContain(grupProses(KATALOG_UJI, p));
    }
  });

  it('prosesDalamGrup mengembalikan seluruh anggotanya', () => {
    expect(prosesDalamGrup(KATALOG_UJI, 'CASTING').sort()).toEqual(['CASTING_FG', 'CASTING_WIP']);
    expect(prosesDalamGrup(KATALOG_UJI, 'MELTING')).toEqual(['MELTING']);
  });
});

describe('halamanAwal', () => {
  it('operator PPIC langsung ke scan delivery, tanpa mengubah tujuan admin dan viewer', () => {
    expect(halamanAwal({ kind: 'SCANNING', processGroup: 'DELIVERY' })).toBe('/delivery-scan');
    expect(halamanAwal({ kind: 'ADMIN', processGroup: 'DELIVERY' })).toBe('/dashboard');
    expect(halamanAwal({ kind: 'VIEW', processGroup: 'DELIVERY' })).toBe('/monitor?proses=delivery');
  });
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
  it('operator PPIC tidak mendapat lingkup scan produksi', () => {
    for (const { code: proses } of BARIS_UJI) {
      expect(bolehScanDi(KATALOG_UJI, { kind: 'SCANNING', processGroup: 'DELIVERY' }, proses)).toBe(
        proses === 'DELIVERY',
      );
    }
  });
  it('lasman casting boleh di kedua lini casting', () => {
    const r = { kind: 'SCANNING', processGroup: 'CASTING' } as const;
    expect(bolehScanDi(KATALOG_UJI, r, 'CASTING_WIP')).toBe(true);
    expect(bolehScanDi(KATALOG_UJI, r, 'CASTING_FG')).toBe(true);
  });

  it('lasman casting TIDAK boleh di lini machining', () => {
    const r = { kind: 'SCANNING', processGroup: 'CASTING' } as const;
    expect(bolehScanDi(KATALOG_UJI, r, 'MACHINING_WIP')).toBe(false);
  });

  it('jp dan leader tidak men-scan sama sekali', () => {
    // Mereka memeriksa data. Membiarkannya men-scan berarti hasil produksi bisa
    // bertambah dari orang yang tidak berdiri di lini.
    expect(bolehScanDi(KATALOG_UJI, { kind: 'VIEW', processGroup: 'CASTING' }, 'CASTING_WIP')).toBe(false);
  });

  it('admin boleh di mana saja', () => {
    for (const p of KATALOG_UJI.kode) {
      expect(bolehScanDi(KATALOG_UJI, { kind: 'ADMIN' }, p)).toBe(true);
    }
  });

  it('scanning tanpa lingkup boleh di mana saja', () => {
    expect(bolehScanDi(KATALOG_UJI, { kind: 'SCANNING' }, 'PAINTING_WIP')).toBe(true);
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
