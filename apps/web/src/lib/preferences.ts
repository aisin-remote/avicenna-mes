/**
 * Preferensi tampilan milik tiap pengguna.
 *
 * Disimpan di COOKIE, bukan di database: ini pilihan per PERANGKAT, bukan per
 * akun. Layar stasiun di lantai produksi dipakai bergantian oleh banyak
 * operator dengan satu akun, sementara mode gelap atau sidebar ringkas
 * ditentukan oleh monitor dan pencahayaan di tempat itu — bukan oleh siapa yang
 * sedang login.
 *
 * Nilai tema dan warna DIPASANG sebagai atribut pada elemen <html> supaya CSS
 * yang mengurus tampilannya. Dengan begitu preferensi juga berlaku di layar
 * stasiun yang tidak memakai kerangka aplikasi.
 *
 * ── Kenapa cookie, bukan localStorage ───────────────────────────────────────
 *
 * Server perlu tahu temanya untuk bisa menstempel <html> pada HTML pertama.
 * localStorage tidak terbaca server, jadi dulu ada skrip kecil di <head> yang
 * membacanya sebelum halaman digambar. React 19 tidak lagi menjalankan <script>
 * yang dirender di pohon komponen dan memperingatkannya di konsol setiap kali.
 *
 * Cookie ikut terkirim bersama permintaan, jadi server bisa langsung
 * menstempelnya — tanpa skrip, tanpa kilatan, dan tetap berlaku sebelum satu
 * baris JavaScript pun dimuat.
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

/**
 * Nama cookie. Sengaja tanpa titik dua: karakter itu tidak sah pada nama cookie
 * dan akan ditolak browser tanpa pesan apa pun.
 */
export const PREFERENCES_COOKIE = 'avicenna_prefs';

/**
 * Tema yang SUDAH diselesaikan, ikut disimpan bersama preferensinya.
 *
 * Pilihan 'system' tidak bisa diselesaikan server — ia tidak tahu pengaturan OS
 * pengunjung. Yang menyelesaikannya klien, lalu hasilnya ikut ditulis ke cookie
 * supaya kunjungan berikutnya sudah benar sejak HTML pertama.
 */
export interface StoredPreferences extends Preferences {
  resolved: 'light' | 'dark';
}

export function serializePreferences(prefs: Preferences, resolved: 'light' | 'dark'): string {
  return JSON.stringify({ ...prefs, resolved });
}

/** Membaca isi cookie; nilai rusak atau tidak dikenal jatuh ke bawaan. */
export function parseStoredPreferences(raw: string | undefined | null): StoredPreferences {
  const prefs = readPreferences(raw ?? null);
  let resolved: 'light' | 'dark' = 'light';
  try {
    const parsed = JSON.parse(raw ?? '{}') as Partial<StoredPreferences>;
    if (parsed.resolved === 'dark' || parsed.resolved === 'light') resolved = parsed.resolved;
    else if (prefs.theme !== 'system') resolved = prefs.theme;
  } catch {
    /* bawaan sudah benar */
  }
  return { ...prefs, resolved };
}

/**
 * Atribut untuk elemen <html>.
 *
 * Dipakai server saat merender, dan klien saat preferensi berubah — supaya
 * keduanya tidak bisa menyimpang satu sama lain.
 */
export function htmlAttributes(stored: StoredPreferences) {
  return {
    'data-theme': stored.resolved,
    'data-accent': stored.accent,
    'data-sidebar': stored.sidebar,
  } as const;
}

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
