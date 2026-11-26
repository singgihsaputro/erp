import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type Page, type SrDetail, type SrInvoiceOption, type SrSummary } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

export default function SalesReturnsPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [returning, setReturning] = useState(false);
  const list = useQuery({
    queryKey: ['sales-returns', page],
    queryFn: () => api<Page<SrSummary>>(`/sales-returns?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sales returns</h1>
        <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setReturning(true)}>Receive returned goods</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Take goods of a Faktur back from the customer. Stock comes back into the warehouse and a credit note reduces what the customer owes (or is refunded if the Faktur was already paid). A posted return cannot be edited.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading purchase returns…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load purchase returns: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No goods returned by customers yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Credit note</th><th className="p-2">Date</th><th className="p-2">Customer</th><th className="p-2">Faktur</th><th className="p-2">Reason</th><th className="p-2 text-right">Total incl. PPN</th><th className="p-2 text-right">Credited to Faktur</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button></td>
                  <td className="p-2">{r.credit_note_number}</td>
                  <td className="p-2">{r.return_date}</td>
                  <td className="p-2">{r.customer_name}</td>
                  <td className="p-2">{r.invoice_number}</td>
                  <td className="p-2">{r.reason}</td>
                  <td className="p-2 text-right">{formatRupiah(r.total)}</td>
                  <td className="p-2 text-right">{formatRupiah(r.credit_applied)}</td>
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
      {returning && <ReturnDialog onClose={() => setReturning(false)} />}
    </section>
  );
}

function DetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useQuery({ queryKey: ['sales-returns', 'detail', id], queryFn: () => api<SrDetail>(`/sales-returns/${id}`) });
  const r = d.data;
  return (
    <Modal title={r ? r.number : 'Sales return'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the return: {d.error.message}</p>}
      {r && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {r.customer_name} → {r.warehouse_name} · Faktur {r.invoice_number} · credit note {r.credit_note_number} · {r.return_date} · by {r.created_by_name}
            · {r.reason}{r.note ? ` · ${r.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty returned</th><th className="text-right">Unit price</th><th className="text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {r.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className="text-right">{qty(l.qty_milli)} {l.base_unit}</td>
                    <td className="text-right">{formatRupiah(l.unit_price)}</td>
                    <td className="text-right">{formatRupiah(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="mt-3 ml-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt>DPP</dt><dd className="text-right">{formatRupiah(r.dpp)}</dd>
            <dt>PPN {r.ppn_rate_bp / 100}%</dt><dd className="text-right">{formatRupiah(r.ppn)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatRupiah(r.total)}</dd>
            <dt>Credited to Faktur</dt><dd className="text-right">{formatRupiah(r.credit_applied)}</dd>
            {r.refund_due > 0 && <><dt>Refund owed to customer</dt><dd className="text-right">{formatRupiah(r.refund_due)}</dd></>}
          </dl>
        </>
      )}
    </Modal>
  );
}

function ReturnDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const invoices = useQuery({ queryKey: ['sales-returns', 'invoices'], queryFn: () => api<SrInvoiceOption[]>('/sales-returns/invoices') });
  const [invoiceId, setInvoiceId] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const invoice = invoices.data?.find((r) => String(r.id) === invoiceId);
  const value = (productId: number) => Number((amounts[productId] ?? '0').replace(',', '.') || 0);
  const lines = (invoice?.lines ?? []).map((l) => ({ product_id: l.product_id, qty_milli: Math.round(value(l.product_id) * 1000) })).filter((l) => l.qty_milli > 0);
  const save = useMutation({
    mutationFn: () => api<SrDetail>('/sales-returns', { method: 'POST', body: { invoice_id: Number(invoiceId), return_date: date, reason, note, lines } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-returns'] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['customer-payments'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Receive returned goods" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); if (lines.length === 0) { setError('Enter a quantity for at least one line'); return; } save.mutate(); }}>
        {invoices.isPending && <p className="text-slate-500">Loading invoices…</p>}
        {invoices.isError && <p role="alert" className="text-red-700">Could not load invoices: {invoices.error.message}</p>}
        {invoices.data && invoices.data.length === 0 && <p className="rounded border border-dashed p-3 text-slate-500">No Faktur has anything left to take back.</p>}
        <label>Faktur
          <select className={field} value={invoiceId} required onChange={(e) => { setInvoiceId(e.target.value); setAmounts({}); setError(null); }}>
            <option value="">Choose a Faktur…</option>
            {invoices.data?.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.customer_name} · {r.invoice_date}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Return date
            <input type="date" className={field} value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>Reason
            <input className={field} maxLength={120} value={reason} required placeholder="Damaged, expired, wrong item…" onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {invoice && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Invoiced</th><th className="text-right">Returned</th><th className="text-right">Can return</th><th className="w-28 text-right">Take back</th></tr></thead>
              <tbody className="divide-y">
                {invoice.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku} · {formatRupiah(l.unit_price)} / {l.base_unit}</div></td>
                    <td className="text-right">{qty(l.invoiced_milli)}</td>
                    <td className="text-right">{qty(l.returned_milli)}</td>
                    <td className="text-right">{qty(l.returnable_milli)}</td>
                    <td className="text-right">
                      <input aria-label={`Take back ${l.name}`} className={`${field} text-right`} inputMode="decimal" disabled={l.returnable_milli <= 0} placeholder="0"
                        value={amounts[l.product_id] ?? ''} pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => setAmounts({ ...amounts, [l.product_id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">You cannot take back more than was invoiced and not yet returned. The goods go back into the warehouse that delivered them.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending || !invoice} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post return and credit note</button>
        </div>
      </form>
    </Modal>
  );
}
