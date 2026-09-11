/**
 * Preferensi tampilan milik tiap pengguna.
 *
 * Disimpan di localStorage, bukan di database: ini pilihan per PERANGKAT, bukan
 * per akun. Layar stasiun di lantai produksi dipakai bergantian oleh banyak
 * operator dengan satu akun, sementara mode gelap atau sidebar ringkas
 * ditentukan oleh monitor dan pencahayaan di tempat itu — bukan oleh siapa yang
 * sedang login.
 *
 * Nilai tema dan warna DIPASANG sebagai atribut pada elemen <html> supaya CSS
 * yang mengurus tampilannya. Dengan begitu preferensi juga berlaku di layar
 * stasiun yang tidak memakai kerangka aplikasi.
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ACCENTS = ['hitam', 'biru', 'hijau', 'jingga', 'ungu'] as const;
export type Accent = (typeof ACCENTS)[number];

export const SIDEBAR_MODES = ['penuh', 'ikon'] as const;
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export interface Preferences {
  theme: Theme;
  accent: Accent;
  sidebar: SidebarMode;
  /** Bunyi umpan balik saat scan. Mati di ruangan yang butuh senyap. */
  scanSound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  accent: 'hitam',
  sidebar: 'penuh',
  scanSound: true,
};

export const PREFERENCES_KEY = 'avicenna:preferences';

/** Membaca preferensi tersimpan; nilai rusak atau tidak dikenal diabaikan. */
export function readPreferences(raw: string | null): Preferences {
  if (!raw) return DEFAULT_PREFERENCES;
  try {
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: THEMES.includes(parsed.theme as Theme) ? (parsed.theme as Theme) : DEFAULT_PREFERENCES.theme,
      accent: ACCENTS.includes(parsed.accent as Accent)
        ? (parsed.accent as Accent)
        : DEFAULT_PREFERENCES.accent,
      sidebar: SIDEBAR_MODES.includes(parsed.sidebar as SidebarMode)
        ? (parsed.sidebar as SidebarMode)
        : DEFAULT_PREFERENCES.sidebar,
      scanSound:
        typeof parsed.scanSound === 'boolean' ? parsed.scanSound : DEFAULT_PREFERENCES.scanSound,
    };
  } catch {
    // Isi yang tidak bisa dibaca bukan alasan untuk menggagalkan halaman.
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Menerjemahkan pilihan tema menjadi nilai yang benar-benar dipakai.
 *
 * 'system' diselesaikan di sini, bukan di CSS. Dengan satu nilai pasti yang
 * dipasang di <html>, CSS hanya perlu satu blok untuk mode gelap — bukan dua
 * blok kembar yang harus dijaga tetap sama.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}

export const THEME_LABELS: Record<Theme, string> = {
  system: 'Ikut sistem',
  light: 'Terang',
  dark: 'Gelap',
};

export const ACCENT_LABELS: Record<Accent, string> = {
  hitam: 'Hitam',
  biru: 'Biru',
  hijau: 'Hijau',
  jingga: 'Jingga',
  ungu: 'Ungu',
};

export const SIDEBAR_LABELS: Record<SidebarMode, string> = {
  penuh: 'Ikon dan nama',
  ikon: 'Ikon saja',
};
