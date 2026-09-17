import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { PreferencesProvider } from '@/components/shell/preferences-provider';
import {
  PREFERENCES_COOKIE,
  parseStoredPreferences,
  htmlAttributes,
} from '@/lib/preferences';
import './globals.css';

/**
 * Plus Jakarta Sans dipilih karena bentuk geometrisnya dekat dengan referensi
 * desain, x-height-nya tinggi (terbaca dari jarak jauh di lantai produksi),
 * dan angkanya jelas — penting untuk layar yang isinya kebanyakan angka.
 */
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Avicenna MES',
  description: 'Manufacturing Execution System — AIIA',
};

/**
 * Tema dipasang SERVER, bukan skrip di <head>.
 *
 * ── Kenapa berubah dari skrip ke cookie ─────────────────────────────────────
 *
 * Sebelumnya ada skrip kecil yang membaca localStorage sebelum halaman
 * digambar. React 19 tidak lagi menjalankan <script> yang dirender di dalam
 * pohon komponen — pada klien ia hanya dibuat lalu diabaikan — dan
 * memperingatkannya di konsol setiap kali halaman dimuat.
 *
 * Preferensi sekarang ikut sebagai cookie, jadi atributnya sudah terpasang di
 * HTML pertama: tanpa skrip, tanpa kilatan, dan tetap berlaku sebelum satu
 * baris JavaScript pun dimuat.
 *
 * Konsekuensi yang disengaja: membaca cookie membuat layout ini dirender
 * dinamis. Seluruh halaman aplikasi ini memang sudah dinamis karena datanya
 * berubah tiap saat; yang berpindah hanya /login.
 *
 * Kunjungan PERTAMA di sebuah browser belum punya cookie, jadi pengguna mode
 * gelap akan melihat satu kali kilatan terang sebelum pilihannya tersimpan.
 * Sesudah itu tidak pernah lagi. Menghilangkan kilatan pertama itu menuntut
 * blok mode gelap kedua di dalam @media prefers-color-scheme — tempat kedua
 * yang harus dijaga tetap sama dengan yang pertama, dan cepat atau lambat
 * keduanya akan berbeda.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const stored = parseStoredPreferences(jar.get(PREFERENCES_COOKIE)?.value);

  return (
    <html
      lang="id"
      className={jakarta.variable}
      {...htmlAttributes(stored)}
      // Memberi tahu browser warna asli halaman, supaya scrollbar dan kolom
      // isian bawaan ikut gelap alih-alih tetap putih menyilaukan.
      style={{ colorScheme: stored.resolved }}
      suppressHydrationWarning
    >
      <body className="min-h-screen font-[family-name:var(--font-sans)] antialiased">
        <PreferencesProvider initial={stored}>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
