import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TRANSFER_STATUSES, formatRupiah, type Page, type Product, type TransferDetail, type TransferStatus, type TransferSummary, type Warehouse } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from './StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const statusLabel = (s: string) => TRANSFER_STATUSES.find((x) => x[0] === s)?.[1] ?? s;
const badge: Record<TransferStatus, string> = { in_transit: 'bg-amber-100 text-amber-800', received: 'bg-green-100 text-green-800', cancelled: 'bg-slate-200 text-slate-600' };

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ['stock', 'stock-transfers', 'warehouses', 'products']) qc.invalidateQueries({ queryKey: [k] });
  };
}

export default function TransfersPage({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const list = useQuery({
    queryKey: ['stock-transfers', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (status) p.set('status', status);
      return api<Page<TransferSummary>>(`/stock/transfers?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Stock transfers</h1>
        <select aria-label="Status" className="ml-auto rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {TRANSFER_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        {canManage && <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setCreating(true)}>New transfer</button>}
      </div>
      <p className="mb-4 text-sm text-slate-500">Sending takes the stock out of the source warehouse; it is in transit until the destination receives it.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading transfers…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load transfers: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No transfers yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">From</th><th className="p-2">To</th><th className="p-2">Status</th><th className="p-2 text-right">Lines</th><th className="p-2 text-right">Value</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((t) => (
                <tr key={t.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(t.id)}>{t.number}</button></td>
                  <td className="p-2">{t.created_at.slice(0, 10)}</td>
                  <td className="p-2">{t.from_warehouse_name}</td>
                  <td className="p-2">{t.to_warehouse_name}{t.note && <div className="text-xs text-slate-500">{t.note}</div>}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${badge[t.status]}`}>{statusLabel(t.status)}</span></td>
                  <td className="p-2 text-right">{t.line_count}</td>
                  <td className="p-2 text-right">{formatRupiah(t.value)}</td>
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
      {open !== null && <DetailDialog id={open} canManage={canManage} onClose={() => setOpen(null)} />}
      {creating && <NewDialog warehouses={warehouses.data ?? []} onClose={() => setCreating(false)} />}
    </section>
  );
}

function DetailDialog({ id, canManage, onClose }: { id: number; canManage: boolean; onClose: () => void }) {
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const d = useQuery({ queryKey: ['stock-transfers', 'detail', id], queryFn: () => api<TransferDetail>(`/stock/transfers/${id}`) });
  const act = useMutation({
    mutationFn: (what: 'receive' | 'cancel') => api<TransferDetail>(`/stock/transfers/${id}/${what}`, { method: 'POST', body: {} }),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={d.data ? d.data.number : 'Transfer'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the transfer: {d.error.message}</p>}
      {d.data && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {d.data.from_warehouse_name} → {d.data.to_warehouse_name} · {statusLabel(d.data.status)} · sent {d.data.created_at.slice(0, 10)} by {d.data.created_by_name}
            {d.data.received_at ? ` · received ${d.data.received_at.slice(0, 10)}` : ''}{d.data.cancelled_at ? ` · cancelled ${d.data.cancelled_at.slice(0, 10)}` : ''}{d.data.note ? ` · ${d.data.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Value</th></tr></thead>
              <tbody className="divide-y">
                {d.data.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.qty_milli)} {l.base_unit}</td>
                    <td className="text-right">{formatRupiah(l.unit_cost)}</td>
                    <td className="text-right">{formatRupiah(Math.round((l.qty_milli * l.unit_cost) / 1000))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {canManage && d.data.status === 'in_transit' && (
            <div className="mt-4 flex justify-end gap-2 text-sm">
              <button disabled={act.isPending} className="rounded border px-3 py-1.5 text-red-700 disabled:opacity-50"
                onClick={() => window.confirm(`Cancel ${d.data.number}? The stock goes back to ${d.data.from_warehouse_name}.`) && act.mutate('cancel')}>Cancel transfer</button>
              <button disabled={act.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50"
                onClick={() => window.confirm(`Confirm that ${d.data.to_warehouse_name} received everything on ${d.data.number}?`) && act.mutate('receive')}>Receive at {d.data.to_warehouse_name}</button>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

interface Line { product_id: string; qty: string }
const blank = (): Line => ({ product_id: '', qty: '' });

function NewDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const refresh = useRefresh();
  const [from, setFrom] = useState(String(warehouses[0]?.id ?? ''));
  const [to, setTo] = useState(String(warehouses[1]?.id ?? ''));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({ queryKey: ['products', 'all-active'], queryFn: () => api<Page<Product>>('/products?page_size=200') });
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = useMutation({
    mutationFn: () =>
      api('/stock/transfers', {
        method: 'POST',
        body: {
          from_warehouse_id: Number(from),
          to_warehouse_id: Number(to),
          note,
          lines: lines.map((l) => ({ product_id: Number(l.product_id), qty_milli: Math.round(Number(l.qty.replace(',', '.')) * 1000) })),
        },
      }),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="New stock transfer" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>From warehouse
            <select className={field} value={from} required onChange={(e) => setFrom(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>To warehouse
            <select className={field} value={to} required onChange={(e) => setTo(e.target.value)}>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {products.isError && <p role="alert" className="text-red-700">Could not load products: {products.error.message}</p>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <select aria-label={`Line ${i + 1} product`} className={`${field} col-span-2 sm:col-span-1`} value={l.product_id} required onChange={(e) => set(i, { product_id: e.target.value })}>
              <option value="">Choose product…</option>
              {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
            <input aria-label={`Line ${i + 1} quantity`} className={field} inputMode="decimal" placeholder="Qty" value={l.qty} required pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => set(i, { qty: e.target.value })} />
            <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div><button type="button" className="text-blue-700 hover:underline" onClick={() => setLines([...lines, blank()])}>Add line</button></div>
        <p className="text-xs text-slate-500">The stock leaves the source now and stays in transit until it is received.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Send transfer</button>
        </div>
      </form>
    </Modal>
  );
}
