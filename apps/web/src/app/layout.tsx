import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { PreferencesProvider } from '@/components/shell/preferences-provider';
import { PREFERENCES_KEY } from '@/lib/preferences';
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

/*
 * Dijalankan SEBELUM halaman digambar, jadi tema tersimpan sudah terpasang
 * pada gambar pertama.
 *
 * Tanpa ini pengguna mode gelap akan melihat kilatan putih setiap kali membuka
 * halaman: server tidak tahu isi localStorage, jadi ia selalu mengirim tema
 * terang, dan React baru membetulkannya setelah JavaScript-nya jalan. Di layar
 * produksi yang menyala sepanjang shift, kilatan itu menyilaukan.
 *
 * Sengaja tidak memakai impor supaya tetap satu blok kecil yang berdiri
 * sendiri — kode ini berjalan sebelum bundel apa pun dimuat.
 */
const NO_FLASH = `
(function () {
  try {
    var p = JSON.parse(localStorage.getItem(${JSON.stringify(PREFERENCES_KEY)}) || '{}');
    var t = p.theme === 'light' || p.theme === 'dark' ? p.theme
      : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    var r = document.documentElement;
    r.dataset.theme = t;
    r.style.colorScheme = t;
    if (p.accent) r.dataset.accent = p.accent;
    if (p.sidebar) r.dataset.sidebar = p.sidebar;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="min-h-screen font-[family-name:var(--font-sans)] antialiased">
        <PreferencesProvider>{children}</PreferencesProvider>
      </body>
    </html>
  );
}
