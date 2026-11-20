import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type Page, type PrDetail, type PrReceiptOption, type PrSummary } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

export default function PurchaseReturnsPage() {
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [returning, setReturning] = useState(false);
  const list = useQuery({
    queryKey: ['purchase-returns', page],
    queryFn: () => api<Page<PrSummary>>(`/purchase-returns?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Purchase returns</h1>
        <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setReturning(true)}>Return goods</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Send goods of a receipt back to the supplier. Stock goes out of the warehouse and, if the receipt has a supplier invoice, the invoice is credited so you owe less. A posted return cannot be edited.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading purchase returns…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load purchase returns: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No goods returned yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Supplier</th><th className="p-2">Receipt</th><th className="p-2">Reason</th><th className="p-2 text-right">Total incl. PPN</th><th className="p-2 text-right">Credited to invoice</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button></td>
                  <td className="p-2">{r.return_date}</td>
                  <td className="p-2">{r.supplier_name}</td>
                  <td className="p-2">{r.receipt_number}</td>
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
  const d = useQuery({ queryKey: ['purchase-returns', 'detail', id], queryFn: () => api<PrDetail>(`/purchase-returns/${id}`) });
  const r = d.data;
  return (
    <Modal title={r ? r.number : 'Purchase return'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the return: {d.error.message}</p>}
      {r && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {r.supplier_name} ← {r.warehouse_name} · receipt {r.receipt_number}{r.invoice_number ? ` · invoice ${r.invoice_number}` : ' · not invoiced yet'} · {r.return_date} · by {r.created_by_name}
            · {r.reason}{r.note ? ` · ${r.note}` : ''}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Qty returned</th><th className="text-right">Unit cost</th><th className="text-right">Amount</th></tr></thead>
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
          <dl className="mt-3 ml-auto grid max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt>DPP</dt><dd className="text-right">{formatRupiah(r.dpp)}</dd>
            <dt>PPN {r.ppn_rate_bp / 100}%</dt><dd className="text-right">{formatRupiah(r.ppn)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatRupiah(r.total)}</dd>
            <dt>Credited to invoice</dt><dd className="text-right">{formatRupiah(r.credit_applied)}</dd>
            {r.refund_due > 0 && <><dt>Supplier owes back</dt><dd className="text-right">{formatRupiah(r.refund_due)}</dd></>}
          </dl>
        </>
      )}
    </Modal>
  );
}

function ReturnDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const receipts = useQuery({ queryKey: ['purchase-returns', 'receipts'], queryFn: () => api<PrReceiptOption[]>('/purchase-returns/receipts') });
  const [receiptId, setReceiptId] = useState('');
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const receipt = receipts.data?.find((r) => String(r.id) === receiptId);
  const value = (productId: number) => Number((amounts[productId] ?? '0').replace(',', '.') || 0);
  const lines = (receipt?.lines ?? []).map((l) => ({ product_id: l.product_id, qty_milli: Math.round(value(l.product_id) * 1000) })).filter((l) => l.qty_milli > 0);
  const save = useMutation({
    mutationFn: () => api<PrDetail>('/purchase-returns', { method: 'POST', body: { receipt_id: Number(receiptId), return_date: date, reason, note, lines } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] });
      qc.invalidateQueries({ queryKey: ['supplier-payments'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Return goods" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); if (lines.length === 0) { setError('Enter a quantity for at least one line'); return; } save.mutate(); }}>
        {receipts.isPending && <p className="text-slate-500">Loading goods receipts…</p>}
        {receipts.isError && <p role="alert" className="text-red-700">Could not load goods receipts: {receipts.error.message}</p>}
        {receipts.data && receipts.data.length === 0 && <p className="rounded border border-dashed p-3 text-slate-500">No goods receipt has anything left to return.</p>}
        <label>Goods receipt
          <select className={field} value={receiptId} required onChange={(e) => { setReceiptId(e.target.value); setAmounts({}); setError(null); }}>
            <option value="">Choose a receipt…</option>
            {receipts.data?.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.supplier_name} · {r.receipt_date}{r.invoice_number ? ` · ${r.invoice_number}` : ''}</option>)}
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
        {receipt && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Received</th><th className="text-right">Returned</th><th className="text-right">Can return</th><th className="w-28 text-right">Return now</th></tr></thead>
              <tbody className="divide-y">
                {receipt.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku} · {formatRupiah(l.unit_cost)} / {l.base_unit}</div></td>
                    <td className="text-right">{qty(l.received_milli)}</td>
                    <td className="text-right">{qty(l.returned_milli)}</td>
                    <td className="text-right">{qty(l.returnable_milli)}</td>
                    <td className="text-right">
                      <input aria-label={`Return ${l.name}`} className={`${field} text-right`} inputMode="decimal" disabled={l.returnable_milli <= 0} placeholder="0"
                        value={amounts[l.product_id] ?? ''} pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => setAmounts({ ...amounts, [l.product_id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">You cannot return more than was received, or more than is in stock in the receiving warehouse.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending || !receipt} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post return</button>
        </div>
      </form>
    </Modal>
  );
}
