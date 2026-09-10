import { Breadcrumb, type Crumb } from '../shell/breadcrumb';
import { cn } from './cn';

/** Kepala halaman: jejak navigasi, judul, keterangan, dan aksi di kanan. */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
  className,
}: {
  crumbs: Crumb[];
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      <Breadcrumb items={crumbs} />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight">{title}</h1>
          {description ? (
            <p className="mt-1.5 text-[15px] text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
