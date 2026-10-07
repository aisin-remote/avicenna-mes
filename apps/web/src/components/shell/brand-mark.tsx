import { cn } from '../ui/cn';

export function BrandMark({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span
        className="relative grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent font-mono text-[14px] font-bold text-white"
        aria-hidden
      >
        A
        <span className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-shell bg-ok" />
      </span>
      {compact ? null : (
        <span className="min-w-0">
          <span className="block text-[15px] font-bold leading-none tracking-[0.18em]">AVICENNA</span>
          <span className="mt-1 block truncate text-[10px] uppercase leading-[1.3] tracking-[0.06em] text-ink-muted">
            Manufacturing MES
          </span>
        </span>
      )}
    </span>
  );
}
