import { ambilRole, ambilKatalogMenu } from '../actions';
import { PageHeader } from '@/components/ui/page-header';
import { RoleEditor } from '@/components/admin/role-editor';

export const dynamic = 'force-dynamic';

/**
 * Role dan hak menunya.
 *
 * Role di sini MENENTUKAN TINDAKAN, bukan sekadar mengumpulkan hak: jabatannya
 * menentukan halaman awal sesudah login dan lini mana yang boleh discan, dan
 * lingkup prosesnya menyaring keduanya. Karena itu satu orang memegang satu
 * role — dengan dua, "halaman awal" tidak punya jawaban.
 */
export default async function AdminRolesPage() {
  const [roles, katalog] = await Promise.all([ambilRole(), ambilKatalogMenu()]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administrasi' }, { label: 'Role & Hak Menu' }]}
        title="Role & Hak Menu"
        description="Jabatan, lingkup proses, dan menu yang boleh dilihat pemegangnya"
      />
      <RoleEditor roles={roles} katalog={katalog} />
    </>
  );
}
