import { redirect } from 'next/navigation';
import type { MenuRow } from '@avicenna/contracts';
import { getSessionUser } from '@/lib/session';
import { getProfilSaatIni } from '@/lib/me';
import { apiFetch } from '@/lib/api';
import { ShellFrame } from '@/components/shell/shell-frame';
import { susunNav, NAV_GROUPS } from '@/components/shell/nav-config';

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

  /*
   * Menu diambil dari API setiap kali halaman dimuat, bukan dibaca dari token.
   *
   * Hak yang dicabut siang ini harus hilang siang ini juga — token berumur
   * delapan jam, dan menunggunya kedaluwarsa berarti orang yang baru dipindah
   * tugas tetap melihat layar yang bukan lagi urusannya sampai besok pagi.
   *
   * API yang sedang mati TIDAK mengosongkan sidebar: navigasi yang hilang
   * terlihat seperti aplikasi rusak dan mengurung orang di halaman yang sedang
   * dibuka, termasuk dari tombol keluar. Halamannya sendiri tetap dijaga di
   * server, jadi menu cadangan ini tidak membuka apa pun yang seharusnya
   * tertutup.
   */
  let navGroups = NAV_GROUPS;
  try {
    navGroups = susunNav(await apiFetch<MenuRow[]>('/me/menus'));
  } catch {
    // Dibiarkan memakai katalog cadangan.
  }

  /*
   * Identitas di bilah atas dibaca dari database, bukan dari isi token.
   *
   * Role yang diganti siang ini harus terlihat siang ini juga. Kalau dibaca
   * dari token, orang yang baru dipindah tugas membaca jabatan lamanya di layar
   * selama delapan jam — dan itu justru layar yang ia pakai untuk memastikan
   * perpindahannya sudah berlaku.
   *
   * Saat API tidak menjawab, yang tersisa dari token tetap ditampilkan: nama
   * dan role teknisnya. Bilah atas tanpa identitas sama sekali membuat orang
   * ragu ia masih masuk atau tidak.
   */
  const hasil = await getProfilSaatIni();
  const profil = hasil.keadaan === 'ada' ? hasil.profil : null;

  return (
    <div className="app-scale-90">
      <ShellFrame
        pengguna={{
          nama: profil?.name ?? user.name,
          npk: profil?.npk ?? user.npk,
          role: profil?.roleLabel ?? profil?.role ?? user.role,
          jabatan: profil?.roleKind ?? null,
          lingkupProses: profil?.roleProcessGroup ?? null,
          pabrik: profil?.plantCode ?? null,
        }}
        navGroups={navGroups}
      >
        {children}
      </ShellFrame>
    </div>
  );
}
