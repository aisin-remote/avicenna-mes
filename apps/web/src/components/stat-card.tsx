export function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="surface rounded-xl p-5">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        {label}
      </div>
      <div className="tabular mt-2 text-3xl font-semibold">{value}</div>
      {hint ? (
        <div className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}
