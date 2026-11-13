import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Page, Product, ReorderList, ReorderRow, Warehouse } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from './StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';

interface Editing { product_id: string; warehouse_id: string; min: string; locked: boolean }

export default function ReorderPage({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [belowOnly, setBelowOnly] = useState(true);
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const list = useQuery({
    queryKey: ['reorder-points', belowOnly, warehouseId, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (belowOnly) p.set('below', '1');
      if (warehouseId) p.set('warehouse_id', warehouseId);
      return api<ReorderList>(`/stock/reorder-points?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/stock/reorder-points/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reorder-points'] }),
    onError: (e) => setError(e.message),
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Reorder points</h1>
        {data && data.below_count > 0 && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{data.below_count} below minimum</span>}
        <label className="ml-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={belowOnly} onChange={(e) => { setBelowOnly(e.target.checked); setPage(1); }} /> Only below minimum
        </label>
        <select aria-label="Warehouse" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}>
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {canManage && <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing({ product_id: '', warehouse_id: String(warehouses.data?.[0]?.id ?? ''), min: '', locked: false })}>Set reorder point</button>}
      </div>
      <p className="mb-4 text-sm text-slate-500">A reorder point is the minimum a warehouse should hold of a product. Anything with less on hand is below it and needs restocking.</p>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading reorder points…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load reorder points: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && (
        <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">
          {belowOnly && data.below_count === 0 && data.total === 0 ? 'Nothing is below its minimum. (Untick the filter to see every reorder point.)' : 'No reorder points yet.'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Product</th><th className="p-2">Warehouse</th><th className="p-2 text-right">On hand</th><th className="p-2 text-right">Minimum</th><th className="p-2 text-right">To order</th><th className="p-2">Status</th>{canManage && <th className="p-2" />}</tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="p-2">{r.name}<div className="text-xs text-slate-500">{r.sku}</div></td>
                  <td className="p-2">{r.warehouse_name}</td>
                  <td className="p-2 text-right">{qty(r.on_hand_milli)} {r.base_unit}</td>
                  <td className="p-2 text-right">{qty(r.min_qty_milli)} {r.base_unit}</td>
                  <td className="p-2 text-right">{r.below ? `${qty(r.shortfall_milli)} ${r.base_unit}` : '—'}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${r.below ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{r.below ? 'Below minimum' : 'OK'}</span></td>
                  {canManage && (
                    <td className="p-2 text-right whitespace-nowrap">
                      <button className="text-blue-700 hover:underline" onClick={() => setEditing({ product_id: String(r.product_id), warehouse_id: String(r.warehouse_id), min: String(r.min_qty_milli / 1000).replace('.', ','), locked: true })}>Edit</button>{' '}
                      <button className="text-red-700 hover:underline" disabled={remove.isPending} onClick={() => window.confirm(`Remove the reorder point for ${r.name} in ${r.warehouse_name}?`) && (setError(null), remove.mutate(r.id))}>Remove</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <span>Page {page} of {pages}</span>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
          <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      )}
      {editing && <SetDialog initial={editing} warehouses={warehouses.data ?? []} onClose={() => setEditing(null)} />}
    </section>
  );
}

function SetDialog({ initial, warehouses, onClose }: { initial: Editing; warehouses: Warehouse[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({ queryKey: ['products', 'all-active'], queryFn: () => api<Page<Product>>('/products?page_size=200') });
  const save = useMutation({
    mutationFn: () =>
      api<ReorderRow>('/stock/reorder-points', {
        method: 'PUT',
        body: { product_id: Number(f.product_id), warehouse_id: Number(f.warehouse_id), min_qty_milli: Math.round(Number(f.min.replace(',', '.')) * 1000) },
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['reorder-points'] }); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Set reorder point" onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {products.isError && <p role="alert" className="text-red-700">Could not load products: {products.error.message}</p>}
        <label>Product
          <select className={field} value={f.product_id} required disabled={f.locked} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">Choose product…</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
        </label>
        <label>Warehouse
          <select className={field} value={f.warehouse_id} required disabled={f.locked} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label>Minimum quantity (base unit)
          <input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} />
        </label>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save</button>
        </div>
      </form>
    </Modal>
  );
}
