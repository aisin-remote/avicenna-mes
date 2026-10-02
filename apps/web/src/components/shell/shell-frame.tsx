'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import { Sidebar } from './sidebar';
import type { NavGroup } from './nav-config';
import type { PenggunaShell } from './pengguna';
import { Topbar } from './topbar';
import { SettingsPanel } from './settings-panel';
import { usePreferences } from './preferences-provider';
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
  pengguna,
  navGroups,
  children,
}: {
  /** Identitas yang sedang masuk — dibaca server dari database. */
  pengguna: PenggunaShell;
  /** Menu yang boleh dilihat orang ini — disusun di server. */
  navGroups: NavGroup[];
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pathname = usePathname();
  const { prefs } = usePreferences();

  // Menutup sendiri setelah berpindah halaman. Tanpa ini panel tetap menutupi
  // halaman yang baru saja dibuka, dan pengguna harus menutupnya dua kali.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  /*
   * Panel geser ditutup begitu layar melebar melewati lg.
   *
   * Di atas lg sidebar kembali menjadi bagian tetap tata letak, dan keadaan
   * "terbuka" yang tertinggal membuat mode ikon tidak berlaku — pengguna
   * memilih ikon saja tetapi sidebar tetap lebar sampai halaman dimuat ulang.
   */
  useEffect(() => {
    const lebar = window.matchMedia('(min-width: 1024px)');
    const tutupBilaLebar = () => {
      if (lebar.matches) setMenuOpen(false);
    };
    tutupBilaLebar();
    lebar.addEventListener('change', tutupBilaLebar);
    return () => lebar.removeEventListener('change', tutupBilaLebar);
  }, []);

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
      <Sidebar pengguna={pengguna} groups={navGroups} open={menuOpen} mode={prefs.sidebar} />

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
            // Hitam tetap, bukan token ink: di mode gelap ink menjadi terang,
            // dan lapisan penutupnya justru akan menyilaukan.
            className="fixed inset-0 z-40 cursor-default bg-black/40 lg:hidden"
          />
        ) : null}
      </AnimatePresence>

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          pengguna={pengguna}
          groups={navGroups}
          navOpen={menuOpen}
          onToggleNav={() => setMenuOpen((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {/* Hanya area ini yang menggulir, sehingga sidebar dan topbar tetap diam. */}
        <main className="scroll-slim flex-1 overflow-y-auto bg-surface">{children}</main>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
