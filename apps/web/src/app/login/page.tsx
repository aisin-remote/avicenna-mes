'use client';

import { useActionState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { loginAction, type LoginState } from './actions';
import { durations, easeSoft } from '@/components/motion/transitions';

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <main className="grid min-h-screen place-items-center p-5">
      {/*
        Animasi kemunculan memakai CSS, bukan Motion.

        Ini halaman login: kalau JavaScript gagal dimuat dan formnya ikut
        tersembunyi, pengguna terkunci di luar sistem sepenuhnya. Animasi CSS
        tetap menampilkan form apa pun yang terjadi pada bundle.
      */}
      <div className="a-stagger w-full max-w-[420px] rounded-panel border border-line bg-shell p-9 shadow-shell">
        <div>
          <div className="text-[24px] font-extrabold leading-none tracking-tight">AVICENNA</div>
          <p className="mt-2 text-[14px] text-ink-muted">
            Manufacturing Execution System — masuk dengan NPK Anda
          </p>
        </div>

        <form action={formAction} className="mt-8 space-y-4">
          <div>
            <label htmlFor="npk" className="mb-2 block text-[14px] font-semibold">
              NPK
            </label>
            <input
              id="npk"
              name="npk"
              autoComplete="username"
              autoFocus
              required
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-[14px] font-semibold">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 focus:border-line-strong focus:bg-card"
            />
          </div>

          {state.error ? (
            <motion.p
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: durations.base, ease: easeSoft }}
              className="flex items-center gap-2 text-[14px] text-ng"
            >
              <AlertCircle className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              {state.error}
            </motion.p>
          ) : null}

          <div className="pt-2">
            <motion.button
              type="submit"
              disabled={pending}
              whileHover={pending ? undefined : { scale: 1.01 }}
              whileTap={pending ? undefined : { scale: 0.98 }}
              transition={{ duration: durations.fast, ease: easeSoft }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-accent text-[15px] font-semibold text-white outline-none transition-colors duration-200 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ink/20 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <>
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    className="size-4 rounded-full border-2 border-white/30 border-t-white"
                  />
                  Memproses
                </>
              ) : (
                <>
                  Masuk
                  <ArrowRight className="size-4" strokeWidth={2.2} aria-hidden />
                </>
              )}
            </motion.button>
          </div>
        </form>
      </div>
    </main>
  );
}
