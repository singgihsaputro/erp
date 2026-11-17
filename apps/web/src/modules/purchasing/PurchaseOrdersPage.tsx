import { useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PO_STATUSES, formatRupiah, type Page, type PoDetail, type PoStatus, type PoSummary, type Product, type Supplier, type Warehouse } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';
import { useCompany } from '../settings/SettingsPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const statusLabel = (s: string) => PO_STATUSES.find((x) => x[0] === s)?.[1] ?? s;
const badge: Record<PoStatus, string> = { draft: 'bg-slate-200 text-slate-700', submitted: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800', cancelled: 'bg-red-100 text-red-700' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

function useRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['purchase-orders'] });
}

export default function PurchaseOrdersPage({ canApprove }: { canApprove: boolean }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<PoDetail | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['purchase-orders', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (status) p.set('status', status);
      return api<Page<PoSummary>>(`/purchase-orders?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Purchase orders</h1>
        <select aria-label="Status" className="ml-auto rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {PO_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing('new')}>New purchase order</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Draft an order, submit it for approval, then print it for the supplier. Prices exclude PPN. An approved order can no longer be edited.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading purchase orders…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load purchase orders: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No purchase orders yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Supplier</th><th className="p-2">Deliver to</th><th className="p-2">Status</th><th className="p-2 text-right">Lines</th><th className="p-2 text-right">Total incl. PPN</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(o.id)}>{o.number}</button></td>
                  <td className="p-2">{o.order_date}</td>
                  <td className="p-2">{o.supplier_name}{o.note && <div className="text-xs text-slate-500">{o.note}</div>}</td>
                  <td className="p-2">{o.warehouse_name}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${badge[o.status]}`}>{statusLabel(o.status)}</span></td>
                  <td className="p-2 text-right">{o.line_count}</td>
                  <td className="p-2 text-right">{formatRupiah(o.total)}</td>
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
      {open !== null && <DetailDialog id={open} canApprove={canApprove} onClose={() => setOpen(null)} onEdit={(d) => { setOpen(null); setEditing(d); }} />}
      {editing !== null && <FormDialog order={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Totals({ o }: { o: PoSummary }) {
  return (
    <dl className="ml-auto mt-3 grid w-64 grid-cols-2 gap-y-1 text-sm">
      <dt className="text-slate-500">DPP</dt><dd className="text-right">{formatRupiah(o.dpp)}</dd>
      <dt className="text-slate-500">PPN {o.ppn_rate_bp / 100}%</dt><dd className="text-right">{formatRupiah(o.ppn)}</dd>
      <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatRupiah(o.total)}</dd>
    </dl>
  );
}

function DetailDialog({ id, canApprove, onClose, onEdit }: { id: number; canApprove: boolean; onClose: () => void; onEdit: (d: PoDetail) => void }) {
  const refresh = useRefresh();
  const [error, setError] = useState<string | null>(null);
  const d = useQuery({ queryKey: ['purchase-orders', 'detail', id], queryFn: () => api<PoDetail>(`/purchase-orders/${id}`) });
  const act = useMutation({
    mutationFn: (what: 'submit' | 'approve' | 'reject' | 'cancel') => api<PoDetail>(`/purchase-orders/${id}/${what}`, { method: 'POST', body: {} }),
    onSuccess: (_r, what) => { refresh(); if (what === 'cancel' || what === 'approve') onClose(); },
    onError: (e) => setError(e.message),
  });
  const run = (what: 'submit' | 'approve' | 'reject' | 'cancel', ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    setError(null);
    act.mutate(what);
  };
  const o = d.data;
  return (
    <Modal title={o ? o.number : 'Purchase order'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the purchase order: {d.error.message}</p>}
      {o && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {o.supplier_name} → {o.warehouse_name} · <span className={`rounded px-2 py-0.5 text-xs ${badge[o.status]}`}>{statusLabel(o.status)}</span> · ordered {o.order_date}
            {o.expected_date ? ` · expected ${o.expected_date}` : ''} · by {o.created_by_name}
            {o.approved_at ? ` · approved ${o.approved_at.slice(0, 10)} by ${o.approved_by_name}` : ''}{o.note ? ` · ${o.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {o.lines.map((l) => (
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
          <Totals o={o} />
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2 text-sm">
            {o.status !== 'cancelled' && <button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print</button>}
            {o.status !== 'cancelled' && (
              <button disabled={act.isPending} className="rounded border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50"
                onClick={() => run('cancel', `Cancel ${o.number}? It cannot be reopened.`)}>Cancel order</button>
            )}
            {o.status === 'draft' && <button className="rounded border px-3 py-1.5" onClick={() => onEdit(o)}>Edit</button>}
            {o.status === 'draft' && <button disabled={act.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => run('submit')}>Submit for approval</button>}
            {o.status === 'submitted' && canApprove && (
              <>
                <button disabled={act.isPending} className="rounded border px-3 py-1.5 disabled:opacity-50" onClick={() => run('reject', `Send ${o.number} back to draft?`)}>Send back</button>
                <button disabled={act.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => run('approve', `Approve ${o.number}? It can no longer be edited.`)}>Approve</button>
              </>
            )}
          </div>
          {createPortal(<OrderPrint o={o} />, document.body)}
        </>
      )}
    </Modal>
  );
}

const cell = { border: '1px solid #000', padding: '2mm' } as const;

function OrderPrint({ o }: { o: PoDetail }) {
  const company = useCompany();
  return (
    <div className="print-root">
      <h1 style={{ fontSize: '16pt', fontWeight: 600 }}>{company.data?.name}</h1>
      <p style={{ whiteSpace: 'pre-line' }}>{company.data?.address}{company.data?.npwp ? `\nNPWP ${company.data.npwp}` : ''}</p>
      <h2 style={{ fontSize: '14pt', fontWeight: 600, margin: '6mm 0 2mm' }}>Purchase Order {o.number}</h2>
      <p>Date {o.order_date}{o.expected_date ? ` · Expected ${o.expected_date}` : ''}</p>
      <p>To: {o.supplier_name}{o.supplier_address ? `, ${o.supplier_address}` : ''}{o.supplier_npwp ? ` · NPWP ${o.supplier_npwp}` : ''}</p>
      <p style={{ marginBottom: '4mm' }}>Deliver to: {o.warehouse_name}{o.note ? ` · ${o.note}` : ''}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
        <thead><tr>{['SKU', 'Product', 'Qty', 'Unit price', 'Amount'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {o.lines.map((l) => (
            <tr key={l.product_id}>
              <td style={cell}>{l.sku}</td><td style={cell}>{l.name}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{qty(l.qty_milli)} {l.base_unit}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.unit_cost)}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: 'right', marginTop: '3mm' }}>DPP {formatRupiah(o.dpp)} · PPN {o.ppn_rate_bp / 100}% {formatRupiah(o.ppn)} · <strong>Total {formatRupiah(o.total)}</strong></p>
      <p style={{ marginTop: '4mm' }}>{o.status === 'approved' ? `Approved by ${o.approved_by_name} on ${o.approved_at?.slice(0, 10)}` : `Status: ${statusLabel(o.status)} (not yet approved)`}</p>
    </div>
  );
}

interface Line { product_id: string; qty: string; price: string }
const blank = (): Line => ({ product_id: '', qty: '', price: '' });

function FormDialog({ order, onClose }: { order: PoDetail | null; onClose: () => void }) {
  const refresh = useRefresh();
  const suppliers = useQuery({ queryKey: ['suppliers', 'active'], queryFn: () => api<Supplier[]>('/suppliers') });
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const products = useQuery({ queryKey: ['products', 'all-active'], queryFn: () => api<Page<Product>>('/products?page_size=200') });
  const [supplier, setSupplier] = useState(order ? String(order.supplier_id) : '');
  const [warehouse, setWarehouse] = useState(order ? String(order.warehouse_id) : '');
  const [orderDate, setOrderDate] = useState(order?.order_date ?? today());
  const [expected, setExpected] = useState(order?.expected_date ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<Line[]>(order ? order.lines.map((l) => ({ product_id: String(l.product_id), qty: String(l.qty_milli / 1000), price: String(l.unit_cost) })) : [blank()]);
  const [error, setError] = useState<string | null>(null);
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    const p = products.data?.items.find((x) => String(x.id) === id);
    set(i, { product_id: id, ...(p && !lines[i].price ? { price: String(p.cost) } : {}) });
  };
  const save = useMutation({
    mutationFn: () =>
      api<PoDetail>(order ? `/purchase-orders/${order.id}` : '/purchase-orders', {
        method: order ? 'PUT' : 'POST',
        body: {
          supplier_id: Number(supplier),
          warehouse_id: Number(warehouse),
          order_date: orderDate,
          expected_date: expected || null,
          note,
          lines: lines.map((l) => ({ product_id: Number(l.product_id), qty_milli: Math.round(Number(l.qty.replace(',', '.')) * 1000), unit_cost: Math.round(Number(l.price)) })),
        },
      }),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setError(e.message),
  });
  const dpp = lines.reduce((sum, l) => sum + Math.round((Math.round(Number(l.qty.replace(',', '.') || 0) * 1000) * Math.round(Number(l.price || 0))) / 1000), 0);
  return (
    <Modal title={order ? `Edit ${order.number}` : 'New purchase order'} wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Supplier
            <select className={field} value={supplier} required onChange={(e) => setSupplier(e.target.value)}>
              <option value="">Choose supplier…</option>
              {suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Deliver to
            <select className={field} value={warehouse} required onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">Choose warehouse…</option>
              {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Order date
            <input type="date" className={field} value={orderDate} required onChange={(e) => setOrderDate(e.target.value)} />
          </label>
          <label>Expected date
            <input type="date" className={field} value={expected} min={orderDate} onChange={(e) => setExpected(e.target.value)} />
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(suppliers.isError || products.isError || warehouses.isError) && <p role="alert" className="text-red-700">Could not load the lists for this form. Close it and try again.</p>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_9rem_auto]">
            <select aria-label={`Line ${i + 1} product`} className={`${field} col-span-2 sm:col-span-1`} value={l.product_id} required onChange={(e) => pick(i, e.target.value)}>
              <option value="">Choose product…</option>
              {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
            <input aria-label={`Line ${i + 1} quantity`} className={field} inputMode="decimal" placeholder="Qty" value={l.qty} required pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => set(i, { qty: e.target.value })} />
            <input aria-label={`Line ${i + 1} unit price`} className={field} inputMode="numeric" placeholder="Price (Rp)" value={l.price} required pattern="[0-9]+" onChange={(e) => set(i, { price: e.target.value })} />
            <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div><button type="button" className="text-blue-700 hover:underline" onClick={() => setLines([...lines, blank()])}>Add line</button></div>
        <p className="text-xs text-slate-500">DPP so far {formatRupiah(dpp)}. PPN is added at the rate in company settings when the order is saved.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">{order ? 'Save draft' : 'Create draft'}</button>
        </div>
      </form>
    </Modal>
  );
}
