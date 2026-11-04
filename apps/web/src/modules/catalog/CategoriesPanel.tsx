import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category } from '@erp/shared';
import { api } from '../../lib/api';

export default function CategoriesPanel() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });

  const done = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };
  const add = useMutation({
    mutationFn: (n: string) => api('/categories', { method: 'POST', body: { name: n } }),
    onSuccess: () => {
      setName('');
      done();
    },
    onError: (e) => setError(e.message),
  });
  const rename = useMutation({
    mutationFn: (c: { id: number; name: string }) => api(`/categories/${c.id}`, { method: 'PUT', body: { name: c.name } }),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: (e) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: done,
    onError: (e) => setError(e.message),
  });

  return (
    <section aria-labelledby="categories-h" className="rounded border bg-white p-4">
      <h2 id="categories-h" className="mb-3 text-lg font-semibold">Product categories</h2>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(name);
        }}
      >
        <input
          aria-label="New category name"
          placeholder="New category, e.g. Minuman"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
        <button disabled={add.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Add</button>
      </form>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading categories…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load categories: {list.error.message} <button className="underline" onClick={() => list.refetch()}>Retry</button>
        </p>
      )}
      {list.data?.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No categories yet.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="divide-y text-sm">
          {list.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
              {editing?.id === c.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename.mutate(editing);
                  }}
                >
                  <input
                    aria-label="Category name"
                    autoFocus
                    value={editing.name}
                    maxLength={80}
                    onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
                  />
                  <button className="text-blue-700 hover:underline">Save</button>
                  <button type="button" className="text-slate-600 hover:underline" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-slate-500">{c.product_count} products</span>
                  <button className="text-blue-700 hover:underline" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                  <button
                    className="text-red-700 hover:underline"
                    onClick={() => window.confirm(`Delete category "${c.name}"?`) && remove.mutate(c.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
