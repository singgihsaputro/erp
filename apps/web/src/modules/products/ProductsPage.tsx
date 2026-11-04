import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type Page, type Product } from '@erp/shared';
import { api } from '../../lib/api';
import ProductForm from './ProductForm';

const PAGE_SIZE = 50;
type Status = 'active' | 'archived' | 'all';

export default function ProductsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [status, setStatus] = useState<Status>('active');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const query = useQuery({
    queryKey: ['products', debouncedQ, status, page],
    queryFn: () => {
      const p = new URLSearchParams({ status, page: String(page), page_size: String(PAGE_SIZE) });
      if (debouncedQ) p.set('q', debouncedQ);
      return api<Page<Product>>(`/products?${p}`);
    },
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: ({ p, action }: { p: Product; action: 'archive' | 'restore' }) =>
      api<Product>(`/products/${p.id}/${action}`, { method: 'POST' }),
    onSuccess: () => {
      setActionError(null);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => setActionError(e.message),
  });

  function archive(p: Product) {
    if (window.confirm(`Archive "${p.name}"? It will be hidden from the active catalogue, and can be restored later.`)) {
      toggle.mutate({ p, action: 'archive' });
    }
  }

  const data = query.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold">Products</h1>
        <input
          type="search"
          placeholder="Search name, SKU or barcode"
          aria-label="Search products"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full rounded border border-slate-300 bg-white px-3 py-1.5 text-sm sm:w-72"
        />
        <select
          aria-label="Status filter"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as Status);
            setPage(1);
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <button onClick={() => setEditing('new')} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
          + New product
        </button>
      </div>

      {actionError && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
      {query.isPending && <p className="text-sm text-slate-500">Loading products…</p>}
      {query.isError && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load products: {query.error.message}{' '}
          <button className="underline" onClick={() => query.refetch()}>Retry</button>
        </p>
      )}
      {data && data.items.length === 0 && (
        <p className="rounded border border-dashed bg-white p-8 text-center text-sm text-slate-500">
          {debouncedQ || status !== 'active' ? 'No products match your filters.' : 'No products yet. Add your first product.'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-slate-100 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Barcode</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                  <td className="px-3 py-2">
                    {p.name}
                    {p.archived_at && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">Archived</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{p.barcode ?? '—'}</td>
                  <td className="px-3 py-2">{p.base_unit}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(p.cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(p.price)}</td>
                  <td className="space-x-3 whitespace-nowrap px-3 py-2 text-right">
                    <button className="text-blue-700 hover:underline" onClick={() => setEditing(p)}>Edit</button>
                    {p.archived_at ? (
                      <button className="text-green-700 hover:underline" onClick={() => toggle.mutate({ p, action: 'restore' })}>Restore</button>
                    ) : (
                      <button className="text-red-700 hover:underline" onClick={() => archive(p)}>Archive</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.page_size && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span>
            Page {data.page} of {pages} · {data.total} products
          </span>
          <span className="space-x-2">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
          </span>
        </div>
      )}
      {data && data.total <= data.page_size && data.total > 0 && (
        <p className="mt-3 text-sm text-slate-500">{data.total} products</p>
      )}

      {editing && <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}
