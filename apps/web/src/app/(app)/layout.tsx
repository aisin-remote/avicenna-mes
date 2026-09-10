import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';

/**
 * Kerangka aplikasi.
 *
 * Pemeriksaan sesi dilakukan di layout supaya setiap halaman di bawahnya
 * terlindungi tanpa perlu mengulang pengecekan satu per satu.
 *
 * Seluruh aplikasi diletakkan di dalam "shell" putih membulat yang mengapung
 * di atas kanvas hangat — mengikuti referensi desain. Shell ini yang memberi
 * kesan aplikasi, bukan halaman web biasa.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="min-h-screen p-3 sm:p-5">
      <div className="mx-auto flex h-[calc(100vh-1.5rem)] max-w-[1680px] overflow-hidden rounded-panel bg-shell shadow-shell sm:h-[calc(100vh-2.5rem)]">
        <Sidebar userName={user.name} role={user.role} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar userName={user.name} role={user.role} />
          {/* Hanya area ini yang menggulir, sehingga sidebar dan topbar tetap diam. */}
          <main className="scroll-slim flex-1 overflow-y-auto bg-surface">{children}</main>
        </div>
      </div>
    </div>
  );
}
