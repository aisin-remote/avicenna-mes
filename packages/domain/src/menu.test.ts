import { describe, it, expect } from 'vitest';
import {
  MENU_ITEMS,
  MENU_GROUPS,
  MENU_GROUP_COLLAPSIBLE,
  MENU_KEYS_DAPAT_DIBERIKAN,
  MASTER_ENTITIES,
  menuByKey,
  isMenuKey,
} from '@avicenna/contracts';

describe('katalog menu', () => {
  it('tidak ada DUA menu yang alamatnya sama', () => {
    /*
     * Pernah terjadi: "Matriks Rute Part" dan "Rute Proses" sama-sama menunjuk
     * /master/part-processes. Di sidebar tampak dua baris berbeda yang membuka
     * halaman yang sama persis, dan orang yang menekan keduanya mengira salah
     * satunya rusak.
     *
     * Tidak ada galat apa pun yang muncul dari keadaan itu — hanya bisa
     * ketahuan kalau diperiksa seperti ini.
     */
    const perAlamat = new Map<string, string[]>();
    for (const m of MENU_ITEMS) {
      perAlamat.set(m.href, [...(perAlamat.get(m.href) ?? []), m.key]);
    }
    const kembar = [...perAlamat.entries()].filter(([, keys]) => keys.length > 1);
    expect(kembar, `alamat dipakai lebih dari satu menu: ${JSON.stringify(kembar)}`).toEqual([]);
  });

  it('kunci menu unik', () => {
    // Kunci inilah yang disimpan di TM_ROLE_MENU. Dua menu berkunci sama
    // berarti memberi hak atas yang satu diam-diam memberi hak atas yang lain.
    const kunci = MENU_ITEMS.map((m) => m.key);
    expect(new Set(kunci).size).toBe(kunci.length);
  });

  it('setiap alamat dimulai dengan "/"', () => {
    for (const m of MENU_ITEMS) expect(m.href.startsWith('/'), m.key).toBe(true);
  });

  it('setiap menu masuk grup yang dikenal, dan grupnya punya sifat lipat', () => {
    for (const m of MENU_ITEMS) {
      expect(MENU_GROUPS).toContain(m.group);
      expect(typeof MENU_GROUP_COLLAPSIBLE[m.group]).toBe('boolean');
    }
  });

  it('setiap entitas master punya menunya', () => {
    // Entitas master baru yang tidak muncul di menu adalah halaman yang ada
    // tetapi tidak pernah dilihat siapa pun.
    for (const e of MASTER_ENTITIES) {
      expect(isMenuKey(`master.${e}`), `menu untuk entitas ${e}`).toBe(true);
    }
  });

  it('menu adminOnly TIDAK bisa diberikan lewat layar hak akses', () => {
    /*
     * Layar yang bisa mengubah hak akses tidak boleh bisa diberikan lewat layar
     * hak akses itu sendiri — sekali salah centang, siapa pun bisa menaikkan
     * haknya sendiri dan tidak ada jalan mundur selain menyunting database.
     */
    for (const m of MENU_ITEMS) {
      if (m.adminOnly) expect(MENU_KEYS_DAPAT_DIBERIKAN).not.toContain(m.key);
    }
    expect(MENU_KEYS_DAPAT_DIBERIKAN.length).toBeGreaterThan(0);
  });

  it('menuByKey menemukan yang ada, dan menolak yang tidak', () => {
    expect(menuByKey('dashboard')?.href).toBe('/dashboard');
    expect(menuByKey('tidak-ada')).toBeUndefined();
  });
});
