'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from './actions';

const initial: LoginState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, initial);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="surface w-full max-w-sm rounded-xl p-8 shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Avicenna MES</h1>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Masuk dengan NPK Anda
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <div>
            <label htmlFor="npk" className="mb-1.5 block text-sm font-medium">
              NPK
            </label>
            <input
              id="npk"
              name="npk"
              autoComplete="username"
              autoFocus
              required
              className="w-full rounded-lg border px-3 py-2.5 text-base outline-none focus:border-brand-500"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1.5 block text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-full rounded-lg border px-3 py-2.5 text-base outline-none focus:border-brand-500"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
          </div>

          {state.error ? (
            <p role="alert" className="text-sm" style={{ color: 'var(--color-ng)' }}>
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-brand-600 px-4 py-2.5 font-medium text-white transition hover:bg-brand-700 disabled:opacity-60"
          >
            {pending ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </main>
  );
}
