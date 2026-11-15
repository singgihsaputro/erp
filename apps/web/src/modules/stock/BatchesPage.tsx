import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BatchList, BatchPick, BatchRow, Page, Product, Warehouse } from '@erp/shared';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { Modal } from './StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const badge = { expired: 'bg-red-100 text-red-800', soon: 'bg-amber-100 text-amber-800', ok: 'bg-green-100 text-green-800', none: 'bg-slate-100 text-slate-600' };
const label = (r: BatchRow) =>
  r.days_left === null ? 'No expiry' : r.days_left < 0 ? `Expired ${-r.days_left} d ago` : r.days_left === 0 ? 'Expires today' : `${r.days_left} d left`;

export default function BatchesPage({ canManage }: { canManage: boolean }) {
  const [filter, setFilter] = useState<'all' | 'soon' | 'expired'>('all');
  const [days, setDays] = useState(30);
  const [warehouseId, setWarehouseId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [receiving, setReceiving] = useState(false);
  const [picking, setPicking] = useState(false);
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const list = useQuery({
    queryKey: ['stock-batches', filter, days, warehouseId, q, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE), filter, days: String(days) });
      if (warehouseId) p.set('warehouse_id', warehouseId);
      if (q) p.set('q', q);
      return api<BatchList>(`/stock/batches?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Batches &amp; expiry</h1>
        {data && data.expired_count > 0 && <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800">{data.expired_count} expired</span>}
        {data && data.soon_count > 0 && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{data.soon_count} expiring within {days} days</span>}
        <div className="ml-auto flex gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={() => setPicking(true)}>Pick (FEFO)</button>
          {canManage && <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setReceiving(true)}>Receive batch</button>}
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-500">Stock received with a batch number and expiry date, soonest expiry first. Sell or move the oldest batch first (first-expired-first-out).</p>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Search" placeholder="Search product or batch…" className="rounded border border-slate-300 px-2 py-1.5" value={q} onChange={(e) => reset(setQ)(e.target.value)} />
        <select aria-label="Show" className="rounded border border-slate-300 px-2 py-1.5" value={filter} onChange={(e) => reset(setFilter)(e.target.value as typeof filter)}>
          <option value="all">All batches</option>
          <option value="soon">Expiring soon</option>
          <option value="expired">Expired</option>
        </select>
        <select aria-label="Expiring within" className="rounded border border-slate-300 px-2 py-1.5" value={days} onChange={(e) => reset(setDays)(Number(e.target.value))}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>Soon = within {d} days</option>)}
        </select>
        <select aria-label="Warehouse" className="rounded border border-slate-300 px-2 py-1.5" value={warehouseId} onChange={(e) => reset(setWarehouseId)(e.target.value)}>
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </div>
      {list.isPending && <p className="text-sm text-slate-500">Loading batches…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load batches: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">{filter === 'all' && !q ? 'No batches with stock yet. Receive one to start tracking expiry.' : 'No batches match.'}</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Product</th><th className="p-2">Batch</th><th className="p-2">Warehouse</th><th className="p-2 text-right">On hand</th><th className="p-2">Expiry</th><th className="p-2">Status</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={`${r.batch_id}-${r.warehouse_id}`}>
                  <td className="p-2">{r.name}<div className="text-xs text-slate-500">{r.sku}</div></td>
                  <td className="p-2">{r.batch_no}</td>
                  <td className="p-2">{r.warehouse_name}</td>
                  <td className="p-2 text-right">{qty(r.qty_milli)} {r.base_unit}</td>
                  <td className="p-2">{formatDate(r.expiry_date)}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${badge[r.status]}`}>{label(r)}</span></td>
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
      {receiving && <ReceiveDialog warehouses={warehouses.data ?? []} onClose={() => setReceiving(false)} />}
      {picking && <PickDialog warehouses={warehouses.data ?? []} onClose={() => setPicking(false)} />}
    </section>
  );
}

function useProducts() {
  return useQuery({ queryKey: ['products', 'all-active'], queryFn: () => api<Page<Product>>('/products?page_size=200') });
}

function ReceiveDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const qc = useQueryClient();
  const products = useProducts();
  const [f, setF] = useState({ product_id: '', warehouse_id: String(warehouses[0]?.id ?? ''), batch_no: '', expiry: '', qty: '', cost: '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<BatchRow>('/stock/batches', {
        method: 'POST',
        body: {
          product_id: Number(f.product_id),
          warehouse_id: Number(f.warehouse_id),
          batch_no: f.batch_no,
          expiry_date: f.expiry || null,
          qty_milli: Math.round(Number(f.qty.replace(',', '.')) * 1000),
          unit_cost: Math.round(Number(f.cost || '0')),
        },
      }),
    onSuccess: () => { for (const k of ['stock-batches', 'stock', 'warehouses', 'products']) qc.invalidateQueries({ queryKey: [k] }); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Receive batch" onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {products.isError && <p role="alert" className="text-red-700">Could not load products: {products.error.message}</p>}
        <label>Product
          <select className={field} required value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">Choose product…</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
        </label>
        <label>Warehouse
          <select className={field} required value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>Batch number<input className={field} required maxLength={40} value={f.batch_no} onChange={(e) => setF({ ...f, batch_no: e.target.value })} /></label>
          <label>Expiry date (optional)<input type="date" className={field} value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></label>
          <label>Quantity (base unit)<input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
          <label>Cost per unit (Rp)<input className={field} inputMode="numeric" required pattern="[0-9]+" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></label>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Receive</button>
        </div>
      </form>
    </Modal>
  );
}

function PickDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const products = useProducts();
  const [f, setF] = useState({ product_id: '', warehouse_id: String(warehouses[0]?.id ?? ''), qty: '' });
  const [error, setError] = useState<string | null>(null);
  const pick = useMutation({
    mutationFn: () => api<BatchPick>(`/stock/batches/pick?${new URLSearchParams({ product_id: f.product_id, warehouse_id: f.warehouse_id, qty_milli: String(Math.round(Number(f.qty.replace(',', '.')) * 1000)) })}`),
    onError: (e) => setError(e.message),
  });
  const r = pick.data;
  return (
    <Modal title="Pick first-expired-first-out" onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); pick.mutate(); }}>
        <label>Product
          <select className={field} required value={f.product_id} onChange={(e) => setF({ ...f, product_id: e.target.value })}>
            <option value="">Choose product…</option>
            {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label>Warehouse
            <select className={field} value={f.warehouse_id} onChange={(e) => setF({ ...f, warehouse_id: e.target.value })}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Quantity needed<input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></label>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        {r && (
          <div className="rounded border bg-slate-50 p-3">
            {r.allocations.length === 0 ? <p>No unexpired batch has stock here.</p> : (
              <ul className="grid gap-1">
                {r.allocations.map((a) => <li key={a.batch_id}>Take <b>{qty(a.qty_milli)}</b> from batch <b>{a.batch_no}</b> (expires {formatDate(a.expiry_date)})</li>)}
              </ul>
            )}
            {r.shortfall_milli > 0 && <p className="mt-2 text-red-700">Short by {qty(r.shortfall_milli)} — not enough unexpired batch stock.</p>}
            {r.expired_milli > 0 && <p className="mt-1 text-amber-800">{qty(r.expired_milli)} in expired batches was skipped.</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Close</button>
          <button disabled={pick.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Suggest batches</button>
        </div>
      </form>
    </Modal>
  );
}
