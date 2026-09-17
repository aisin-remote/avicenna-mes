import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ShieldAlert, ArrowLeft, PlugZap } from 'lucide-react';
import { getProfilSaatIni } from '@/lib/me';

/**
 * Menahan yang bukan admin sebelum halamannya dirender.
 *
 * ── Dibaca dari database, bukan dari token ──────────────────────────────────
 *
 * Versi pertama penjaga ini membaca jabatan dari isi token. Akibatnya
 * administrator sungguhan dibawa kembali ke dashboard setiap kali membuka layar
 * pengaturan, karena token di browsernya diterbitkan sebelum jabatan ikut
 * disertakan — dan tidak ada satu pesan pun yang menjelaskan sebabnya, jadi
 * satu-satunya jalan keluar (keluar lalu masuk lagi) mustahil ditebak.
 *
 * Sidebar sudah membaca haknya dari database. Sekarang penjaga ini memakai
 * sumber yang sama, sehingga keduanya tidak mungkin lagi berselisih: menu yang
 * terlihat pasti bisa dibuka.
 *
 * Ini bukan pembatasannya — yang menjaga adalah @AdminOnly di AdminController.
 * Tanpa itu, siapa pun yang punya token bisa memanggil endpoint-nya langsung
 * tanpa melewati halaman ini sama sekali.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const hasil = await getProfilSaatIni();

  // Token tidak berlaku lagi, atau akunnya sudah dinonaktifkan.
  if (hasil.keadaan === 'sesi-habis') redirect('/login');

  /*
   * API tidak menjawab: TIDAK dilempar ke halaman masuk.
   *
   * Masuk kembali tidak menolong sama sekali pada keadaan ini, dan orang yang
   * dilempar bolak-balik akan menyimpulkan sistemnya rusak. Halamannya tetap
   * tertutup — yang tidak bisa diperiksa tidak boleh dibuka — tetapi sebabnya
   * disebut apa adanya.
   */
  if (hasil.keadaan === 'tak-terbaca') return <TakTerbaca sebab={hasil.sebab} />;

  if (hasil.profil.roleKind !== 'ADMIN') return <BukanAdmin profil={hasil.profil} />;

  return <>{children}</>;
}

function TakTerbaca({ sebab }: { sebab: string }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
      <PlugZap className="size-10 text-warn" strokeWidth={1.6} aria-hidden />
      <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">
        Kewenangan tidak bisa diperiksa
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Server API tidak menjawab, jadi halaman ini ditutup sampai jawabannya jelas.
        Masuk kembali tidak akan menolong — yang perlu dilakukan adalah menyalakan
        ulang API.
      </p>
      <p className="tabular mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink-muted">
        {sebab}
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[14px] font-semibold transition-colors hover:border-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden /> Kembali ke dashboard
      </Link>
    </div>
  );
}

/**
 * Penolakan yang bisa dibaca, bukan lemparan diam-diam ke dashboard.
 *
 * Pengalihan tanpa pesan terlihat seperti halaman yang gagal dimuat: orang
 * mencobanya berkali-kali, lalu melaporkannya sebagai kerusakan. Menyebut role
 * yang sedang dipakai membuat percakapan dengan administrator selesai dalam
 * satu kalimat.
 */
function BukanAdmin({ profil }: { profil: { role: string | null; roleLabel: string | null; landing: string } }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-20 text-center">
      <ShieldAlert className="size-10 text-warn" strokeWidth={1.6} aria-hidden />
      <h1 className="mt-4 text-[22px] font-extrabold tracking-tight">
        Halaman ini untuk administrator
      </h1>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
        Role Anda saat ini{' '}
        <span className="font-semibold text-ink">
          {profil.roleLabel ?? profil.role ?? 'tanpa role'}
        </span>
        , yang tidak mencakup pengaturan pengguna dan role. Hubungi administrator
        bila Anda memang seharusnya punya akses.
      </p>
      <Link
        href={profil.landing}
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-[14px] font-semibold transition-colors hover:border-ink"
      >
        <ArrowLeft className="size-4" strokeWidth={1.8} aria-hidden /> Kembali ke halaman Anda
      </Link>
    </div>
  );
}
