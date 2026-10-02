'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, LoaderCircle, Search, X } from 'lucide-react';
import type { NavGroup } from './nav-config';
import { iconFor } from '../ui/icon-map';
import type { GlobalSearchResult } from '@/lib/shell-types';
import { durations, easeSoft } from '../motion/transitions';
import { cn } from '../ui/cn';

type PaletteItem = {
  key: string;
  title: string;
  subtitle: string;
  href: string;
  icon: string;
  tag?: string;
};

export function GlobalSearch({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [data, setData] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);

  const menu = useMemo(
    () =>
      groups.flatMap((group) =>
        group.items.map((item) => ({
          key: `menu:${item.href}`,
          title: item.label,
          subtitle: group.title,
          href: item.href,
          icon: item.icon,
        })),
      ),
    [groups],
  );
  const term = query.trim().toLocaleLowerCase('id-ID');
  const menuMatches = term
    ? menu
        .filter((item) =>
          `${item.title} ${item.subtitle}`.toLocaleLowerCase('id-ID').includes(term),
        )
        .slice(0, 5)
    : menu.slice(0, 7);
  const items: PaletteItem[] = [
    ...menuMatches,
    ...data.map((item) => ({
      key: `data:${item.type}:${item.href}:${item.title}`,
      title: item.title,
      subtitle: item.subtitle,
      href: item.href,
      icon: item.icon,
      tag: item.type,
    })),
  ];

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    setActive(0);
    if (query.trim().length < 2) {
      setData([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setFailed(false);
      try {
        const response = await fetch(`/api/global-search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { results?: GlobalSearchResult[] };
        setData(body.results ?? []);
      } catch (error) {
        if ((error as Error).name !== 'AbortError') {
          setData([]);
          setFailed(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setData([]);
  };
  const navigate = (href: string) => {
    if (!href.startsWith('/')) return;
    close();
    router.push(href);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') return close();
    if (!items.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => (value + 1) % items.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => (value - 1 + items.length) % items.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = items[active] ?? items[0];
      if (item) navigate(item.href);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden h-11 w-full max-w-[460px] items-center gap-3 rounded-full border border-line bg-surface px-4 text-left text-[14px] text-ink-muted outline-none transition-colors hover:border-line-strong hover:bg-card focus-visible:ring-2 focus-visible:ring-ink/20 md:flex"
        aria-label="Buka pencarian global"
        title="Cari (Ctrl/Cmd + K)"
      >
        <Search className="size-[18px] shrink-0" strokeWidth={1.8} aria-hidden />
        <span className="min-w-0 flex-1 truncate">Cari menu atau data...</span>
        <kbd className="rounded-lg border border-line bg-card px-2 py-1 text-[11px] font-semibold text-ink-muted">
          Ctrl K
        </kbd>
      </button>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-11 shrink-0 place-items-center rounded-full border border-line bg-card text-ink-muted outline-none transition-colors hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ink/20 md:hidden"
        aria-label="Buka pencarian global"
      >
        <Search className="size-[18px]" strokeWidth={1.8} aria-hidden />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Pencarian global"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: durations.base, ease: easeSoft }}
            className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[10vh] sm:px-6"
          >
            <button
              type="button"
              aria-label="Tutup pencarian"
              onClick={close}
              className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ opacity: 0, y: -14, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className="relative z-10 w-full max-w-2xl overflow-hidden rounded-[28px] border border-line bg-card shadow-shell"
            >
              <div className="flex h-16 items-center gap-3 border-b border-line px-5">
                <Search className="size-5 shrink-0 text-ink-muted" strokeWidth={1.8} aria-hidden />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Cari menu, part, kanban, atau dokumen..."
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Kata pencarian"
                  aria-activedescendant={items[active] ? `global-search-${active}` : undefined}
                  className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-ink-muted"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Hapus pencarian"
                    className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-surface hover:text-ink"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink-muted hover:text-ink"
                >
                  ESC
                </button>
              </div>

              <div className="scroll-slim max-h-[min(62vh,560px)] overflow-y-auto p-3">
                <p className="px-3 pb-2 pt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-ink-muted">
                  {term ? 'Hasil pencarian' : 'Akses cepat'}
                </p>
                {items.map((item, index) => {
                  const Icon = iconFor(item.icon);
                  return (
                    <Link
                      id={`global-search-${index}`}
                      key={item.key}
                      href={item.href}
                      onClick={close}
                      onPointerEnter={() => setActive(index)}
                      className={cn(
                        'flex items-center gap-3 rounded-2xl px-3 py-3 outline-none transition-colors',
                        active === index ? 'bg-surface' : 'hover:bg-surface',
                      )}
                    >
                      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-card text-ink-soft">
                        <Icon className="size-[18px]" strokeWidth={1.8} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold text-ink">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
                          {item.subtitle}
                        </span>
                      </span>
                      {item.tag ? (
                        <span className="hidden rounded-full border border-line px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-muted sm:block">
                          {item.tag}
                        </span>
                      ) : (
                        <ArrowRight
                          className="size-4 shrink-0 text-ink-muted"
                          strokeWidth={1.8}
                          aria-hidden
                        />
                      )}
                    </Link>
                  );
                })}
                {loading ? (
                  <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-muted">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden /> Mencari data...
                  </div>
                ) : null}
                {!loading && failed ? (
                  <p className="px-3 py-5 text-[13px] text-ng">
                    Pencarian gagal dimuat. Coba lagi.
                  </p>
                ) : null}
                {!loading && !failed && term && items.length === 0 ? (
                  <div className="px-3 py-7">
                    <p className="text-[14px] font-bold">
                      Belum ada hasil untuk “{query.trim()}”
                    </p>
                    <p className="mt-1 text-[13px] text-ink-muted">
                      Coba nomor part, seri kanban, surat jalan, atau supplier.
                    </p>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
