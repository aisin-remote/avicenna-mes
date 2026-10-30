import { describe, it, expect } from 'vitest';
import {
  nextKanbanStatus,
  canTransition,
  InvalidKanbanTransitionError,
  resolveQtyPerKanban,
  kanbanCountFor,
  pelepasanKanban,
  productionVersionKartu,
} from './kanban';

describe('nextKanbanStatus', () => {
  it('mengikuti alur normal produksi sampai kirim', () => {
    expect(nextKanbanStatus('AVAILABLE', 'PRODUCED')).toBe('PRODUCED');
    expect(nextKanbanStatus('PRODUCED', 'STORED')).toBe('STORED');
    expect(nextKanbanStatus('STORED', 'PULLED')).toBe('PULLED');
    expect(nextKanbanStatus('PULLED', 'LOADED')).toBe('LOADED');
    expect(nextKanbanStatus('LOADED', 'DELIVERED')).toBe('DELIVERED');
  });

  it('mengizinkan direct pulling: produksi langsung ditarik tanpa masuk gudang', () => {
    expect(nextKanbanStatus('PRODUCED', 'PULLED')).toBe('PULLED');
  });

  it('menolak loncat status yang tidak masuk akal', () => {
    expect(() => nextKanbanStatus('AVAILABLE', 'DELIVERED')).toThrow(InvalidKanbanTransitionError);
    expect(() => nextKanbanStatus('AVAILABLE', 'LOADED')).toThrow(InvalidKanbanTransitionError);
    expect(() => nextKanbanStatus('AVAILABLE', 'RELEASED')).toThrow(InvalidKanbanTransitionError);
  });

  /*
   * STORED -> DELIVERED dulu ditolak di sini. Dilonggarkan ketika pelepasan
   * kartu dibangun: kartu customer direct pulling memang bisa naik truk tanpa
   * pernah dipull, dan menolaknya berarti kartu yang jelas-jelas sudah pergi
   * tidak pernah bisa ditutup catatannya.
   *
   * Yang tetap ditolak adalah kartu KOSONG yang loncat ke status akhir — itu
   * barang yang tidak pernah ada.
   */
  it('kartu yang sudah berisi boleh ditutup walau tidak lewat LOADED', () => {
    expect(nextKanbanStatus('STORED', 'DELIVERED')).toBe('DELIVERED');
    expect(nextKanbanStatus('PRODUCED', 'DELIVERED')).toBe('DELIVERED');
  });

  it('pelepasan mengembalikan kartu ke keadaan siap pakai', () => {
    expect(nextKanbanStatus('PULLED', 'RELEASED')).toBe('AVAILABLE');
    expect(nextKanbanStatus('LOADED', 'RELEASED')).toBe('AVAILABLE');
    expect(nextKanbanStatus('PRODUCED', 'RELEASED')).toBe('AVAILABLE');
  });

  describe('productionVersionKartu', () => {
  it('kartu internal mewarisi versi dari part-nya', () => {
    const h = productionVersionKartu({ owner: 'INTERNAL', versiPart: '0001' });
    expect(h.versi).toBe('0001');
    expect(h.masalah).toBeUndefined();
  });

  it('versi yang ditulis di kartu mengalahkan warisan', () => {
    const h = productionVersionKartu({ owner: 'INTERNAL', versiKartu: '0002', versiPart: '0001' });
    expect(h.versi).toBe('0002');
  });

  /*
   * Inilah syarat yang ditetapkan blueprint: tanpa Production Version, kartunya
   * tidak boleh lahir. Pesannya menunjuk master Part, bukan formulir kartu —
   * di situlah yang harus dibetulkan.
   */
  it('menolak kartu internal tanpa versi di mana pun', () => {
    const h = productionVersionKartu({ owner: 'INTERNAL' });
    expect(h.versi).toBeNull();
    expect(h.masalah).toContain('master Part');
  });

  it('spasi kosong diperlakukan sebagai tidak diisi', () => {
    expect(productionVersionKartu({ owner: 'INTERNAL', versiPart: '   ' }).masalah).toBeDefined();
  });

  it('kartu customer tidak menuntut versi', () => {
    const h = productionVersionKartu({ owner: 'CUSTOMER' });
    expect(h.versi).toBeNull();
    expect(h.masalah).toBeUndefined();
  });
});

describe('pelepasanKanban', () => {
    it('kartu internal kembali ke peredaran dan menambah putaran', () => {
      const p = pelepasanKanban('INTERNAL');
      expect(p.status).toBe('AVAILABLE');
      expect(p.event).toBe('RELEASED');
      expect(p.hitungSiklus).toBe(true);
    });

    it('kartu customer ikut barangnya dan tidak menambah putaran', () => {
      const p = pelepasanKanban('CUSTOMER');
      expect(p.status).toBe('DELIVERED');
      expect(p.event).toBe('DELIVERED');
      expect(p.hitungSiklus).toBe(false);
    });

    /* Keputusannya harus sah menurut mesin status, bukan ditulis terpisah. */
    it('hasilnya sah untuk setiap keadaan kartu yang sedang membawa barang', () => {
      for (const dari of ['PRODUCED', 'STORED', 'PULLED', 'LOADED'] as const) {
        for (const owner of ['INTERNAL', 'CUSTOMER'] as const) {
          const p = pelepasanKanban(owner);
          expect([dari, owner, nextKanbanStatus(dari, p.event)]).toEqual([dari, owner, p.status]);
        }
      }
    });
  });

  it('memperlakukan DELIVERED dan CANCELLED sebagai status akhir', () => {
    expect(canTransition('DELIVERED', 'PULLED')).toBe(false);
    expect(canTransition('CANCELLED', 'PRODUCED')).toBe(false);
    // Hanya koreksi tercatat yang boleh menyentuh status akhir.
    expect(nextKanbanStatus('DELIVERED', 'ADJUSTED')).toBe('DELIVERED');
  });

  it('PAIRED tidak mengubah status, hanya mencatat pasangan', () => {
    expect(nextKanbanStatus('PRODUCED', 'PAIRED')).toBe('PRODUCED');
    expect(nextKanbanStatus('PULLED', 'PAIRED')).toBe('PULLED');
  });
});

describe('resolveQtyPerKanban', () => {
  it('mengutamakan qty milik customer di atas standar part', () => {
    expect(resolveQtyPerKanban(20, 50)).toBe(50);
  });

  it('memakai standar part bila customer tidak punya override', () => {
    expect(resolveQtyPerKanban(20, null)).toBe(20);
    expect(resolveQtyPerKanban(20, undefined)).toBe(20);
  });

  it('menolak bila dua-duanya kosong, bukan diam-diam memakai 0', () => {
    expect(() => resolveQtyPerKanban(null, null)).toThrow(/belum diset/);
  });

  it('menolak nilai tidak masuk akal', () => {
    expect(() => resolveQtyPerKanban(0)).toThrow(/tidak valid/);
    expect(() => resolveQtyPerKanban(-5)).toThrow(/tidak valid/);
    expect(() => resolveQtyPerKanban(1.5)).toThrow(/tidak valid/);
  });
});

describe('kanbanCountFor', () => {
  it('membulatkan ke atas: sisa tetap butuh satu kanban', () => {
    expect(kanbanCountFor(100, 20)).toBe(5);
    expect(kanbanCountFor(101, 20)).toBe(6);
    expect(kanbanCountFor(1, 20)).toBe(1);
    expect(kanbanCountFor(0, 20)).toBe(0);
  });
});
