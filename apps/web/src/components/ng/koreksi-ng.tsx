'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, History, Pencil, Search, X } from 'lucide-react';
import type {
  NgKoreksiBaris,
  NgKoreksiDaftar,
  NgRevisiSapStatus,
  NgSapKeadaan,
  NgType,
} from '@avicenna/contracts';
import { koreksiNgAction } from '@/app/(app)/koreksi-ng/actions';
import { Card, CardHeader } from '../ui/card';
import { Table, Th, Td, Tr, EmptyState } from '../ui/table';
import { cn } from '../ui/cn';
import { useToast } from '../ui/toast';

const SAP_LABEL: Record<NgSapKeadaan, string> = {
  TIDAK_DIKIRIM: 'Tidak dikirim',
  BELUM_TERKIRIM: 'Belum terkirim',
  DI_STAGING: 'Di staging',
  DITERIMA_SAP: 'Diterima SAP',
  DITOLAK_SAP: 'Ditolak SAP',
  PERLU_KOREKSI: 'Belum sampai SAP',
};

const SAP_TONE: Record<NgSapKeadaan, string> = {
  TIDAK_DIKIRIM: 'border-line text-ink-muted',
  BELUM_TERKIRIM: 'border-accent/40 bg-accent/10 text-accent',
  DI_STAGING: 'border-warn/40 bg-warn/10 text-warn',
  DITERIMA_SAP: 'border-ok/40 bg-ok/10 text-ok',
  DITOLAK_SAP: 'border-ng/40 bg-ng/10 text-ng',
  PERLU_KOREKSI: 'border-ng/40 bg-ng/10 text-ng',
};

const REVISI_LABEL: Record<NgRevisiSapStatus, string> = {
  TIDAK_PERLU: 'ikut saat dikirim',
  MENUNGGU: 'menunggu dikirim ke SAP',
  TERKIRIM: 'revisi di staging',
  DITERIMA: 'revisi diterima SAP',
  DITOLAK: 'revisi ditolak SAP',
};

/**
 * Layar Koreksi NG.
 *
 * Koreksi yang NG-nya sudah diterima SAP tidak langsung terkirim: ia menunggu
 * baris staging aslinya selesai diproses, lalu didorong sebagai revisi. Status
 * itu ditampilkan per koreksi supaya leader tahu SAP sudah ikut atau belum.
 */
