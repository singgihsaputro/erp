import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

export default function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ current_password: '', new_password: '', repeat: '' });
  const [mismatch, setMismatch] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api('/auth/password', { method: 'POST', body: { current_password: f.current_password, new_password: f.new_password } }),
  });
  const fields = save.error instanceof ApiError ? (save.error.fields ?? {}) : {};
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const input = 'mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
  const fieldError = (k: string) => fields[k]?.[0] && <p className="text-xs text-red-600">{fields[k]![0]}</p>;

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const differ = f.new_password !== f.repeat;
          setMismatch(differ);
          if (!differ) save.mutate();
        }}
        className="mt-16 w-full max-w-sm space-y-3 rounded-lg bg-white p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold">Change password</h2>
        {save.isSuccess ? (
          <>
            <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-800">
              Password changed. Other devices signed in as you have been signed out.
            </p>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">Done</button>
            </div>
          </>
        ) : (
          <>
            <label className="block text-sm">
              Current password
              <input className={input} type="password" autoComplete="current-password" value={f.current_password} onChange={set('current_password')} required />
              {fieldError('current_password')}
            </label>
            <label className="block text-sm">
              New password
              <input className={input} type="password" autoComplete="new-password" minLength={8} value={f.new_password} onChange={set('new_password')} required />
              {fieldError('new_password')}
            </label>
            <label className="block text-sm">
              Repeat new password
              <input className={input} type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} required />
              {mismatch && <p className="text-xs text-red-600">The two new passwords differ.</p>}
            </label>
            {save.isError && !Object.keys(fields).length && (
              <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{save.error.message}</p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">Cancel</button>
              <button type="submit" disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                {save.isPending ? 'Saving…' : 'Change password'}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
