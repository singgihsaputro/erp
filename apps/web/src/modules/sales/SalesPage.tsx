import { useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  QUOTE_STATUSES,
  SO_STATUSES,
  formatRupiah,
  type Availability,
  type Customer,
  type DeliveryDetail,
  type DeliverySummary,
  type InvoiceableOrder,
  type Page,
  PAYMENT_TERMS_LABELS,
  type PaymentTerms,
  type QuotationDetail,
  type QuotationSummary,
  type SalesInvoiceDetail,
  type SalesInvoiceSummary,
  type SalesOrderDetail,
  type SalesOrderSummary,
  type Warehouse,
} from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';
import { useCompany } from '../settings/SettingsPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const badges: Record<string, string> = {
  draft: 'bg-slate-200 text-slate-700', sent: 'bg-amber-100 text-amber-800', converted: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700', cancelled: 'bg-red-100 text-red-700', open: 'bg-blue-100 text-blue-800',
};
const labelOf = (list: readonly (readonly [string, string])[], s: string) => list.find((x) => x[0] === s)?.[1] ?? s;

function Badge({ status, list }: { status: string; list: readonly (readonly [string, string])[] }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${badges[status] ?? ''}`}>{labelOf(list, status)}</span>;
}

function Totals({ o }: { o: { dpp: number; ppn: number; total: number; ppn_rate_bp: number } }) {
  return (
    <dl className="ml-auto mt-3 grid w-64 grid-cols-2 gap-y-1 text-sm">
      <dt className="text-slate-500">DPP</dt><dd className="text-right">{formatRupiah(o.dpp)}</dd>
      <dt className="text-slate-500">PPN {o.ppn_rate_bp / 100}%</dt><dd className="text-right">{formatRupiah(o.ppn)}</dd>
      <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatRupiah(o.total)}</dd>
    </dl>
  );
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total <= PAGE_SIZE) return null;
  return (
    <div className="mt-3 flex items-center gap-3 text-sm">
      <span>Page {page} of {pages}</span>
      <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border px-3 py-1 disabled:opacity-40">Previous</button>
      <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="rounded border px-3 py-1 disabled:opacity-40">Next</button>
    </div>
  );
}

export default function SalesPage() {
  const [tab, setTab] = useState<'quotations' | 'orders' | 'deliveries' | 'invoices'>('quotations');
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [deliverOrder, setDeliverOrder] = useState<number | null>(null);
  const [openDelivery, setOpenDelivery] = useState<number | null>(null);
  const [invoiceOrder, setInvoiceOrder] = useState<number | null>(null);
  const [openInvoice, setOpenInvoice] = useState<number | null>(null);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Quotations and sales orders</h1>
        <div className="ml-auto flex gap-1 text-sm" role="tablist">
          {([['quotations', 'Quotations'], ['orders', 'Sales orders'], ['deliveries', 'Deliveries'], ['invoices', 'Invoices']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`rounded px-3 py-1.5 ${tab === k ? 'bg-slate-900 text-white' : 'border'}`} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'quotations'
        ? <QuotationsTab onOrder={(id) => { setTab('orders'); setOpenOrder(id); }} />
        : tab === 'orders' ? <OrdersTab onDeliver={setDeliverOrder} onInvoice={setInvoiceOrder} /> : tab === 'deliveries' ? <DeliveriesTab onOpen={setOpenDelivery} /> : <InvoicesTab onOpen={setOpenInvoice} />}
      {openOrder !== null && <OrderDialog id={openOrder} onClose={() => setOpenOrder(null)} onDeliver={(id) => { setOpenOrder(null); setDeliverOrder(id); }} onInvoice={(id) => { setOpenOrder(null); setInvoiceOrder(id); }} />}
      {deliverOrder !== null && <DeliveryForm orderId={deliverOrder} onClose={() => setDeliverOrder(null)} onDone={(id) => { setDeliverOrder(null); setTab('deliveries'); setOpenDelivery(id); }} />}
      {openDelivery !== null && <DeliveryDialog id={openDelivery} onClose={() => setOpenDelivery(null)} />}
      {invoiceOrder !== null && <InvoiceForm orderId={invoiceOrder} onClose={() => setInvoiceOrder(null)} onDone={(id) => { setInvoiceOrder(null); setTab('invoices'); setOpenInvoice(id); }} />}
      {openInvoice !== null && <InvoiceDialog id={openInvoice} onClose={() => setOpenInvoice(null)} />}
    </section>
  );
}

function ListState({ q, empty, count }: { q: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown }; empty: string; count: number | undefined }) {
  return (
    <>
      {q.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {q.isError && <p role="alert" className="text-sm text-red-700">Could not load: {q.error?.message} <button className="underline" onClick={() => q.refetch()}>Retry</button></p>}
      {count === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">{empty}</p>}
    </>
  );
}

// ---------- quotations ----------

function QuotationsTab({ onOrder }: { onOrder: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<QuotationDetail | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['quotations', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (status) p.set('status', status);
      return api<Page<QuotationSummary>>(`/quotations?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">Quote a customer, then convert the accepted quotation into a sales order that reserves stock.</p>
        <select aria-label="Status" className="ml-auto rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {QUOTE_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing('new')}>New quotation</button>
      </div>
      <ListState q={list} empty="No quotations yet." count={data?.items.length} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Valid until</th><th className="p-2">Status</th><th className="p-2 text-right">Total incl. PPN</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((q) => (
                <tr key={q.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(q.id)}>{q.number}</button></td>
                  <td className="p-2">{q.quote_date}</td>
                  <td className="p-2">{q.customer_name}{q.note && <div className="text-xs text-slate-500">{q.note}</div>}</td>
                  <td className="p-2">{q.valid_until}</td>
                  <td className="p-2"><Badge status={q.status} list={QUOTE_STATUSES} />{q.expired && <span className="ml-1 rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">Expired</span>}</td>
                  <td className="p-2 text-right">{formatRupiah(q.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} setPage={setPage} />}
      {open !== null && <QuotationDialog id={open} onClose={() => setOpen(null)} onEdit={(d) => { setOpen(null); setEditing(d); }} onOrder={(id) => { setOpen(null); onOrder(id); }} />}
      {editing !== null && <QuotationForm quote={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

type QAction = 'send' | 'reject' | 'cancel';

function QuotationDialog({ id, onClose, onEdit, onOrder }: { id: number; onClose: () => void; onEdit: (d: QuotationDetail) => void; onOrder: (orderId: number) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const d = useQuery({ queryKey: ['quotations', 'detail', id], queryFn: () => api<QuotationDetail>(`/quotations/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['quotations'] }); qc.invalidateQueries({ queryKey: ['sales-orders'] }); };
  const act = useMutation({
    mutationFn: (what: QAction) => api<QuotationDetail>(`/quotations/${id}/${what}`, { method: 'POST', body: {} }),
    onSuccess: (_r, what) => { refresh(); if (what === 'cancel') onClose(); },
    onError: (e) => setError(e.message),
  });
  const convert = useMutation({
    mutationFn: () => api<{ sales_order_id: number }>(`/quotations/${id}/convert`, { method: 'POST', body: {} }),
    onSuccess: (r) => { refresh(); onOrder(r.sales_order_id); },
    onError: (e) => setError(e.message),
  });
  const run = (what: QAction, ask?: string) => {
    if (ask && !window.confirm(ask)) return;
    setError(null);
    act.mutate(what);
  };
  const q = d.data;
  const busy = act.isPending || convert.isPending;
  return (
    <Modal title={q ? q.number : 'Quotation'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the quotation: {d.error.message}</p>}
      {q && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {q.customer_name} · <Badge status={q.status} list={QUOTE_STATUSES} />{q.expired ? ' (expired)' : ''} · quoted {q.quote_date}, valid until {q.valid_until} · stock from {q.warehouse_name} · by {q.created_by_name}
            {q.sales_order_number ? ` · order ${q.sales_order_number}` : ''}{q.note ? ` · ${q.note}` : ''}
          </p>
          <LinesTable lines={q.lines} />
          <Totals o={q} />
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2 text-sm">
            <button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print</button>
            {(q.status === 'draft' || q.status === 'sent') && (
              <button disabled={busy} className="rounded border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" onClick={() => run('cancel', `Cancel ${q.number}?`)}>Cancel quotation</button>
            )}
            {q.status === 'sent' && <button disabled={busy} className="rounded border px-3 py-1.5 disabled:opacity-50" onClick={() => run('reject', `Mark ${q.number} as rejected by the customer?`)}>Customer rejected</button>}
            {q.status === 'draft' && <button className="rounded border px-3 py-1.5" onClick={() => onEdit(q)}>Edit</button>}
            {q.status === 'draft' && <button disabled={busy} className="rounded border px-3 py-1.5 disabled:opacity-50" onClick={() => run('send')}>Mark as sent</button>}
            {(q.status === 'draft' || q.status === 'sent') && !q.expired && (
              <button disabled={busy} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" onClick={() => { setError(null); convert.mutate(); }}>Convert to sales order</button>
            )}
          </div>
          {createPortal(<DocPrint kind="Quotation" doc={q} extra={`Valid until ${q.valid_until}`} />, document.body)}
        </>
      )}
    </Modal>
  );
}

function LinesTable({ lines }: { lines: (QuotationDetail['lines'][number] & { reserved_milli?: number; on_hand_milli?: number; delivered_milli?: number })[] }) {
  const stock = lines.some((l) => l.on_hand_milli !== undefined);
  const delivered = lines.some((l) => l.delivered_milli !== undefined);
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty</th>{delivered && <th className="text-right">Delivered</th>}{stock && <th className="text-right">Reserved (all orders) / on hand</th>}<th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
        <tbody className="divide-y">
          {lines.map((l) => (
            <tr key={l.product_id}>
              <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
              <td className="text-right">{qty(l.qty_milli)} {l.base_unit}</td>
              {delivered && <td className="text-right">{qty(l.delivered_milli ?? 0)}</td>}
              {stock && <td className="text-right">{qty(l.reserved_milli ?? 0)} / {qty(l.on_hand_milli ?? 0)}</td>}
              <td className="text-right">{formatRupiah(l.unit_price)}</td>
              <td className="text-right">{formatRupiah(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell = { border: '1px solid #000', padding: '2mm' } as const;

function DocPrint({ kind, doc, extra }: { kind: string; doc: QuotationDetail | SalesOrderDetail; extra: string }) {
  const company = useCompany();
  const date = 'quote_date' in doc ? doc.quote_date : doc.order_date;
  return (
    <div className="print-root">
      <h1 style={{ fontSize: '16pt', fontWeight: 600 }}>{company.data?.name}</h1>
      <p style={{ whiteSpace: 'pre-line' }}>{company.data?.address}{company.data?.npwp ? `\nNPWP ${company.data.npwp}` : ''}</p>
      <h2 style={{ fontSize: '14pt', fontWeight: 600, margin: '6mm 0 2mm' }}>{kind} {doc.number}</h2>
      <p>Date {date} · {extra}</p>
      <p style={{ marginBottom: '4mm' }}>To: {doc.customer_name}{doc.customer_address ? `, ${doc.customer_address}` : ''}{doc.customer_npwp ? ` · NPWP ${doc.customer_npwp}` : ''}{doc.note ? ` · ${doc.note}` : ''}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
        <thead><tr>{['SKU', 'Product', 'Qty', 'Unit price', 'Amount'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left' }}>{h}</th>)}</tr></thead>
        <tbody>
          {doc.lines.map((l) => (
            <tr key={l.product_id}>
              <td style={cell}>{l.sku}</td><td style={cell}>{l.name}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{qty(l.qty_milli)} {l.base_unit}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.unit_price)}</td>
              <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ textAlign: 'right', marginTop: '3mm' }}>DPP {formatRupiah(doc.dpp)} · PPN {doc.ppn_rate_bp / 100}% {formatRupiah(doc.ppn)} · <strong>Total {formatRupiah(doc.total)}</strong></p>
    </div>
  );
}

// ---------- the form both documents use ----------

interface FormLine { product_id: string; qty: string; price: string }
const blank = (): FormLine => ({ product_id: '', qty: '', price: '' });

interface FormValues { customer_id: number; warehouse_id: number; date: string; second: string | null; note: string; lines: { product_id: number; qty_milli: number; unit_price: number }[] }

function DocForm({ title, secondLabel, initial, submitLabel, showStock, onSave, onClose }: {
  title: string;
  secondLabel: string;
  initial: { customer: string; warehouse: string; date: string; second: string; note: string; lines: FormLine[] };
  submitLabel: string;
  showStock: boolean;
  onSave: (v: FormValues) => Promise<unknown>;
  onClose: () => void;
}) {
  const customers = useQuery({ queryKey: ['customers', 'active'], queryFn: () => api<Customer[]>('/customers') });
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const [customer, setCustomer] = useState(initial.customer);
  const [warehouse, setWarehouse] = useState(initial.warehouse);
  const [date, setDate] = useState(initial.date);
  const [second, setSecond] = useState(initial.second);
  const [note, setNote] = useState(initial.note);
  const [lines, setLines] = useState<FormLine[]>(initial.lines);
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({
    queryKey: ['sales-orders', 'availability', warehouse],
    queryFn: () => api<Availability[]>(`/sales-orders/availability?warehouse_id=${warehouse}`),
    enabled: warehouse !== '',
  });
  const set = (i: number, patch: Partial<FormLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    const p = products.data?.find((x) => String(x.product_id) === id);
    set(i, { product_id: id, ...(p && !lines[i].price ? { price: String(p.price) } : {}) });
  };
  const milli = (l: FormLine) => Math.round(Number(l.qty.replace(',', '.') || 0) * 1000);
  const save = useMutation({
    mutationFn: () =>
      onSave({
        customer_id: Number(customer), warehouse_id: Number(warehouse), date, second: second || null, note,
        lines: lines.map((l) => ({ product_id: Number(l.product_id), qty_milli: milli(l), unit_price: Math.round(Number(l.price)) })),
      }),
    onSuccess: onClose,
    onError: (e) => setError(e.message),
  });
  const dpp = lines.reduce((sum, l) => sum + Math.round((milli(l) * Math.round(Number(l.price || 0))) / 1000), 0);
  return (
    <Modal title={title} wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Customer
            <select className={field} value={customer} required onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Choose customer…</option>
              {customers.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Stock from
            <select className={field} value={warehouse} required onChange={(e) => setWarehouse(e.target.value)}>
              <option value="">Choose warehouse…</option>
              {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </label>
          <label>Date
            <input type="date" className={field} value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>{secondLabel}
            <input type="date" className={field} value={second} min={date} onChange={(e) => setSecond(e.target.value)} />
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {(customers.isError || warehouses.isError || products.isError) && <p role="alert" className="text-red-700">Could not load the lists for this form. Close it and try again.</p>}
        {warehouse === '' && <p className="text-xs text-slate-500">Choose the warehouse first to see what is available.</p>}
        {lines.map((l, i) => {
          const a = products.data?.find((x) => String(x.product_id) === l.product_id);
          return (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_6rem_9rem_auto]">
              <select aria-label={`Line ${i + 1} product`} className={`${field} col-span-2 sm:col-span-1`} value={l.product_id} required onChange={(e) => pick(i, e.target.value)}>
                <option value="">Choose product…</option>
                {products.data?.map((p) => <option key={p.product_id} value={p.product_id}>{p.sku} · {p.name} ({qty(p.available_milli)} available)</option>)}
              </select>
              <input aria-label={`Line ${i + 1} quantity`} className={field} inputMode="decimal" placeholder="Qty" value={l.qty} required pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => set(i, { qty: e.target.value })} />
              <input aria-label={`Line ${i + 1} unit price`} className={field} inputMode="numeric" placeholder="Price (Rp)" value={l.price} required pattern="[0-9]+" onChange={(e) => set(i, { price: e.target.value })} />
              <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
              {a && showStock && milli(l) > a.available_milli && <p className="col-span-2 text-xs text-red-700 sm:col-span-4">Only {qty(a.available_milli)} {a.base_unit} available to reserve.</p>}
            </div>
          );
        })}
        <div><button type="button" className="text-blue-700 hover:underline" onClick={() => setLines([...lines, blank()])}>Add line</button></div>
        <p className="text-xs text-slate-500">DPP so far {formatRupiah(dpp)}. PPN is added at the rate in company settings when saved.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">{submitLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

function QuotationForm({ quote, onClose }: { quote: QuotationDetail | null; onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <DocForm
      title={quote ? `Edit ${quote.number}` : 'New quotation'}
      secondLabel="Valid until (default: 14 days)"
      submitLabel={quote ? 'Save draft' : 'Create draft'}
      showStock={false}
      initial={{
        customer: quote ? String(quote.customer_id) : '', warehouse: quote ? String(quote.warehouse_id) : '', date: quote?.quote_date ?? today(),
        second: quote?.valid_until ?? '', note: quote?.note ?? '',
        lines: quote ? quote.lines.map((l) => ({ product_id: String(l.product_id), qty: String(l.qty_milli / 1000), price: String(l.unit_price) })) : [blank()],
      }}
      onSave={async (v) => {
        await api(quote ? `/quotations/${quote.id}` : '/quotations', {
          method: quote ? 'PUT' : 'POST',
          body: { customer_id: v.customer_id, warehouse_id: v.warehouse_id, quote_date: v.date, valid_until: v.second ?? undefined, note: v.note, lines: v.lines },
        });
        qc.invalidateQueries({ queryKey: ['quotations'] });
      }}
      onClose={onClose}
    />
  );
}

// ---------- sales orders ----------

function OrdersTab({ onDeliver, onInvoice }: { onDeliver: (id: number) => void; onInvoice: (id: number) => void }) {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['sales-orders', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (status) p.set('status', status);
      return api<Page<SalesOrderSummary>>(`/sales-orders?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500">An open order reserves its quantities in the warehouse, so they cannot be promised twice. Cancelling releases them.</p>
        <select aria-label="Status" className="ml-auto rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          {SO_STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setCreating(true)}>New sales order</button>
      </div>
      <ListState q={list} empty="No sales orders yet." count={data?.items.length} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Reserved in</th><th className="p-2">Deliver by</th><th className="p-2">Status</th><th className="p-2 text-right">Total incl. PPN</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((o) => (
                <tr key={o.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(o.id)}>{o.number}</button>{o.quotation_number && <div className="text-xs text-slate-500">from {o.quotation_number}</div>}</td>
                  <td className="p-2">{o.order_date}</td>
                  <td className="p-2">{o.customer_name}{o.note && <div className="text-xs text-slate-500">{o.note}</div>}</td>
                  <td className="p-2">{o.warehouse_name}</td>
                  <td className="p-2">{o.delivery_date ?? '—'}</td>
                  <td className="p-2"><Badge status={o.status} list={SO_STATUSES} />{o.status === 'open' && o.delivery_status !== 'none' && <span className="ml-1 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">{o.delivery_status === 'complete' ? 'Delivered' : 'Part delivered'}</span>}</td>
                  <td className="p-2 text-right">{formatRupiah(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} setPage={setPage} />}
      {open !== null && <OrderDialog id={open} onClose={() => setOpen(null)} onDeliver={(id) => { setOpen(null); onDeliver(id); }} onInvoice={(id) => { setOpen(null); onInvoice(id); }} />}
      {creating && <OrderForm onClose={() => setCreating(false)} />}
    </>
  );
}

function OrderDialog({ id, onClose, onDeliver, onInvoice }: { id: number; onClose: () => void; onDeliver: (id: number) => void; onInvoice: (id: number) => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const d = useQuery({ queryKey: ['sales-orders', 'detail', id], queryFn: () => api<SalesOrderDetail>(`/sales-orders/${id}`) });
  const cancel = useMutation({
    mutationFn: () => api<SalesOrderDetail>(`/sales-orders/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sales-orders'] }); onClose(); },
    onError: (e) => setError(e.message),
  });
  const o = d.data;
  return (
    <Modal title={o ? o.number : 'Sales order'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the order: {d.error.message}</p>}
      {o && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {o.customer_name} · <Badge status={o.status} list={SO_STATUSES} /> · ordered {o.order_date}{o.delivery_date ? `, deliver by ${o.delivery_date}` : ''} · reserved in {o.warehouse_name}
            {o.quotation_number ? ` · from ${o.quotation_number}` : ''} · by {o.created_by_name}{o.note ? ` · ${o.note}` : ''}
          </p>
          <LinesTable lines={o.lines} />
          <Totals o={o} />
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex flex-wrap justify-end gap-2 text-sm">
            {o.status === 'open' && <button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print</button>}
            {o.delivered_milli > 0 && (
              <button className="rounded border px-3 py-1.5" onClick={() => onInvoice(o.id)}>Invoice delivered goods</button>
            )}
            {o.status === 'open' && o.delivery_status !== 'complete' && (
              <button className="rounded bg-slate-900 px-3 py-1.5 text-white" onClick={() => onDeliver(o.id)}>Deliver goods (Surat Jalan)</button>
            )}
            {o.status === 'open' && o.delivery_status !== 'complete' && (
              <button disabled={cancel.isPending} className="rounded border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50"
                onClick={() => { if (window.confirm(`Cancel ${o.number}? What is not yet delivered is released from reservation.`)) { setError(null); cancel.mutate(); } }}>Cancel order</button>
            )}
          </div>
          {createPortal(<DocPrint kind="Sales Order" doc={o} extra={o.delivery_date ? `Deliver by ${o.delivery_date}` : 'Delivery date to be agreed'} />, document.body)}
        </>
      )}
    </Modal>
  );
}

function OrderForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  return (
    <DocForm
      title="New sales order"
      secondLabel="Deliver by"
      submitLabel="Create order and reserve stock"
      showStock
      initial={{ customer: '', warehouse: '', date: today(), second: '', note: '', lines: [blank()] }}
      onSave={async (v) => {
        await api('/sales-orders', { method: 'POST', body: { customer_id: v.customer_id, warehouse_id: v.warehouse_id, order_date: v.date, delivery_date: v.second, note: v.note, lines: v.lines } });
        qc.invalidateQueries({ queryKey: ['sales-orders'] });
      }}
      onClose={onClose}
    />
  );
}

// ---------- deliveries (Surat Jalan) ----------

function DeliveriesTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['deliveries', page],
    queryFn: () => api<Page<DeliverySummary>>(`/deliveries?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">A Surat Jalan sends goods against an open sales order, partly or in full, and takes the stock out of the warehouse. Start one from a sales order.</p>
      <ListState q={list} empty="No deliveries yet. Open a sales order and choose Deliver goods." count={data?.items.length} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Sales order</th><th className="p-2">From</th><th className="p-2">Driver / vehicle</th><th className="p-2 text-right">Lines</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((d) => (
                <tr key={d.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => onOpen(d.id)}>{d.number}</button></td>
                  <td className="p-2">{d.delivery_date}</td>
                  <td className="p-2">{d.customer_name}</td>
                  <td className="p-2">{d.order_number}</td>
                  <td className="p-2">{d.warehouse_name}</td>
                  <td className="p-2">{[d.driver, d.vehicle].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="p-2 text-right">{d.line_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} setPage={setPage} />}
    </>
  );
}

function DeliveryDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const company = useCompany();
  const d = useQuery({ queryKey: ['deliveries', 'detail', id], queryFn: () => api<DeliveryDetail>(`/deliveries/${id}`) });
  const x = d.data;
  return (
    <Modal title={x ? x.number : 'Delivery'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the delivery: {d.error.message}</p>}
      {x && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {x.customer_name} · against {x.order_number} · {x.delivery_date} · from {x.warehouse_name} · by {x.delivered_by_name}
            {x.driver ? ` · driver ${x.driver}` : ''}{x.vehicle ? ` · ${x.vehicle}` : ''}{x.note ? ` · ${x.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Delivered</th><th className="text-right">Ordered</th></tr></thead>
              <tbody className="divide-y">
                {x.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.qty_milli)} {l.base_unit}</td>
                    <td className="text-right">{qty(l.ordered_milli)} {l.base_unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex justify-end text-sm"><button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print Surat Jalan</button></div>
          {createPortal(
            <div className="print-root">
              <h1 style={{ fontSize: '16pt', fontWeight: 600 }}>{company.data?.name}</h1>
              <p style={{ whiteSpace: 'pre-line' }}>{company.data?.address}{company.data?.npwp ? `\nNPWP ${company.data.npwp}` : ''}</p>
              <h2 style={{ fontSize: '14pt', fontWeight: 600, margin: '6mm 0 2mm' }}>Surat Jalan {x.number}</h2>
              <p>Date {x.delivery_date} · Sales order {x.order_number}</p>
              <p>To: {x.customer_name}{x.customer_address ? `, ${x.customer_address}` : ''}</p>
              <p style={{ marginBottom: '4mm' }}>Driver {x.driver || '—'} · Vehicle {x.vehicle || '—'}{x.note ? ` · ${x.note}` : ''}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <thead><tr>{['SKU', 'Product', 'Qty delivered'].map((h) => <th key={h} style={{ ...cell, textAlign: 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {x.lines.map((l) => (
                    <tr key={l.product_id}><td style={cell}>{l.sku}</td><td style={cell}>{l.name}</td><td style={{ ...cell, textAlign: 'right' }}>{qty(l.qty_milli)} {l.base_unit}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20mm' }}>
                <span>Sender: ____________________</span><span>Driver: ____________________</span><span>Receiver: ____________________</span>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </Modal>
  );
}

function DeliveryForm({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: (id: number) => void }) {
  const qc = useQueryClient();
  const order = useQuery({ queryKey: ['sales-orders', 'detail', orderId], queryFn: () => api<SalesOrderDetail>(`/sales-orders/${orderId}`) });
  const [date, setDate] = useState(today());
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [note, setNote] = useState('');
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const o = order.data;
  const left = (l: SalesOrderDetail['lines'][number]) => l.qty_milli - l.delivered_milli;
  const create = useMutation({
    mutationFn: (body: object) => api<DeliveryDetail>('/deliveries', { method: 'POST', body }),
    onSuccess: (d) => { qc.invalidateQueries(); onDone(d.id); },
    onError: (e) => setError(e.message),
  });
  const submit = () => {
    if (!o) return;
    const lines: { product_id: number; qty_milli: number }[] = [];
    for (const l of o.lines) {
      const raw = (qtys[l.product_id] ?? '').trim().replace(',', '.');
      if (raw === '') continue;
      const milli = Math.round(Number(raw) * 1000);
      if (!Number.isFinite(milli) || milli <= 0) return setError(`${l.name}: enter a quantity above zero`);
      if (milli > left(l)) return setError(`${l.name}: only ${qty(left(l))} still to deliver`);
      lines.push({ product_id: l.product_id, qty_milli: milli });
    }
    if (lines.length === 0) return setError('Enter a quantity for at least one product');
    setError(null);
    create.mutate({ order_id: orderId, delivery_date: date, driver, vehicle, note, lines });
  };
  return (
    <Modal title={o ? `Deliver ${o.number}` : 'Deliver goods'} wide onClose={onClose}>
      {order.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {order.isError && <p role="alert" className="text-sm text-red-700">Could not load the order: {order.error.message}</p>}
      {o && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p className="mb-3 text-sm text-slate-600">{o.customer_name} · stock leaves {o.warehouse_name}. Leave a quantity empty to skip that product.</p>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="text-sm">Date<input type="date" className={field} value={date} min={o.order_date} onChange={(e) => setDate(e.target.value)} required /></label>
            <label className="text-sm">Driver<input className={field} value={driver} maxLength={80} onChange={(e) => setDriver(e.target.value)} /></label>
            <label className="text-sm">Vehicle<input className={field} value={vehicle} maxLength={40} onChange={(e) => setVehicle(e.target.value)} /></label>
            <label className="text-sm">Note<input className={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Ordered</th><th className="text-right">Delivered</th><th className="text-right">Still to deliver</th><th className="text-right">On hand</th><th className="w-32 text-right">Deliver now</th></tr></thead>
              <tbody className="divide-y">
                {o.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.qty_milli)}</td>
                    <td className="text-right">{qty(l.delivered_milli)}</td>
                    <td className="text-right">{qty(left(l))} {l.base_unit}</td>
                    <td className="text-right">{qty(l.on_hand_milli)}</td>
                    <td className="text-right">
                      <input aria-label={`Deliver ${l.name}`} inputMode="decimal" disabled={left(l) === 0} className={`${field} text-right`} value={qtys[l.product_id] ?? ''}
                        onChange={(e) => setQtys({ ...qtys, [l.product_id]: e.target.value })} />
                      {left(l) > 0 && <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setQtys({ ...qtys, [l.product_id]: String(Math.min(left(l), l.on_hand_milli) / 1000) })}>All</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2 text-sm">
            <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={create.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post Surat Jalan</button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------- sales invoices (Faktur) ----------

function InvoicesTab({ onOpen }: { onOpen: (id: number) => void }) {
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['sales-invoices', page],
    queryFn: () => api<Page<SalesInvoiceSummary>>(`/sales-invoices?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  return (
    <>
      <p className="mb-3 text-sm text-slate-500">A Faktur bills goods that have been delivered, at the sales order price plus PPN. Start one from a sales order.</p>
      <ListState q={list} empty="No invoices yet. Open a delivered sales order and choose Invoice delivered goods." count={data?.items.length} />
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Due</th><th className="p-2">Customer</th><th className="p-2">Sales order</th><th className="p-2 text-right">DPP</th><th className="p-2 text-right">PPN</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Outstanding</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => onOpen(i.id)}>{i.number}</button></td>
                  <td className="p-2">{i.invoice_date}</td>
                  <td className="p-2">{i.due_date}</td>
                  <td className="p-2">{i.customer_name}</td>
                  <td className="p-2">{i.order_number}</td>
                  <td className="p-2 text-right">{formatRupiah(i.dpp)}</td>
                  <td className="p-2 text-right">{formatRupiah(i.ppn)}</td>
                  <td className="p-2 text-right font-medium">{formatRupiah(i.total)}</td>
                  <td className="p-2 text-right">{i.outstanding > 0 ? formatRupiah(i.outstanding) : <span className="text-green-700">Paid</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={page} total={data.total} setPage={setPage} />}
    </>
  );
}

function InvoiceDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const company = useCompany();
  const d = useQuery({ queryKey: ['sales-invoices', 'detail', id], queryFn: () => api<SalesInvoiceDetail>(`/sales-invoices/${id}`) });
  const x = d.data;
  const terms = (t: string) => PAYMENT_TERMS_LABELS[t as PaymentTerms] ?? t;
  return (
    <Modal title={x ? x.number : 'Sales invoice'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the invoice: {d.error.message}</p>}
      {x && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {x.customer_name} · against {x.order_number} · {x.invoice_date}, due {x.due_date} ({terms(x.payment_terms)}) · by {x.created_by_name}{x.note ? ` · ${x.note}` : ''}
          </p>
          <LinesTable lines={x.lines} />
          <Totals o={x} />
          <div className="mt-4 flex justify-end text-sm"><button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print Faktur</button></div>
          {createPortal(
            <div className="print-root">
              <h1 style={{ fontSize: '16pt', fontWeight: 600 }}>{company.data?.name}</h1>
              <p style={{ whiteSpace: 'pre-line' }}>{company.data?.address}{company.data?.npwp ? `\nNPWP ${company.data.npwp}` : ''}</p>
              <h2 style={{ fontSize: '14pt', fontWeight: 600, margin: '6mm 0 2mm' }}>Faktur {x.number}</h2>
              <p>Date {x.invoice_date} · Due {x.due_date} ({terms(x.payment_terms)}) · Sales order {x.order_number}</p>
              <p style={{ marginBottom: '4mm' }}>Bill to: {x.customer_name}{x.customer_address ? `, ${x.customer_address}` : ''}{x.customer_npwp ? ` · NPWP ${x.customer_npwp}` : ''}</p>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <thead><tr>{['SKU', 'Product', 'Qty', 'Price', 'Amount'].map((h, n) => <th key={h} style={{ ...cell, textAlign: n > 1 ? 'right' : 'left' }}>{h}</th>)}</tr></thead>
                <tbody>
                  {x.lines.map((l) => (
                    <tr key={l.product_id}>
                      <td style={cell}>{l.sku}</td><td style={cell}>{l.name}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{qty(l.qty_milli)} {l.base_unit}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.unit_price)}</td>
                      <td style={{ ...cell, textAlign: 'right' }}>{formatRupiah(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <table style={{ marginLeft: 'auto', marginTop: '4mm', fontSize: '10pt' }}>
                <tbody>
                  <tr><td style={{ padding: '1mm 4mm' }}>DPP</td><td style={{ textAlign: 'right' }}>{formatRupiah(x.dpp)}</td></tr>
                  <tr><td style={{ padding: '1mm 4mm' }}>PPN {x.ppn_rate_bp / 100}%</td><td style={{ textAlign: 'right' }}>{formatRupiah(x.ppn)}</td></tr>
                  <tr><td style={{ padding: '1mm 4mm', fontWeight: 600 }}>Total</td><td style={{ textAlign: 'right', fontWeight: 600 }}>{formatRupiah(x.total)}</td></tr>
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20mm' }}>
                <span>Issued by: ____________________</span><span>Received by: ____________________</span>
              </div>
            </div>,
            document.body,
          )}
        </>
      )}
    </Modal>
  );
}

function InvoiceForm({ orderId, onClose, onDone }: { orderId: number; onClose: () => void; onDone: (id: number) => void }) {
  const qc = useQueryClient();
  const open = useQuery({ queryKey: ['sales-invoices', 'invoiceable', orderId], queryFn: () => api<InvoiceableOrder>(`/sales-invoices/invoiceable/${orderId}`) });
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const o = open.data;
  const create = useMutation({
    mutationFn: (body: object) => api<SalesInvoiceDetail>('/sales-invoices', { method: 'POST', body }),
    onSuccess: (d) => { qc.invalidateQueries(); onDone(d.id); },
    onError: (e) => setError(e.message),
  });
  const submit = () => {
    if (!o) return;
    const lines: { product_id: number; qty_milli: number }[] = [];
    for (const l of o.lines) {
      const raw = (qtys[l.product_id] ?? '').trim().replace(',', '.');
      if (raw === '') continue;
      const milli = Math.round(Number(raw) * 1000);
      if (!Number.isFinite(milli) || milli <= 0) return setError(`${l.name}: enter a quantity above zero`);
      if (milli > l.invoiceable_milli) return setError(`${l.name}: only ${qty(l.invoiceable_milli)} delivered and not yet invoiced`);
      lines.push({ product_id: l.product_id, qty_milli: milli });
    }
    if (lines.length === 0) return setError('Enter a quantity for at least one product');
    setError(null);
    create.mutate({ order_id: orderId, invoice_date: date, note, lines });
  };
  return (
    <Modal title={o ? `Invoice ${o.order_number}` : 'Invoice delivered goods'} wide onClose={onClose}>
      {open.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {open.isError && <p role="alert" className="text-sm text-red-700">Could not load the order: {open.error.message}</p>}
      {o && (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <p className="mb-3 text-sm text-slate-600">{o.customer_name} · {PAYMENT_TERMS_LABELS[o.payment_terms as PaymentTerms] ?? o.payment_terms} · prices from the order, PPN {o.ppn_rate_bp / 100}%. Only delivered goods can be invoiced.</p>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">Invoice date<input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} required /></label>
            <label className="text-sm">Note<input className={field} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Delivered</th><th className="text-right">Invoiced</th><th className="text-right">To invoice</th><th className="text-right">Price</th><th className="w-32 text-right">Invoice now</th></tr></thead>
              <tbody className="divide-y">
                {o.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.delivered_milli)}</td>
                    <td className="text-right">{qty(l.invoiced_milli)}</td>
                    <td className="text-right">{qty(l.invoiceable_milli)} {l.base_unit}</td>
                    <td className="text-right">{formatRupiah(l.unit_price)}</td>
                    <td className="text-right">
                      <input aria-label={`Invoice ${l.name}`} inputMode="decimal" disabled={l.invoiceable_milli === 0} className={`${field} text-right`} value={qtys[l.product_id] ?? ''}
                        onChange={(e) => setQtys({ ...qtys, [l.product_id]: e.target.value })} />
                      {l.invoiceable_milli > 0 && <button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setQtys({ ...qtys, [l.product_id]: String(l.invoiceable_milli / 1000) })}>All</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex justify-end gap-2 text-sm">
            <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
            <button type="submit" disabled={create.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post invoice</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
