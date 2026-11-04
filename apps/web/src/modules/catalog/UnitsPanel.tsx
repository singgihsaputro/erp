import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Unit } from '@erp/shared';
import { api } from '../../lib/api';

type UnitRow = Unit & { base_count: number; conversion_count: number };

export default function UnitsPanel() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['units'], queryFn: () => api<UnitRow[]>('/units') });

  const done = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['units'] });
  };
  const add = useMutation({
    mutationFn: () => api('/units', { method: 'POST', body: { code, name } }),
    onSuccess: () => {
      setCode('');
      setName('');
      done();
    },
    onError: (e) => setError(e.message),
  });
  const rename = useMutation({
    mutationFn: (u: { id: number; name: string }) => api(`/units/${u.id}`, { method: 'PUT', body: { name: u.name } }),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/units/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  return (
    <section aria-labelledby="units-h" className="rounded border bg-white p-4">
      <h2 id="units-h" className="mb-3 text-lg font-semibold">Units of measure</h2>
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <input aria-label="New unit code" placeholder="Code, e.g. ikat" required maxLength={20} value={code}
          onChange={(e) => setCode(e.target.value)} className="w-32 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <input aria-label="New unit name" placeholder="Name" required maxLength={60} value={name}
          onChange={(e) => setName(e.target.value)} className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
        <button disabled={add.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Add</button>
      </form>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading units…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load units: {list.error.message} <button className="underline" onClick={() => list.refetch()}>Retry</button>
        </p>
      )}
      {list.data?.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No units yet.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="divide-y text-sm">
          {list.data.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-20 font-mono text-xs">{u.code}</span>
              {editing?.id === u.id ? (
                <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); rename.mutate(editing); }}>
                  <input aria-label="Unit name" autoFocus value={editing.name} maxLength={60}
                    onChange={(e) => setEditing({ id: u.id, name: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1" />
                  <button className="text-blue-700 hover:underline">Save</button>
                  <button type="button" className="text-slate-600 hover:underline" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="flex-1">{u.name}</span>
                  <span className="text-xs text-slate-500">{u.base_count} base · {u.conversion_count} conversions</span>
                  <button className="text-blue-700 hover:underline" onClick={() => setEditing({ id: u.id, name: u.name })}>Rename</button>
                  <button className="text-red-700 hover:underline"
                    onClick={() => window.confirm(`Delete unit "${u.code}"?`) && remove.mutate(u.id)}>Delete</button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
