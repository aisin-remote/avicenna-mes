import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={jakarta.variable}>
      <body className="min-h-screen font-[family-name:var(--font-sans)] antialiased">
        {children}
      </body>
    </html>
  );
}
