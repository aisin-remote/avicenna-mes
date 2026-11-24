import type { NgKoreksiDaftar, NgType } from '@avicenna/contracts';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/ui/page-header';
import { KoreksiNg } from '@/components/ng/koreksi-ng';

export const dynamic = 'force-dynamic';

/**
 * Koreksi NG — leader dan QC (Handika, 19 Nov 2026).
 *
 * Qty atau jenis NG diubah, atau NG dibatalkan, dengan alasan wajib. Stok
 * (SLOC hasil ↔ RE) disesuaikan otomatis; NG yang sudah diterima SAP
 * dikoreksi lewat revisi baris staging aslinya (CHR_STATUS_NG = 'R').
 */
export default async function KoreksiNgPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? '';
  const [daftar, jenis] = await Promise.all([
    apiFetch<NgKoreksiDaftar>(`/ng/koreksi${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    apiFetch<{ jenis: NgType[] }>('/ng/jenis').catch(() => ({ jenis: [] as NgType[] })),
  ]);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Produksi' }, { label: 'Koreksi NG' }]}
        title="Koreksi NG"
        description="Ubah qty atau jenis NG, atau batalkan — stok dan SAP ikut menyesuaikan"
      />
      <KoreksiNg daftar={daftar} jenis={jenis.jenis} q={q} />
    </>
  );
}
