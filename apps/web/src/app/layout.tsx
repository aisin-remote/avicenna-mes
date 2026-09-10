import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Avicenna MES',
  description: 'Manufacturing Execution System - AIIA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
