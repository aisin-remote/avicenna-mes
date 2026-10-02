import { describe, it, expect } from 'vitest';
import {
  modeLoading,
  perluKanbanInternal,
  perluKanbanCustomer,
  adaScanPerBox,
  MODE_LOADING,
  MODE_LOADING_INSTRUKSI,
  deliveryAttentionReason,
} from './loading-mode';

/** Pabrik UNIT tidak men-scan customer direct kanban; pabrik BODY men-scan. */
const UNIT = { plantScanDirectKanban: false };
const BODY = { plantScanDirectKanban: true };

describe('modeLoading', () => {
  it('customer biasa selalu tiga arah, di pabrik mana pun', () => {
    expect(modeLoading({ ...UNIT, directKanban: false })).toBe('TIGA_ARAH');
    expect(modeLoading({ ...BODY, directKanban: false })).toBe('TIGA_ARAH');
  });

  it('direct kanban di UNIT: tidak scan apa pun', () => {
    expect(modeLoading({ ...UNIT, directKanban: true })).toBe('TANPA_SCAN');
  });

  it('direct kanban di BODY: scan kanban customer', () => {
    expect(modeLoading({ ...BODY, directKanban: true })).toBe('KANBAN_CUSTOMER');
  });

  it('sifat pabrik tidak berpengaruh pada customer biasa', () => {
    // Kalau ini pernah berubah, customer biasa di salah satu pabrik akan
    // berhenti mencocokkan kanban internal tanpa ada yang meminta.
    expect(modeLoading({ ...UNIT, directKanban: false })).toBe(
      modeLoading({ ...BODY, directKanban: false }),
    );
  });
});

describe('apa yang harus discan', () => {
  it('kanban internal HANYA pada tiga arah', () => {
    expect(perluKanbanInternal('TIGA_ARAH')).toBe(true);
    expect(perluKanbanInternal('KANBAN_CUSTOMER')).toBe(false);
    expect(perluKanbanInternal('TANPA_SCAN')).toBe(false);
  });

  it('kanban customer pada tiga arah dan kanban-customer', () => {
    expect(perluKanbanCustomer('TIGA_ARAH')).toBe(true);
    expect(perluKanbanCustomer('KANBAN_CUSTOMER')).toBe(true);
    expect(perluKanbanCustomer('TANPA_SCAN')).toBe(false);
  });

  it('hanya TANPA_SCAN yang tidak men-scan per box', () => {
    expect(adaScanPerBox('TIGA_ARAH')).toBe(true);
    expect(adaScanPerBox('KANBAN_CUSTOMER')).toBe(true);
    expect(adaScanPerBox('TANPA_SCAN')).toBe(false);
  });

  it('mode yang tidak men-scan apa pun tidak menuntut kanban apa pun', () => {
    // Menjaga ketiganya konsisten: mode tanpa scan per box tidak boleh
    // diam-diam masih mewajibkan salah satu kanban.
    for (const m of MODE_LOADING) {
      if (!adaScanPerBox(m)) {
        expect(perluKanbanInternal(m)).toBe(false);
        expect(perluKanbanCustomer(m)).toBe(false);
      }
    }
  });

  it('kanban internal tidak pernah diminta tanpa kanban customer', () => {
    // Kanban internal sendirian tidak membuktikan apa pun terhadap customer.
    for (const m of MODE_LOADING) {
      if (perluKanbanInternal(m)) expect(perluKanbanCustomer(m)).toBe(true);
    }
  });
});

describe('instruksi operator', () => {
  it('setiap mode punya instruksinya', () => {
    for (const m of MODE_LOADING) expect(MODE_LOADING_INSTRUKSI[m]).toBeTruthy();
  });
});

describe('perlu tindakan delivery', () => {
  const normal = {
    status: 'LOADING',
    plannedKanban: 10,
    pickedKanban: 10,
    actualKanban: 7,
    sapStatus: null,
  };

  it('loading yang masih berjalan bukan exception', () => {
    expect(deliveryAttentionReason(normal)).toBeNull();
  });

  it('menandai selisih setelah tahapan ditutup', () => {
    expect(deliveryAttentionReason({ ...normal, pickedKanban: 8 })).toBe(
      'Pulling selesai dengan kekurangan',
    );
    expect(deliveryAttentionReason({ ...normal, status: 'SHIPPED', actualKanban: 8 })).toBe(
      'Pengiriman berangkat dengan kekurangan',
    );
  });

  it('masalah Good Issue SAP diprioritaskan', () => {
    expect(deliveryAttentionReason({ ...normal, sapStatus: 'REJECTED' })).toBe(
      'Good Issue ditolak SAP',
    );
  });
});
