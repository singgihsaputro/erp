import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ROLES, ROLE_LABELS, type Role, type UserAccount } from '@erp/shared';
import { api } from '../../lib/api';

/** Only the super admin manages accounts. The API enforces the same. */
export const USER_MANAGERS: Role[] = ['super_admin'];

const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(iso)) : 'Never';

export default function UsersPage({ meId }: { meId: number }) {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Partial<UserAccount> | null>(null);
  const [resetting, setResetting] = useState<UserAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['users', q], queryFn: () => api<UserAccount[]>(`/users?q=${encodeURIComponent(q)}`) });
  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['users'] });
  };
  const toggle = useMutation({
    mutationFn: (a: { id: number; verb: 'disable' | 'enable' }) => api(`/users/${a.id}/${a.verb}`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Users</h1>
        <input
          className={`${input} ml-auto max-w-xs`}
          type="search"
          placeholder="Search name or username"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing({ username: '', name: '', role: 'cashier' })}>
          Add user
        </button>
      </div>
      <p className="mb-4 text-sm text-slate-500">
        The role decides which screens and actions an account can use. A disabled account cannot sign in and is signed out at once.
      </p>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading users…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load users: {list.error.message} <button className="underline" onClick={() => list.refetch()}>Retry</button>
        </p>
      )}
      {list.data?.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No users match.</p>}
      {list.data && list.data.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Name</th><th className="px-3 py-2">Username</th><th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th><th className="px-3 py-2">Last sign-in</th><th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.data.map((u) => (
                <tr key={u.id} className={u.disabled_at ? 'text-slate-400' : ''}>
                  <td className="px-3 py-2 font-medium">{u.name}{u.id === meId && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}</td>
                  <td className="px-3 py-2">{u.username}</td>
                  <td className="px-3 py-2"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ROLE_LABELS[u.role]}</span></td>
                  <td className="px-3 py-2">
                    {u.disabled_at
                      ? <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">Disabled</span>
                      : <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Active</span>}
                  </td>
                  <td className="px-3 py-2">{when(u.last_login_at)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button className="mr-3 text-blue-700 hover:underline" onClick={() => setEditing(u)}>Edit</button>
                    <button className="mr-3 text-blue-700 hover:underline" onClick={() => setResetting(u)}>Reset password</button>
                    {u.disabled_at ? (
                      <button className="text-blue-700 hover:underline" onClick={() => toggle.mutate({ id: u.id, verb: 'enable' })}>Enable</button>
                    ) : (
                      u.id !== meId && (
                        <button
                          className="text-red-700 hover:underline"
                          onClick={() => window.confirm(`Disable ${u.name}? They will be signed out.`) && toggle.mutate({ id: u.id, verb: 'disable' })}
                        >
                          Disable
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <UserForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {resetting && <ResetDialog user={resetting} onClose={() => setResetting(null)} />}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-full w-full max-w-md overflow-auto rounded bg-white p-5 shadow">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="ml-auto text-slate-500 hover:text-slate-800" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function UserForm({ initial, onClose, onSaved }: { initial: Partial<UserAccount>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ username: initial.username ?? '', name: initial.name ?? '', role: (initial.role ?? 'cashier') as Role, password: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial.id
        ? api(`/users/${initial.id}`, { method: 'PUT', body: { name: form.name, role: form.role } })
        : api('/users', { method: 'POST', body: form }),
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={initial.id ? 'Edit user' : 'Add user'} onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label>Full name
          <input className={input} value={form.name} maxLength={80} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Username
          <input className={input} value={form.username} maxLength={32} required disabled={!!initial.id} autoComplete="off" onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </label>
        <label>Role
          <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
        </label>
        {!initial.id && (
          <label>Password
            <input className={input} type="password" value={form.password} minLength={8} required autoComplete="new-password" onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <span className="text-xs text-slate-500">At least 8 characters. Share it with the person; they can change it after signing in.</span>
          </label>
        )}
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ResetDialog({ user, onClose }: { user: UserAccount; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const reset = useMutation({
    mutationFn: () => api(`/users/${user.id}/reset-password`, { method: 'POST', body: { new_password: password } }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={`Reset password for ${user.name}`} onClose={onClose}>
      {done ? (
        <div className="grid gap-3 text-sm">
          <p role="status" className="rounded bg-green-50 px-3 py-2 text-green-800">Password changed. {user.name} was signed out everywhere.</p>
          <button className="justify-self-end rounded bg-slate-900 px-3 py-1.5 text-white" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); reset.mutate(); }}>
          <label>New password
            <input className={input} type="password" value={password} minLength={8} required autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
            <button disabled={reset.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Reset password</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