export function KoreksiNg({
  daftar,
  jenis,
  q,
}: {
  daftar: NgKoreksiDaftar;
  jenis: NgType[];
  q: string;
}) {
  const [sunting, setSunting] = useState<NgKoreksiBaris | null>(null);
  const [buka, setBuka] = useState<number | null>(null);
  const router = useRouter();

  return (
    <>
      {!daftar.boleh ? (
        <p className="mb-4 rounded-card border border-warn/40 bg-warn/10 px-4 py-3 text-[14px] text-warn">
          Anda hanya bisa melihat. Koreksi NG untuk leader dan QC — minta administrator mencentang
          menu <strong>Koreksi NG</strong> pada role Anda.
        </p>
      ) : null}

      <form action="/koreksi-ng" className="mb-4 flex max-w-md items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <input
            name="q"
            defaultValue={q}
            placeholder="Cari seri, nomor part, atau back number…"
            className="h-10 w-full rounded-xl border border-line bg-card pl-9 pr-3 text-[14px] outline-none focus:border-ink"
          />
        </div>
        <button type="submit" className="h-10 rounded-xl border border-line px-4 text-[14px] font-semibold hover:border-ink">
          Cari
        </button>
      </form>

      <Card>
        <CardHeader icon={ClipboardCheck} title="Catatan NG" subtitle={`${daftar.data.length} terbaru`} />
        <Table>
          <thead>
            <tr>
              <Th>Waktu</Th>
              <Th>Part</Th>
              <Th>Seri</Th>
              <Th>Line</Th>
              <Th>Jenis NG</Th>
              <Th>Qty</Th>
              <Th>SAP</Th>
              <Th align="right">Aksi</Th>
            </tr>
          </thead>
          <tbody>
            {daftar.data.length === 0 ? (
              <EmptyState colSpan={8}>Belum ada catatan NG.</EmptyState>
            ) : (
              daftar.data.map((n) => (
                <BarisNg
                  key={n.id}
                  n={n}
                  boleh={daftar.boleh}
                  terbuka={buka === n.id}
                  onRiwayat={() => setBuka(buka === n.id ? null : n.id)}
                  onSunting={() => setSunting(n)}
                />
              ))
            )}
          </tbody>
        </Table>
      </Card>

      {sunting ? (
        <FormKoreksi
          n={sunting}
          jenis={jenis}
          onTutup={() => setSunting(null)}
          onSelesai={() => {
            setSunting(null);
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

function BarisNg({
  n,
  boleh,
  terbuka,
  onRiwayat,
  onSunting,
}: {
  n: NgKoreksiBaris;
  boleh: boolean;
  terbuka: boolean;
  onRiwayat: () => void;
  onSunting: () => void;
}) {
  return (
    <>
      <Tr>
        <Td className="tabular whitespace-nowrap">
          {new Date(n.occurredAt).toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Td>
        <Td strong className="tabular">
          {n.backNumber ?? n.partNumber ?? '—'}
          <span className="block text-[12px] font-normal text-ink-muted">{n.partNumber}</span>
        </Td>
        <Td className="tabular text-[13px]">{n.serialNumber ?? '—'}</Td>
        <Td>{n.lineCode ?? '—'}</Td>
        <Td>
          {n.ngName ?? n.ngCode ?? '—'}
          <span className="block text-[12px] text-ink-muted">{n.origin === 'INLINE' ? 'Inline' : 'Outline'}</span>
        </Td>
        <Td className={cn('tabular font-semibold', n.dibatalkan && 'text-ink-muted line-through')}>
          {n.dibatalkan ? 'Batal' : n.qty}
        </Td>
        <Td>
          <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap', SAP_TONE[n.sap])}>
            {SAP_LABEL[n.sap]}
          </span>
          {n.sapDokumen ? <span className="tabular block text-[11px] text-ink-muted">{n.sapDokumen}</span> : null}
        </Td>
        <Td className="whitespace-nowrap text-right">
          {n.revisi.length > 0 ? (
            <button
              type="button"
              onClick={onRiwayat}
              className="mr-1.5 inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-semibold text-ink-muted hover:border-ink hover:text-ink"
            >
              <History className="size-3.5" aria-hidden /> {n.revisi.length}
            </button>
          ) : null}
          {boleh && !n.dibatalkan ? (
            <button
              type="button"
              onClick={onSunting}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-[12px] font-semibold hover:border-ink"
            >
              <Pencil className="size-3.5" aria-hidden /> Koreksi
            </button>
          ) : null}
        </Td>
      </Tr>
      {terbuka ? (
        <tr>
          <td colSpan={8} className="bg-surface px-4 py-3">
            <ul className="space-y-1.5 text-[13px]">
              {n.revisi.map((r) => (
                <li key={r.id} className="flex flex-wrap gap-x-3">
                  <span className="tabular text-ink-muted">
                    {new Date(r.createdAt).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="tabular font-semibold">
                    qty {r.qtyLama} → {r.qtyBaru === 0 ? 'batal' : r.qtyBaru}
                    {r.jenisLama !== r.jenisBaru ? ` · jenis ${r.jenisLama} → ${r.jenisBaru}` : ''}
                  </span>
                  <span>“{r.alasan}”</span>
                  <span className="text-ink-muted">NPK {r.npk ?? '—'}</span>
                  <span className={cn('font-semibold', r.sapStatus === 'DITOLAK' ? 'text-ng' : r.sapStatus === 'DITERIMA' ? 'text-ok' : 'text-ink-muted')}>
                    {REVISI_LABEL[r.sapStatus]}
                    {r.sapPesan ? ` — ${r.sapPesan}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function FormKoreksi({
  n,
  jenis,
  onTutup,
  onSelesai,
}: {
  n: NgKoreksiBaris;
  jenis: NgType[];
  onTutup: () => void;
  onSelesai: () => void;
}) {
  const toast = useToast();
  const [qty, setQty] = useState(String(n.qty));
  const [master, setMaster] = useState(String(n.ngMasterId));
  const [alasan, setAlasan] = useState('');
  const [pending, startTransition] = useTransition();

  const kirim = (qtyBaru: number) =>
    startTransition(async () => {
      const res = await koreksiNgAction(n.id, {
        qty: qtyBaru,
        ngMasterId: Number(master) !== n.ngMasterId ? Number(master) : undefined,
        alasan,
      });
      if ('error' in res) {
        toast.galat(res.error);
        return;
      }
      toast.ok(
        qtyBaru === 0
          ? 'NG dibatalkan.'
          : `NG dikoreksi${res.sap === 'DITERIMA_SAP' || res.sap === 'DI_STAGING' ? ' — revisi akan dikirim ke SAP' : ''}.`,
      );
      onSelesai();
    });

  const sudahDiSap = n.sap === 'DITERIMA_SAP' || n.sap === 'DI_STAGING';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-10">
      <div className="w-full max-w-md rounded-card border border-line bg-card p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-extrabold">Koreksi NG</h2>
            <p className="tabular mt-0.5 text-[13px] text-ink-muted">
              {n.backNumber ?? n.partNumber} · {n.serialNumber ?? '—'}
            </p>
          </div>
          <button type="button" onClick={onTutup} aria-label="Tutup" className="grid size-8 place-items-center rounded-lg text-ink-muted hover:bg-surface">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {sudahDiSap ? (
          <p className="mt-3 rounded-xl border border-warn/40 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
            NG ini sudah sampai di SAP. Koreksinya dikirim sebagai revisi baris staging aslinya
            (status R) begitu baris itu selesai diproses.
          </p>
        ) : null}

        <label className="mt-4 block">
          <span className="text-[13px] font-semibold">Qty NG</span>
          <input
            type="number"
            min={1}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            className="tabular mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-[13px] font-semibold">Jenis NG</span>
          <select
            value={master}
            onChange={(e) => setMaster(e.target.value)}
            className="mt-1.5 h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] outline-none focus:border-ink"
          >
            {jenis.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} ({j.code})
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block">
          <span className="text-[13px] font-semibold">Alasan koreksi</span>
          <textarea
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={2}
            placeholder="Wajib — mis. salah hitung, salah jenis cacat"
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[14px] outline-none focus:border-ink"
          />
        </label>

        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            disabled={pending || alasan.trim().length < 3}
            onClick={() => kirim(0)}
            className="h-10 rounded-xl border border-ng/45 px-4 text-[14px] font-semibold text-ng hover:bg-ng/8 disabled:opacity-50"
          >
            Batalkan NG
          </button>
          <button
            type="button"
            disabled={pending || alasan.trim().length < 3 || !(Number(qty) >= 1)}
            onClick={() => kirim(Math.round(Number(qty)))}
            className="h-10 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white hover:bg-accent-soft disabled:opacity-50"
          >
            {pending ? 'Menyimpan…' : 'Simpan koreksi'}
          </button>
        </div>
      </div>
    </div>
  );
}
