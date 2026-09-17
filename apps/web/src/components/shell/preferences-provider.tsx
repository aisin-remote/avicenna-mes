'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  PREFERENCES_COOKIE,
  htmlAttributes,
  resolveTheme,
  serializePreferences,
  type Preferences,
  type StoredPreferences,
} from '@/lib/preferences';

interface PreferencesContextValue {
  prefs: Preferences;
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

/** Cookie berumur panjang: ini pilihan perangkat, bukan sesi login. */
const SETAHUN = 60 * 60 * 24 * 365;

function tulisCookie(prefs: Preferences, resolved: 'light' | 'dark') {
  try {
    const nilai = encodeURIComponent(serializePreferences(prefs, resolved));
    // SameSite=Lax sudah cukup: isinya hanya pilihan tampilan, bukan kredensial.
    document.cookie = `${PREFERENCES_COOKIE}=${nilai}; path=/; max-age=${SETAHUN}; samesite=lax`;
  } catch {
    // Cookie bisa diblokir kebijakan perangkat. Pilihannya tetap berlaku untuk
    // sesi ini; yang hilang hanya kemampuan server mengingatnya.
  }
}

/**
 * Menyimpan dan menerapkan preferensi tampilan.
 *
 * ── Nilai awal datang dari server ───────────────────────────────────────────
 *
 * Root layout membaca cookie dan sudah menstempel <html>, lalu mengoper hasil
 * bacaan itu ke sini sebagai `initial`. Dengan begitu render pertama klien
 * sama persis dengan render server — tidak ada ketidakcocokan hidrasi, dan
 * tidak ada kedipan tema.
 *
 * ── Yang masih dikerjakan di klien ──────────────────────────────────────────
 *
 * Hanya pilihan 'ikut sistem'. Server tidak tahu pengaturan OS pengunjung, jadi
 * klien yang menyelesaikannya lalu menuliskan hasilnya kembali ke cookie —
 * supaya kunjungan berikutnya sudah benar sejak HTML pertama.
 */
export function PreferencesProvider({
  initial,
  children,
}: {
  initial?: StoredPreferences;
  children: React.ReactNode;
}) {
  const [prefs, setPrefs] = useState<Preferences>(initial ?? DEFAULT_PREFERENCES);

  const terapkan = useCallback((next: Preferences, resolved: 'light' | 'dark') => {
    const root = document.documentElement;
    for (const [nama, nilai] of Object.entries(htmlAttributes({ ...next, resolved }))) {
      root.setAttribute(nama, nilai);
    }
    root.style.colorScheme = resolved;
  }, []);

  /*
   * Menyelaraskan 'ikut sistem' dengan pengaturan OS.
   *
   * Dua peran: membetulkan stempel server bila OS ternyata berbeda dari yang
   * tercatat di cookie, dan mengikuti perubahan pengaturan OS tanpa perlu
   * memuat ulang halaman.
   */
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const selaraskan = () => {
      const resolved = resolveTheme(prefs.theme, media.matches);
      terapkan(prefs, resolved);
      tulisCookie(prefs, resolved);
    };
    selaraskan();

    if (prefs.theme !== 'system') return;
    media.addEventListener('change', selaraskan);
    return () => media.removeEventListener('change', selaraskan);
  }, [prefs, terapkan]);

  const set = useCallback<PreferencesContextValue['set']>((key, value) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => setPrefs(DEFAULT_PREFERENCES), []);

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
