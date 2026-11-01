'use client';
import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
export function PreparationDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      className="m-auto max-h-[90dvh] w-[min(1100px,94vw)] overflow-y-auto rounded-3xl border border-line bg-card p-0 text-ink shadow-xl backdrop:bg-black/60"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-card px-6 py-4">
        <h2 id={id} className="text-lg font-bold">
          {title}
        </h2>
        <button
          type="button"
          aria-label="Tutup dialog"
          onClick={close}
          className="rounded-full border border-line p-2 hover:bg-surface"
        >
          <X className="size-4" />
        </button>
      </header>
      <div className="p-6">{children}</div>
    </dialog>
  );
}
