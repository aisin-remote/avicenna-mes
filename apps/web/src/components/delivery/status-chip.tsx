import { cn } from '../ui/cn';

const DOC_LABEL: Record<string, string> = {
  DRAFT: 'Draf',
  PICKING: 'Sedang diambil',
  PICKED: 'Siap dimuat',
  LOADING: 'Sedang dimuat',
  SHIPPED: 'Berangkat',
  RECEIVED: 'Diterima customer',
  CANCELLED: 'Dibatalkan',
};

const DOC_TONE: Record<string, string> = {
  DRAFT: 'border-line text-ink-muted',
  PICKING: 'border-warn/40 bg-warn/10 text-warn',
  PICKED: 'border-accent/40 bg-accent/10 text-accent',
  LOADING: 'border-accent/40 bg-accent/10 text-accent',
  SHIPPED: 'border-ok/40 bg-ok/10 text-ok',
  RECEIVED: 'border-ok/40 bg-ok/10 text-ok',
  CANCELLED: 'border-ng/40 bg-ng/10 text-ng',
};

const TRUCK_LABEL: Record<string, string> = {
  PENDING: 'Belum datang',
  ARRIVED: 'Sudah datang',
  LOADING: 'Sedang dimuat',
  DEPARTED: 'Sudah berangkat',
};

const TRUCK_TONE: Record<string, string> = {
  PENDING: 'border-line text-ink-muted',
  ARRIVED: 'border-warn/40 bg-warn/10 text-warn',
  LOADING: 'border-accent/40 bg-accent/10 text-accent',
  DEPARTED: 'border-ok/40 bg-ok/10 text-ok',
};

function Chip({ label, tone }: { label: string; tone: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap',
        tone,
      )}
    >
      {label}
    </span>
  );
}

export function StatusChip({ status }: { status: string }) {
  return <Chip label={DOC_LABEL[status] ?? status} tone={DOC_TONE[status] ?? 'border-line'} />;
}

export function TruckChip({ status }: { status: string }) {
  return <Chip label={TRUCK_LABEL[status] ?? status} tone={TRUCK_TONE[status] ?? 'border-line'} />;
}
