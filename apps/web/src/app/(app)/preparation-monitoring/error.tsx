'use client';
export default function PreparationError({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="rounded-card border border-line bg-card p-6">
      <h1 className="text-lg font-bold">Preparation Monitoring belum dapat dimuat</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Periksa apakah API dan database MES sedang berjalan, lalu coba lagi. Tidak ada data SAP atau
        scan yang diubah.
      </p>
      <button
        onClick={reset}
        className="mt-4 rounded-full border border-line px-5 py-2 text-sm font-semibold"
      >
        Coba lagi
      </button>
    </section>
  );
}
