import Link from 'next/link';
import { Search } from 'lucide-react';
import type { TracePartRingkas, TraceSap } from '@avicenna/contracts';
import { Card } from '@/components/ui/card';
import { cn } from '@/components/ui/cn';

/**
 * Kotak cari bersama untuk Trace Part dan Trace Kanban.
 *
 * Formulir GET biasa: hasilnya ada di alamat, jadi bisa dikirim ke orang lain
 * dan dibuka ulang. autoFocus supaya scanner bisa langsung menembak tanpa
 * mengeklik; autoCorrect mati karena isi kartu AIGSYS penuh spasi ganda yang
 * diubah macOS jadi ". ".
 */
export function KotakCari({
  action,
  q,
  placeholder,
  contoh,
}: {
  action: string;
  q: string;
  placeholder: string;
  contoh: string;
}) {
  return (
    <Card className="mb-5 p-4">
      <form action={action} className="flex flex-col gap-3 sm:flex-row">
        <label className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            strokeWidth={2}
            aria-hidden
          />
          <input
            name="q"
            defaultValue={q}
            placeholder={placeholder}
            aria-label={placeholder}
            autoFocus
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className="tabular h-12 w-full rounded-xl border border-line bg-surface pl-11 pr-4 text-[15px] outline-none transition-colors focus:border-ink focus:bg-card"
          />
        </label>
        <button
          type="submit"
          className="h-12 rounded-xl bg-accent px-6 text-[14px] font-semibold text-white transition-colors hover:bg-accent-soft"
        >
          Telusuri
        </button>
      </form>
      <p className="mt-2 text-[12.5px] text-ink-muted">{contoh}</p>
    </Card>
  );
}

export function Kosong({ children }: { children: React.ReactNode }) {
  return <Card className="px-6 py-14 text-center text-[14px] text-ink-muted">{children}</Card>;
}

const FMT_WAKTU = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Jakarta',
});

export function waktu(iso: string | null | undefined): string {
  return iso ? FMT_WAKTU.format(new Date(iso)) : '—';
}

/** "CI11 · 21211034010" — back number lebih dulu, itulah yang dikenal lantai. */
export function LabelPart({
  part,
  nama = false,
}: {
  part: TracePartRingkas | null;
  nama?: boolean;
}) {
  if (!part) return <span className="text-ink-muted">—</span>;
  return (
    <span className="min-w-0">
      <span className="font-semibold">{part.backNumber ?? part.partNumber}</span>
      {part.backNumber ? (
        <span className="tabular text-ink-muted"> · {part.partNumber}</span>
      ) : null}
      {nama && part.name ? (
        <span className="block truncate text-[12px] text-ink-muted">{part.name}</span>
      ) : null}
    </span>
  );
}

type Nada = 'ok' | 'warn' | 'ng' | 'netral';

export function Chip({ nada, children }: { nada: Nada; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold',
        nada === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        nada === 'warn' && 'border-warn/40 bg-warn/10 text-warn',
        nada === 'ng' && 'border-ng/35 bg-ng/10 text-ng',
        nada === 'netral' && 'border-line bg-surface text-ink-soft',
      )}
    >
      {children}
    </span>
  );
}

const NADA_SAP: Record<string, Nada> = {
  CONFIRMED: 'ok',
  SENT: 'warn',
  PENDING: 'warn',
  HELD: 'warn',
  REJECTED: 'ng',
  FAILED: 'ng',
  SKIPPED: 'netral',
};

const LABEL_SAP: Record<string, string> = {
  CONFIRMED: 'SAP terkonfirmasi',
  SENT: 'Terkirim ke staging',
  PENDING: 'Menunggu kirim',
  HELD: 'Ditahan',
  REJECTED: 'Ditolak SAP',
  FAILED: 'Gagal kirim',
  SKIPPED: 'Tidak dikirim',
};

export function ChipSap({ sap }: { sap: TraceSap }) {
  const judul = [
    `${sap.docType}${sap.movementType ? ` ${sap.movementType}` : ''}`,
    sap.stagingNumber ? `staging #${sap.stagingNumber}` : null,
    sap.sapDocNumber ? `dok SAP ${sap.sapDocNumber}` : null,
    sap.lastError,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span title={judul} className="inline-flex flex-col gap-0.5">
      <Chip nada={NADA_SAP[sap.status] ?? 'netral'}>
        {LABEL_SAP[sap.status] ?? sap.status}
        {sap.sapDocNumber ? ` · ${sap.sapDocNumber}` : ''}
      </Chip>
      {sap.lastError && sap.status !== 'CONFIRMED' ? (
        <span className="max-w-[260px] text-[11.5px] leading-snug text-ink-muted">
          {sap.lastError}
        </span>
      ) : null}
    </span>
  );
}

const LABEL_KANBAN: Record<string, string> = {
  AVAILABLE: 'Kosong',
  SHOPPED: 'Dibelanjakan',
  PRODUCED: 'Terisi',
  STORED: 'Di gudang',
  PULLED: 'Di-pulling',
  LOADED: 'Dimuat',
  DELIVERED: 'Terkirim',
  CANCELLED: 'Batal',
};

const NADA_KANBAN: Record<string, Nada> = {
  AVAILABLE: 'netral',
  SHOPPED: 'warn',
  PRODUCED: 'ok',
  STORED: 'ok',
  PULLED: 'warn',
  LOADED: 'warn',
  DELIVERED: 'ok',
  CANCELLED: 'ng',
};

/**
 * Keadaan kartu untuk dibaca orang — dari status DAN isinya.
 *
 * Di mode Part + Kanban (unit berseri), menutup box tidak mengubah status
 * kartu: ia tetap AVAILABLE, dan penuh-tidaknya dibaca dari TT_KANBAN_ITEM.
 * Status PRODUCED hanya dipakai mode per kanban (barang tanpa seri). Jadi
 * AVAILABLE berarti "masih di siklus produksi, belum dipulling" — bukan
 * "kosong". Label diturunkan dari isinya supaya tidak menyesatkan.
 */
export function ChipKanban({
  status,
  isi,
  kapasitas,
}: {
  status: string;
  isi: number;
  kapasitas: number;
}) {
  if (status === 'AVAILABLE' && isi > 0) {
    return (
      <Chip nada="ok">{isi >= kapasitas ? 'Terisi penuh' : `Terisi ${isi}/${kapasitas}`}</Chip>
    );
  }
  return <Chip nada={NADA_KANBAN[status] ?? 'netral'}>{LABEL_KANBAN[status] ?? status}</Chip>;
}

/** Tautan ke Trace Part untuk sebuah seri unit. */
export function TautanUnit({ serial }: { serial: string | null }) {
  if (!serial) return <span className="text-ink-muted">—</span>;
  return (
    <Link
      href={`/traceability/part?q=${encodeURIComponent(serial)}`}
      className="tabular font-semibold underline decoration-line-strong underline-offset-4 hover:decoration-ink"
    >
      {serial}
    </Link>
  );
}

/** Tautan ke Trace Kanban untuk satu kartu. */
export function TautanKanban({
  part,
  serial,
}: {
  part: TracePartRingkas | null;
  serial: string | null;
}) {
  if (!serial) return <span className="text-ink-muted">—</span>;
  const kode = part?.backNumber ?? part?.partNumber;
  if (!kode) return <span className="tabular">{serial}</span>;
  return (
    <Link
      href={`/traceability/kanban?q=${encodeURIComponent(`${kode} ${serial}`)}`}
      className="tabular font-semibold underline decoration-line-strong underline-offset-4 hover:decoration-ink"
    >
      {kode} {serial}
    </Link>
  );
}
