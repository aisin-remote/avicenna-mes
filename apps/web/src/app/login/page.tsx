'use client';

import { useActionState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowRight } from 'lucide-react';
import { loginAction, type LoginState } from './actions';
import { durations, easeSoft } from '@/components/motion/transitions';
import { BrandWrite } from '@/components/shell/brand-write';

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-5">
      <div
        className="login-intro pointer-events-none absolute inset-0 z-10 grid place-items-center bg-canvas"
        aria-hidden
      >
        <span className="flex flex-col items-center gap-3">
          <BrandWrite />
          <span className="login-intro-tagline text-[12px] uppercase tracking-[0.34em] text-ink-muted">
            Manufacturing Execution System
          </span>
        </span>
      </div>

      {/*
        Animasi kemunculan memakai CSS, bukan Motion.

        Ini halaman login: kalau JavaScript gagal dimuat dan formnya ikut
        tersembunyi, pengguna terkunci di luar sistem sepenuhnya. Animasi CSS
        tetap menampilkan form apa pun yang terjadi pada bundle.
      */}
      <div className="login-card-enter a-stagger w-full max-w-[420px] rounded-panel border border-line bg-shell p-9 shadow-shell">
        <div>
          <div className="text-[24px] font-extrabold leading-none tracking-tight">AVICENNA</div>
          <p className="mt-2 text-[14px] text-ink-muted">
            Manufacturing Execution System — masuk dengan NPK Anda
          </p>
        </div>

        {/*
          Satu kolom NPK untuk dua cara masuk: discan atau diketik.

          Inilah cara masuk yang sebenarnya dipakai di lantai produksi —
          operator memegang scanner, bukan papan ketik. Kartunya berisi
          `NPK|sandi`, dan kolom ini menerimanya apa adanya; yang mengetik NPK
          mengisi kata sandinya di bawah seperti biasa.
        */}
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
              placeholder="scan kartu atau ketik NPK"
              className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none transition-colors duration-200 placeholder:text-ink-muted focus:border-line-strong focus:bg-card"
              onChange={(e) => {
                /*
                 * Scanner mengetik lalu menekan Enter. Sebagian model tidak
                 * mengirim Enter sama sekali, jadi formulir dikirim begitu
                 * isinya lengkap — ada pemisah dan ada isi di kedua sisinya.
                 */
                const v = e.currentTarget.value;
                const p = v.indexOf('|');
                if (p > 0 && v.length > p + 1) e.currentTarget.form?.requestSubmit();
              }}
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
              /*
               * TIDAK required: kartu yang discan membawa kata sandinya sendiri
               * di kolom NPK, dan kolom ini tinggal kosong. Dengan `required`,
               * browser menahan pengiriman formulir sebelum satu pun kartu
               * sempat diperiksa — dan yang terlihat operator hanyalah layar
               * yang diam. Kosongnya tetap ditolak, tapi oleh server, dengan
               * kalimat yang menyebut apa yang kurang.
               */
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
