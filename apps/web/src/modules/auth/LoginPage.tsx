import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@erp/shared';
import { api } from '../../lib/api';

export default function LoginPage() {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);

  const signIn = useMutation({
    mutationFn: () => api<SessionUser>('/auth/login', { method: 'POST', body: { username, password } }),
    onSuccess: (user) => qc.setQueryData(['me'], user),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          signIn.mutate();
        }}
        className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow"
      >
        <div>
          <div className="text-lg font-semibold">ERP UMKM</div>
          <h1 className="text-sm text-slate-500">Sign in to continue</h1>
        </div>
        <label className="block text-sm">
          Username
          <input
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          Password
          <div className="mt-1 flex gap-2">
            <input
              className="w-full rounded border border-slate-300 px-3 py-2"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" onClick={() => setShow(!show)} className="rounded border px-2 text-xs text-slate-600">
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        {signIn.isError && (
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
            {signIn.error.message}
          </p>
        )}
        <button
          type="submit"
          disabled={signIn.isPending}
          className="w-full rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {signIn.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
