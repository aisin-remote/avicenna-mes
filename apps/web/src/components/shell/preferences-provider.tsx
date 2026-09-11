'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_KEY,
  readPreferences,
  resolveTheme,
  type Preferences,
} from '@/lib/preferences';

interface PreferencesContextValue {
  prefs: Preferences;
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/**
 * Menyimpan dan menerapkan preferensi tampilan.
 *
 * Render pertama SELALU memakai nilai bawaan, lalu nilai tersimpan dibaca di
 * useEffect. Membaca localStorage saat render akan membuat hasil render server
 * dan klien berbeda, dan React membatalkan hidrasinya — halaman tetap tampil
 * tetapi tombol dan formulir diam saja tanpa pesan error apa pun.
 *
 * Supaya tidak ada kedipan tema, atribut pada <html> sudah dipasang lebih dulu
 * oleh skrip kecil di root layout, sebelum halaman digambar. Efek di sini hanya
 * menyamakan keadaan React dengan apa yang sudah terpasang.
 */
export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(PREFERENCES_KEY);
    } catch {
      // Penyimpanan bisa diblokir (mode privat, kebijakan perangkat). Bukan
      // alasan untuk menggagalkan halaman — nilai bawaan tetap jalan.
    }
    setPrefs(readPreferences(stored));
    setLoaded(true);
  }, []);

  // Menerapkan ke <html> supaya CSS yang mengurus tampilannya, dan preferensi
  // ikut berlaku di layar stasiun yang tidak memakai kerangka aplikasi.
  useEffect(() => {
    if (!loaded) return;
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      root.dataset.theme = resolveTheme(prefs.theme, media.matches);
      root.dataset.accent = prefs.accent;
      root.dataset.sidebar = prefs.sidebar;
      // Memberi tahu browser warna asli halaman, supaya scrollbar dan kolom
      // isian bawaan ikut gelap alih-alih tetap putih menyilaukan.
      root.style.colorScheme = resolveTheme(prefs.theme, media.matches);
    };
    apply();

    // Saat mengikuti sistem, tema harus ikut berubah ketika pengaturan OS
    // berganti — tanpa perlu memuat ulang halaman.
    if (prefs.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs, loaded]);

  const set = useCallback<PreferencesContextValue['set']>((key, value) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      try {
        window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      } catch {
        // Tersimpan atau tidak, pilihannya tetap berlaku untuk sesi ini.
      }
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPrefs(DEFAULT_PREFERENCES);
    try {
      window.localStorage.removeItem(PREFERENCES_KEY);
    } catch {
      /* lihat catatan di atas */
    }
  }, []);

  const value = useMemo(() => ({ prefs, set, reset }), [prefs, set, reset]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

/**
 * Preferensi yang sedang berlaku.
 *
 * Di luar provider — misalnya layar stasiun yang punya kerangka sendiri —
 * dikembalikan nilai bawaan, bukan melempar error. Tema dan warna di sana sudah
 * diurus CSS lewat atribut di <html>.
 */
export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (ctx) return ctx;
  return { prefs: DEFAULT_PREFERENCES, set: () => {}, reset: () => {} };
}
