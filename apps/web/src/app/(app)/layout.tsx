import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { ShellFrame } from '@/components/shell/shell-frame';

/**
 * Kerangka aplikasi.
 *
 * Pemeriksaan sesi dilakukan di layout supaya setiap halaman di bawahnya
 * terlindungi tanpa perlu mengulang pengecekan satu per satu.
 *
 * Shell memenuhi seluruh layar, tanpa kanvas tersisa di tepinya.
 *
 * Referensi desainnya memperlihatkan panel membulat yang mengapung di atas
 * kanvas hangat, dan itu memang enak dilihat pada tangkapan layar. Di meja
 * kerja sungguhan hasilnya lain: pada monitor 1920px, batas 1680px menyisakan
 * 120px kosong di kiri dan kanan — ruang yang justru dibutuhkan tabel muatan
 * dan daftar dokumen yang kolomnya banyak.
 *
 * Susunan sidebar/topbar/isi ada di ShellFrame karena tombol menu dan sidebar
 * harus berbagi satu keadaan buka/tutup, dan itu butuh sisi klien. Layout ini
 * tetap komponen server supaya pemeriksaan sesi terjadi sebelum apa pun
 * dikirim ke browser.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <ShellFrame userName={user.name} role={user.role}>
      {children}
    </ShellFrame>
  );
}
