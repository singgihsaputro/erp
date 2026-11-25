import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PAYMENT_METHODS,
  formatRupiah,
  type CpDetail,
  type CpOpenInvoice,
  type CpSummary,
  type CreditStatus,
  type Customer,
  type Page,
  type ReceivableBucket,
  type ReceivablesReport,
} from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const AGING_BUCKETS: readonly (readonly [ReceivableBucket, string])[] = [
  ['current', 'Not yet due'], ['d1_30', '1–30 days'], ['d31_60', '31–60 days'], ['d61_90', '61–90 days'], ['d90_plus', 'Over 90 days'],
];
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const methodLabel = (m: string) => PAYMENT_METHODS.find((x) => x[0] === m)?.[1] ?? m;

export default function CustomerPaymentsPage() {
  const [tab, setTab] = useState<'payments' | 'aging'>('aging');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [paying, setPaying] = useState(false);
  const list = useQuery({
    queryKey: ['customer-payments', 'list', page],
    queryFn: () => api<Page<CpSummary>>(`/customer-payments?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const aging = useQuery({ queryKey: ['customer-payments', 'aging'], queryFn: () => api<ReceivablesReport>('/customer-payments/aging') });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const tabBtn = (t: typeof tab, label: string) => (
    <button className={`rounded px-3 py-1.5 text-sm ${tab === t ? 'bg-slate-900 text-white' : 'border'}`} onClick={() => setTab(t)}>{label}</button>
  );
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Customer payments</h1>
        {tabBtn('aging', 'Receivables aging')}
        {tabBtn('payments', 'Payments')}
        <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setPaying(true)}>Receive payment</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Record money received against one or several Faktur of a customer, in full or in part. Aging shows what each customer owes by how many days past due, against their credit limit. New sales orders are refused past the credit limit. A posted payment cannot be edited.</p>

      {tab === 'aging' && (
        <>
          {aging.isPending && <p className="text-sm text-slate-500">Loading payables…</p>}
          {aging.isError && <p role="alert" className="text-sm text-red-700">Could not load aging: {aging.error.message} <button className="underline" onClick={() => aging.refetch()}>Retry</button></p>}
          {aging.data && aging.data.rows.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No customer owes anything.</p>}
          {aging.data && aging.data.rows.length > 0 && (
            <div className="overflow-x-auto rounded border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="p-2">Customer</th><th className="p-2 text-right">Invoices</th>{AGING_BUCKETS.map(([k, l]) => <th key={k} className="p-2 text-right">{l}</th>)}<th className="p-2 text-right">Total owed</th><th className="p-2 text-right">Credit used</th></tr>
                </thead>
                <tbody className="divide-y">
                  {aging.data.rows.map((r) => (
                    <tr key={r.customer_id}>
                      <td className="p-2">{r.customer_name}{r.over_limit && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">Over limit</span>}</td>
                      <td className="p-2 text-right">{r.invoice_count}</td>
                      {AGING_BUCKETS.map(([k]) => <td key={k} className={`p-2 text-right ${k !== 'current' && r.buckets[k] ? 'font-medium text-red-700' : ''}`}>{r.buckets[k] ? formatRupiah(r.buckets[k]) : '—'}</td>)}
                      <td className="p-2 text-right font-semibold">{formatRupiah(r.total)}</td>
                      <td className="p-2 text-right text-slate-600">{r.credit_limit ? `${formatRupiah(r.exposure)} of ${formatRupiah(r.credit_limit)}` : 'No limit'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 font-semibold">
                  <tr><td className="p-2" colSpan={2}>Total as of {aging.data.as_of}</td>{AGING_BUCKETS.map(([k]) => <td key={k} className="p-2 text-right">{formatRupiah(aging.data.totals[k])}</td>)}<td className="p-2 text-right">{formatRupiah(aging.data.totals.total)}</td><td /></tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'payments' && (
        <>
          {list.isPending && <p className="text-sm text-slate-500">Loading payments…</p>}
          {list.isError && <p role="alert" className="text-sm text-red-700">Could not load payments: {list.error.message} <button className="underline" onClick={() => list.refetch()}>Retry</button></p>}
          {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No payments yet.</p>}
          {data && data.items.length > 0 && (
            <div className="overflow-x-auto rounded border bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Method</th><th className="p-2">Reference</th><th className="p-2 text-right">Invoices</th><th className="p-2 text-right">Amount</th></tr></thead>
                <tbody className="divide-y">
                  {data.items.map((p) => (
                    <tr key={p.id}>
                      <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(p.id)}>{p.number}</button></td>
                      <td className="p-2">{p.payment_date}</td><td className="p-2">{p.customer_name}</td><td className="p-2">{methodLabel(p.method)}</td>
                      <td className="p-2">{p.reference || '—'}</td><td className="p-2 text-right">{p.invoice_count}</td><td className="p-2 text-right">{formatRupiah(p.total)}</td>
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
        </>
      )}
      {open !== null && <DetailDialog id={open} onClose={() => setOpen(null)} />}
      {paying && <PayDialog onClose={() => setPaying(false)} onSaved={(id) => { setPaying(false); setTab('payments'); setOpen(id); }} />}
    </section>
  );
}

function DetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useQuery({ queryKey: ['customer-payments', 'detail', id], queryFn: () => api<CpDetail>(`/customer-payments/${id}`) });
  const p = d.data;
  return (
    <Modal title={p ? p.number : 'Payment'} onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the payment: {d.error.message}</p>}
      {p && (
        <>
          <p className="mb-2 text-sm text-slate-600">{p.customer_name} · {p.payment_date} · {methodLabel(p.method)}{p.reference ? ` ${p.reference}` : ''} · by {p.created_by_name}{p.note ? ` · ${p.note}` : ''}</p>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Invoice</th><th></th><th className="text-right">Paid</th></tr></thead>
            <tbody className="divide-y">{p.allocations.map((a) => <tr key={a.invoice_id}><td className="py-1.5">{a.invoice_number}</td><td></td><td className="text-right">{formatRupiah(a.amount)}</td></tr>)}</tbody>
            <tfoot><tr className="font-semibold"><td className="py-1.5" colSpan={2}>Total</td><td className="text-right">{formatRupiah(p.total)}</td></tr></tfoot>
          </table>
        </>
      )}
    </Modal>
  );
}

function PayDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const customers = useQuery({ queryKey: ['customers', 'active'], queryFn: () => api<Customer[]>('/customers') });
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = useQuery({
    queryKey: ['customer-payments', 'open', customerId],
    queryFn: () => api<CpOpenInvoice[]>(`/customer-payments/open-invoices?customer_id=${customerId}`),
    enabled: customerId !== '',
  });
  const credit = useQuery({
    queryKey: ['customer-payments', 'credit', customerId],
    queryFn: () => api<CreditStatus>(`/customer-payments/credit/${customerId}`),
    enabled: customerId !== '',
  });
  const items = open.data ?? [];
  const chosen = items.map((i) => ({ invoice_id: i.id, amount: Math.round(Number(amounts[i.id] || 0)) })).filter((a) => a.amount > 0);
  const total = chosen.reduce((s, a) => s + a.amount, 0);
  const save = useMutation({
    mutationFn: () => api<CpDetail>('/customer-payments', { method: 'POST', body: { customer_id: Number(customerId), payment_date: date, method, reference, note, allocations: chosen } }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['customer-payments'] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      onSaved(p.id);
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Receive payment" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {customers.isError && <p role="alert" className="text-red-700">Could not load customers: {customers.error.message}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Customer
            <select className={field} required value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAmounts({}); setError(null); }}>
              <option value="">Choose a customer…</option>
              {customers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label>Payment date<input type="date" className={field} required value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <label>Method
            <select className={field} value={method} onChange={(e) => setMethod(e.target.value)}>{PAYMENT_METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label>Reference (transfer or giro number)<input className={field} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
        </div>
        <label>Note<input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {credit.data && credit.data.credit_limit > 0 && (
          <p className={`rounded px-3 py-2 ${credit.data.available! < 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-600'}`}>
            Credit limit {formatRupiah(credit.data.credit_limit)}: invoices {formatRupiah(credit.data.receivables)} + open orders {formatRupiah(credit.data.open_orders)} ·
            {' '}{credit.data.available! < 0 ? `over by ${formatRupiah(-credit.data.available!)}` : `${formatRupiah(credit.data.available!)} still available`}
          </p>
        )}
        {open.isPending && customerId !== '' && <p className="text-slate-500">Loading invoices…</p>}
        {open.isError && <p role="alert" className="text-red-700">Could not load invoices: {open.error.message}</p>}
        {open.data && items.length === 0 && <p className="rounded border border-dashed p-3 text-slate-500">This customer has no unpaid invoices.</p>}
        {items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Invoice</th><th>Due</th><th className="text-right">Outstanding</th><th className="w-36 text-right">Receive</th></tr></thead>
              <tbody className="divide-y">
                {items.map((i) => (
                  <tr key={i.id}>
                    <td className="py-1.5">{i.number}</td>
                    <td>{i.due_date}{i.days_overdue > 0 && <div className="text-xs text-red-700">{i.days_overdue} days overdue</div>}</td>
                    <td className="text-right">{formatRupiah(i.outstanding)}<div><button type="button" className="text-xs text-blue-700 hover:underline" onClick={() => setAmounts({ ...amounts, [i.id]: String(i.outstanding) })}>Receive in full</button></div></td>
                    <td className="text-right"><input aria-label={`Receive ${i.number}`} className={`${field} text-right`} inputMode="numeric" pattern="[0-9]*" value={amounts[i.id] ?? ''} onChange={(e) => setAmounts({ ...amounts, [i.id]: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td className="py-1.5" colSpan={3}>Total received</td><td className="text-right">{formatRupiah(total)}</td></tr></tfoot>
            </table>
          </div>
        )}
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending || total <= 0} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post payment</button>
        </div>
      </form>
    </Modal>
  );
}
