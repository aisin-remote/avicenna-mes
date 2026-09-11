'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { durations, easeSoft } from '../motion/transitions';

/**
 * Kerangka aplikasi: sidebar, topbar, dan area isi.
 *
 * Ada di sisi klien karena tombol menu di topbar dan sidebar harus berbagi
 * satu keadaan buka/tutup. `children` tetap dirender di server dan dioper
 * lewat sini — komponen klien boleh menerima hasil render server sebagai anak,
 * jadi halaman di bawahnya tidak ikut menjadi komponen klien.
 *
 * Di layar lebar (>= lg) sidebar menjadi bagian tetap dari tata letak. Di
 * bawah itu ia berubah menjadi panel geser: pada tablet portrait, sidebar
 * selebar 264px memakan lebih dari separuh layar, dan tabel muatan yang
 * kolomnya banyak jadi tidak terbaca.
 */
export function ShellFrame({
  userName,
  role,
  children,
}: {
  userName: string;
  role: string | null;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  // Menutup sendiri setelah berpindah halaman. Tanpa ini panel tetap menutupi
  // halaman yang baru saja dibuka, dan pengguna harus menutupnya dua kali.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Esc menutup panel — kebiasaan yang berlaku untuk semua lapisan menutup.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <div className="flex h-dvh overflow-hidden bg-shell">
      <Sidebar userName={userName} role={role} open={menuOpen} />

      {/* Lapisan gelap hanya muncul saat panel geser terbuka di layar sempit. */}
      <AnimatePresence>
        {menuOpen ? (
          <motion.button
            type="button"
            aria-label="Tutup menu navigasi"
            onClick={() => setMenuOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="fixed inset-0 z-40 cursor-default bg-ink/30 lg:hidden"
          />
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          userName={userName}
          role={role}
          navOpen={menuOpen}
          onToggleNav={() => setMenuOpen((v) => !v)}
        />
        {/* Hanya area ini yang menggulir, sehingga sidebar dan topbar tetap diam. */}
        <main className="scroll-slim flex-1 overflow-y-auto bg-surface">{children}</main>
      </div>
    </div>
  );
}
