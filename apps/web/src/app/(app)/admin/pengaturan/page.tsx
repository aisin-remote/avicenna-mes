import { Cpu, Share2, ShieldAlert, SlidersHorizontal } from 'lucide-react';
import { grupPengaturan } from '@avicenna/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { SettingSwitch } from '@/components/admin/setting-switch';
import { ambilPengaturan } from './actions';

export const dynamic = 'force-dynamic';

/* Ikon per grup. Grup baru tanpa entri di sini tetap tampil, pakai ikon umum —
   menambah pengaturan tidak boleh membuat halamannya gagal dirender. */
const IKON: Record<string, typeof SlidersHorizontal> = {
  SAP: Share2,
  Mesin: Cpu,
};

/**
 * Pengaturan sistem.
 *
 * Kewenangannya ditegakkan API (@AdminOnly di SettingController), bukan
 * halaman ini — sama seperti layar pengguna. Menyembunyikan menunya saja bukan
 * pembatasan.
 *
 * Yang TIDAK ada di sini: host, nama database, user, password, dan JWT_SECRET.
 * Alasannya ada di @avicenna/contracts/setting — singkatnya, password yang
 * pernah tampil di browser harus dianggap sudah bocor.
 */
export default async function AdminSettingsPage() {
  const { definisi, nilai } = await ambilPengaturan();
  const petaNilai = new Map(nilai.map((n) => [n.key, n]));
  const grup = grupPengaturan().filter((g) => definisi.some((d) => d.grup === g));

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Administrasi' }, { label: 'Pengaturan Sistem' }]}
        title="Pengaturan Sistem"
        description="Saklar yang menentukan apakah sistem ini berbicara dengan sistem lain"
      />

      <div className="mb-5 flex max-w-[78ch] items-start gap-2.5 rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] leading-relaxed text-ink-muted">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
        <span>
          Alamat server, nama database, user, dan password SAP tetap di berkas{' '}
          <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px]">.env</code> di
          server, dan sengaja tidak bisa dilihat maupun diubah dari sini. Halaman ini hanya
          menyalakan dan mematikan.
        </span>
      </div>

      <div className="space-y-5">
        {grup.map((g) => {
          const isi = definisi.filter((d) => d.grup === g);
          return (
            <Card key={g}>
              <CardHeader
                icon={IKON[g] ?? SlidersHorizontal}
                title={g}
                subtitle={`${isi.length} pengaturan`}
              />
              <div>
                {isi.map((def) => {
                  const n = petaNilai.get(def.key);
                  if (!n) return null;
                  return <SettingSwitch key={def.key} def={def} nilai={n} />;
                })}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
