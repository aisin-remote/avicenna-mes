'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Bell, Check, LoaderCircle } from 'lucide-react';
import type { NavNotification } from '@/lib/shell-types';
import { IconButton } from '../ui/icon-button';
import { cn } from '../ui/cn';
import { durations, easeSoft } from '../motion/transitions';

const readKeyFor = (accountKey: string) => `avicenna:notifications-read:${accountKey}`;

export function NotificationMenu({ accountKey }: { accountKey: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NavNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [readSignature, setReadSignature] = useState<string | null>(null);
  const signature = items.map((item) => `${item.id}:${item.count}`).join('|');
  const total = items.reduce((sum, item) => sum + item.count, 0);
  const unread = total > 0 && readSignature !== signature;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch('/api/notifications', { signal });
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { notifications?: NavNotification[] };
      setItems(body.notifications ?? []);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setFailed(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setReadSignature(window.localStorage.getItem(readKeyFor(accountKey)));
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [accountKey, load]);

  const markRead = () => {
    setReadSignature(signature);
    window.localStorage.setItem(readKeyFor(accountKey), signature);
  };

  return (
    <div className="relative">
      <IconButton
        icon={Bell}
        label={total ? `Notifikasi, ${total} perlu ditindaklanjuti` : 'Notifikasi'}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void load();
        }}
        badge={unread}
        expanded={open}
        controls="topbar-notifications"
      />
      <AnimatePresence>
        {open ? (
          <>
            <button
              type="button"
              aria-label="Tutup notifikasi"
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-20 cursor-default"
            />
            <motion.div
              id="topbar-notifications"
              role="region"
              aria-label="Notifikasi"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className="absolute right-0 z-30 mt-2 w-[min(360px,calc(100vw-2rem))] origin-top-right overflow-hidden rounded-2xl border border-line bg-card shadow-lift"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <p className="text-[14px] font-bold">Notifikasi</p>
                  <p className="text-[11px] text-ink-muted">
                    Ringkasan yang perlu ditindaklanjuti
                  </p>
                </div>
                {unread ? (
                  <button
                    type="button"
                    onClick={markRead}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-semibold text-ink-muted hover:bg-surface hover:text-ink"
                  >
                    <Check className="size-3.5" aria-hidden /> Tandai dibaca
                  </button>
                ) : null}
              </div>
              <div className="scroll-slim max-h-[420px] overflow-y-auto p-2">
                {loading && items.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-6 text-[13px] text-ink-muted">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden /> Memuat
                    notifikasi...
                  </div>
                ) : failed && items.length === 0 ? (
                  <p className="px-3 py-6 text-[13px] text-ng">
                    Notifikasi gagal dimuat. Buka kembali untuk mencoba lagi.
                  </p>
                ) : items.length === 0 ? (
                  <div className="px-3 py-7 text-center">
                    <Check className="mx-auto size-6 text-ok" strokeWidth={1.8} aria-hidden />
                    <p className="mt-2 text-[14px] font-bold">Semua aman</p>
                    <p className="mt-1 text-[12px] text-ink-muted">
                      Belum ada tindakan yang menunggu.
                    </p>
                  </div>
                ) : (
                  items.map((item) => (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => {
                        markRead();
                        setOpen(false);
                      }}
                      className="flex items-start gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-surface"
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl',
                          item.tone === 'danger'
                            ? 'bg-ng/10 text-ng'
                            : 'bg-warn/10 text-warn',
                        )}
                      >
                        <AlertTriangle className="size-4" strokeWidth={2} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-bold">{item.title}</span>
                        <span className="mt-0.5 block text-[12px] leading-5 text-ink-muted">
                          {item.detail}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'tabular rounded-full px-2 py-0.5 text-[11px] font-bold',
                          item.tone === 'danger'
                            ? 'bg-ng/10 text-ng'
                            : 'bg-warn/10 text-warn',
                        )}
                      >
                        {item.count}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
