import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type GrDetail, type GrSummary, type Page, type PoDetail, type PoSummary } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

export default function GoodsReceiptsPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [receiving, setReceiving] = useState(false);
  const list = useQuery({
    queryKey: ['goods-receipts', page],
    queryFn: () => api<Page<GrSummary>>(`/goods-receipts?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Goods receipts</h1>
        <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setReceiving(true)}>Receive goods</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Book what a supplier delivered against an approved purchase order, in part or in full. Stock goes in at the order&apos;s price and the product cost is re-averaged. A posted receipt cannot be edited.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading goods receipts…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load goods receipts: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No goods received yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Purchase order</th><th className="p-2">Supplier</th><th className="p-2">Warehouse</th><th className="p-2">Supplier ref.</th><th className="p-2 text-right">Value excl. PPN</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button></td>
                  <td className="p-2">{r.receipt_date}</td>
                  <td className="p-2">{r.order_number}</td>
                  <td className="p-2">{r.supplier_name}</td>
                  <td className="p-2">{r.warehouse_name}</td>
                  <td className="p-2">{r.supplier_ref || '—'}</td>
                  <td className="p-2 text-right">{formatRupiah(r.value)}</td>
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
      {open !== null && <DetailDialog id={open} onClose={() => setOpen(null)} />}
      {receiving && <ReceiveDialog onClose={() => setReceiving(false)} />}
    </section>
  );
}

function DetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useQuery({ queryKey: ['goods-receipts', 'detail', id], queryFn: () => api<GrDetail>(`/goods-receipts/${id}`) });
  const r = d.data;
  return (
    <Modal title={r ? r.number : 'Goods receipt'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the receipt: {d.error.message}</p>}
      {r && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {r.supplier_name} → {r.warehouse_name} · against {r.order_number} · {r.receipt_date} · by {r.received_by_name}
            {r.supplier_ref ? ` · supplier ref. ${r.supplier_ref}` : ''}{r.note ? ` · ${r.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty received</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {r.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.qty_milli)} {l.base_unit}</td>
                    <td className="text-right">{formatRupiah(l.unit_cost)}</td>
                    <td className="text-right">{formatRupiah(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-right text-sm font-semibold">Value excl. PPN {formatRupiah(r.value)}</p>
        </>
      )}
    </Modal>
  );
}

function ReceiveDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const orders = useQuery({ queryKey: ['purchase-orders', 'approved-open'], queryFn: () => api<Page<PoSummary>>('/purchase-orders?status=approved&page_size=200') });
  const [orderId, setOrderId] = useState('');
  const [date, setDate] = useState(today());
  const [ref, setRef] = useState('');
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const order = useQuery({
    queryKey: ['purchase-orders', 'detail', orderId, 'receive'],
    queryFn: () => api<PoDetail>(`/purchase-orders/${orderId}`),
    enabled: orderId !== '',
  });
  const open = orders.data?.items.filter((o) => o.receive_status !== 'complete') ?? [];
  const lines = order.data?.lines ?? [];
  const choose = (id: string) => { setOrderId(id); setAmounts({}); setError(null); };
  const value = (l: PoDetail['lines'][number]) => amounts[l.product_id] ?? String((l.qty_milli - l.received_milli) / 1000);
  const save = useMutation({
    mutationFn: () =>
      api<GrDetail>('/goods-receipts', {
        method: 'POST',
        body: {
          order_id: Number(orderId),
          receipt_date: date,
          supplier_ref: ref,
          note,
          lines: lines
            .map((l) => ({ product_id: l.product_id, qty_milli: Math.round(Number(value(l).replace(',', '.') || 0) * 1000) }))
            .filter((l) => l.qty_milli > 0),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goods-receipts'] });
      qc.invalidateQueries({ queryKey: ['purchase-orders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Receive goods" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {orders.isPending && <p className="text-slate-500">Loading approved orders…</p>}
        {orders.isError && <p role="alert" className="text-red-700">Could not load purchase orders: {orders.error.message}</p>}
        {orders.data && open.length === 0 && <p className="rounded border border-dashed p-3 text-slate-500">No approved purchase order is waiting for goods.</p>}
        <label>Purchase order
          <select className={field} value={orderId} required onChange={(e) => choose(e.target.value)}>
            <option value="">Choose an approved order…</option>
            {open.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.supplier_name} → {o.warehouse_name}{o.receive_status === 'partial' ? ' (partly received)' : ''}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Receipt date
            <input type="date" className={field} value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>Supplier delivery note no.
            <input className={field} maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {order.isPending && orderId !== '' && <p className="text-slate-500">Loading order…</p>}
        {order.isError && <p role="alert" className="text-red-700">Could not load the order: {order.error.message}</p>}
        {order.data && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Ordered</th><th className="text-right">Received</th><th className="text-right">Outstanding</th><th className="w-28 text-right">Receive now</th></tr></thead>
              <tbody className="divide-y">
                {lines.map((l) => {
                  const left = l.qty_milli - l.received_milli;
                  return (
                    <tr key={l.product_id}>
                      <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku} · {formatRupiah(l.unit_cost)} / {l.base_unit}</div></td>
                      <td className="text-right">{qty(l.qty_milli)}</td>
                      <td className="text-right">{qty(l.received_milli)}</td>
                      <td className="text-right">{qty(left)}</td>
                      <td className="text-right">
                        <input aria-label={`Receive ${l.name}`} className={`${field} text-right`} inputMode="decimal" disabled={left <= 0} value={left <= 0 ? '0' : value(l)}
                          pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => setAmounts({ ...amounts, [l.product_id]: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">Enter 0 for a line that has not arrived. You cannot receive more than is outstanding on the order.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending || !order.data} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post receipt</button>
        </div>
      </form>
    </Modal>
  );
}
