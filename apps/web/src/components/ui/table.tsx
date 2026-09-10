import { cn } from './cn';

/**
 * Tabel sederhana dengan gaya kartu.
 *
 * Dibungkus overflow-x-auto: tabel adalah satu-satunya elemen yang boleh lebih
 * lebar dari layar, dan itu pun harus menggulir sendiri agar badan halaman
 * tidak ikut bergeser ke samping.
 */
export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="scroll-slim overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">{children}</table>
    </div>
  );
}

export function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-line px-6 py-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted',
        align === 'right' ? 'text-right' : 'text-left',
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  strong = false,
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  strong?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-6 py-3.5 text-ink-soft',
        align === 'right' && 'text-right',
        strong && 'font-semibold text-ink',
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Baris tabel dengan sorotan halus saat disapu kursor. */
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <tr className="transition-colors duration-150 last:[&>td]:border-b-0 hover:bg-surface">
      {children}
    </tr>
  );
}

/** Keadaan kosong — selalu jelaskan langkah berikutnya, jangan hanya "tidak ada data". */
export function EmptyState({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan: number;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-6 py-14 text-center text-[14px] text-ink-muted">
        {children}
      </td>
    </tr>
  );
}
