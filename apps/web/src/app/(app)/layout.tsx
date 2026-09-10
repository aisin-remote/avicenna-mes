import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/session';
import { Sidebar } from '@/components/sidebar';

/**
 * Shell aplikasi. Pemeriksaan sesi dilakukan di layout supaya setiap halaman
 * di bawahnya terlindungi tanpa harus mengulang pengecekan satu per satu.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <Sidebar userName={user.name} role={user.role} />
      <main className="flex-1 overflow-x-auto p-8">{children}</main>
    </div>
  );
}
