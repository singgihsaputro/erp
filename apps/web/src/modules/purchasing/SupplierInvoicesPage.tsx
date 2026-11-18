import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  formatRupiah,
  type GrDetail,
  type Page,
  type SiDetail,
  type SiExtractionOption,
  type SiPayableSummary,
  type SiPrefill,
  type SiReceiptOption,
  type SiSummary,
} from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const STATUS = { open: ['Open', 'bg-blue-100 text-blue-800'], overdue: ['Overdue', 'bg-red-100 text-red-800'], paid: ['Paid', 'bg-green-100 text-green-800'] } as const;
const FILTERS = [['all', 'All'], ['open', 'Open'], ['overdue', 'Overdue'], ['paid', 'Paid']] as const;

function Badge({ status }: { status: SiSummary['status'] }) {
  return <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS[status][1]}`}>{STATUS[status][0]}</span>;
}

export default function SupplierInvoicesPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>('all');
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useQuery({
    queryKey: ['supplier-invoices', status, page],
    queryFn: () => api<Page<SiSummary>>(`/supplier-invoices?status=${status}&page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const payable = useQuery({ queryKey: ['supplier-invoices', 'payable'], queryFn: () => api<SiPayableSummary>('/supplier-invoices/payable') });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Supplier invoices</h1>
        <select aria-label="Status" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
          {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setAdding(true)}>Record invoice</button>
      </div>
      <p className="mb-4 text-sm text-slate-500">Record what a supplier billed for a goods receipt, by hand or from a confirmed PDF in the invoice inbox. Each invoice is checked against what was received and the order price. What is unpaid is your accounts payable. A recorded invoice cannot be edited.</p>
      {payable.data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded border bg-white p-3"><div className="text-xs uppercase text-slate-500">Accounts payable</div><div className="text-lg font-semibold">{formatRupiah(payable.data.outstanding)}</div><div className="text-xs text-slate-500">{payable.data.open_count} unpaid invoices</div></div>
          <div className="rounded border bg-white p-3"><div className="text-xs uppercase text-slate-500">Overdue</div><div className={`text-lg font-semibold ${payable.data.overdue_count ? 'text-red-700' : ''}`}>{formatRupiah(payable.data.overdue_outstanding)}</div><div className="text-xs text-slate-500">{payable.data.overdue_count} overdue invoices</div></div>
        </div>
      )}
      {list.isPending && <p className="text-sm text-slate-500">Loading supplier invoices…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load supplier invoices: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No supplier invoices {status === 'all' ? 'recorded yet' : 'in this status'}.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Supplier</th><th className="p-2">Supplier invoice</th><th className="p-2">Receipt</th><th className="p-2">Due</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Outstanding</th><th className="p-2">Status</th><th className="p-2">Match</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(r.id)}>{r.number}</button></td>
                  <td className="p-2">{r.supplier_name}</td>
                  <td className="p-2">{r.supplier_invoice_no}<div className="text-xs text-slate-500">{r.invoice_date}</div></td>
                  <td className="p-2">{r.receipt_number}</td>
                  <td className="p-2">{r.due_date}</td>
                  <td className="p-2 text-right">{formatRupiah(r.total)}</td>
                  <td className="p-2 text-right">{formatRupiah(r.outstanding)}</td>
                  <td className="p-2"><Badge status={r.status} /></td>
                  <td className="p-2">{r.warning_count ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">{r.warning_count} warning{r.warning_count > 1 ? 's' : ''}</span> : <span className="text-xs text-green-700">Matches</span>}</td>
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
      {adding && <RecordDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setOpen(id); }} />}
    </section>
  );
}

function DetailDialog({ id, onClose }: { id: number; onClose: () => void }) {
  const d = useQuery({ queryKey: ['supplier-invoices', 'detail', id], queryFn: () => api<SiDetail>(`/supplier-invoices/${id}`) });
  const r = d.data;
  return (
    <Modal title={r ? r.number : 'Supplier invoice'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the invoice: {d.error.message}</p>}
      {r && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {r.supplier_name} · invoice {r.supplier_invoice_no} dated {r.invoice_date}, due {r.due_date} · against {r.receipt_number} ({r.order_number}) · by {r.created_by_name}
            {r.extraction_id ? ' · from the invoice inbox' : ''}{r.note ? ` · ${r.note}` : ''}
          </p>
          {r.warnings.length === 0 ? (
            <p className="mb-3 rounded bg-green-50 px-3 py-2 text-sm text-green-800">Three-way match: the invoice agrees with the goods receipt and the order price.</p>
          ) : (
            <div role="alert" className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <div className="font-medium">Three-way match warnings</div>
              <ul className="list-disc pl-5">{r.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Invoiced</th><th className="text-right">Received</th><th className="text-right">Unit price</th><th className="text-right">Order price</th><th className="text-right">Amount</th></tr></thead>
              <tbody className="divide-y">
                {r.lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                    <td className={`text-right ${l.qty_milli !== l.received_milli ? 'font-medium text-amber-700' : ''}`}>{qty(l.qty_milli)} {l.base_unit}</td>
                    <td className="text-right">{l.received_milli === null ? '—' : qty(l.received_milli)}</td>
                    <td className={`text-right ${l.unit_cost !== l.receipt_unit_cost ? 'font-medium text-amber-700' : ''}`}>{formatRupiah(l.unit_cost)}</td>
                    <td className="text-right">{l.receipt_unit_cost === null ? '—' : formatRupiah(l.receipt_unit_cost)}</td>
                    <td className="text-right">{formatRupiah(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-3 grid w-full max-w-xs grid-cols-2 gap-1 text-sm">
            <dt>DPP</dt><dd className="text-right">{formatRupiah(r.dpp)}</dd>
            <dt>PPN {r.ppn_rate_bp / 100}%</dt><dd className="text-right">{formatRupiah(r.ppn)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{formatRupiah(r.total)}</dd>
            <dt>Paid</dt><dd className="text-right">{formatRupiah(r.amount_paid)}</dd>
            <dt className="font-semibold">Outstanding</dt><dd className="text-right font-semibold">{formatRupiah(r.outstanding)}</dd>
          </dl>
        </>
      )}
    </Modal>
  );
}

function RecordDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const receipts = useQuery({ queryKey: ['supplier-invoices', 'receipts'], queryFn: () => api<SiReceiptOption[]>('/supplier-invoices/receipts') });
  const inbox = useQuery({ queryKey: ['supplier-invoices', 'extractions'], queryFn: () => api<SiExtractionOption[]>('/supplier-invoices/extractions') });
  const [receiptId, setReceiptId] = useState('');
  const [extractionId, setExtractionId] = useState<number | null>(null);
  const [no, setNo] = useState('');
  const [date, setDate] = useState(today());
  const [due, setDue] = useState('');
  const [stated, setStated] = useState('');
  const [note, setNote] = useState('');
  const [edits, setEdits] = useState<Record<number, { qty?: string; price?: string }>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const receipt = useQuery({
    queryKey: ['goods-receipts', 'detail', receiptId, 'invoice'],
    queryFn: () => api<GrDetail>(`/goods-receipts/${receiptId}`),
    enabled: receiptId !== '',
  });
  const lines = receipt.data?.lines ?? [];
  const qtyOf = (l: GrDetail['lines'][number]) => edits[l.product_id]?.qty ?? String(l.qty_milli / 1000);
  const priceOf = (l: GrDetail['lines'][number]) => edits[l.product_id]?.price ?? String(l.unit_cost);
  const setEdit = (pid: number, patch: { qty?: string; price?: string }) => setEdits({ ...edits, [pid]: { ...edits[pid], ...patch } });

  const fromInbox = async (value: string) => {
    setError(null);
    setNotice(null);
    if (value === '') { setExtractionId(null); return; }
    try {
      const p = await api<SiPrefill>(`/supplier-invoices/prefill/${value}`);
      setExtractionId(p.extraction_id);
      setNo(p.supplier_invoice_no);
      if (p.invoice_date) setDate(p.invoice_date);
      setDue(p.due_date ?? '');
      setStated(p.stated_total === null ? '' : String(p.stated_total));
      setReceiptId(p.receipt_id ? String(p.receipt_id) : '');
      const next: Record<number, { qty?: string; price?: string }> = {};
      for (const l of p.lines) next[l.product_id] = { qty: String(l.qty_milli / 1000), price: String(l.unit_cost) };
      setEdits(next);
      setNotice(
        (p.receipt_id ? 'Filled in from the PDF. ' : p.supplier_id ? 'No open goods receipt fits this PDF; choose one. ' : 'The supplier on the PDF is not in Suppliers; choose the receipt. ') +
          (p.skipped_lines ? `${p.skipped_lines} PDF line(s) without a product were left out.` : ''),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = useMutation({
    mutationFn: () =>
      api<SiDetail>('/supplier-invoices', {
        method: 'POST',
        body: {
          receipt_id: Number(receiptId),
          supplier_invoice_no: no,
          invoice_date: date,
          due_date: due || null,
          note,
          stated_total: stated === '' ? null : Math.round(Number(stated)),
          extraction_id: extractionId,
          lines: lines
            .map((l) => ({ product_id: l.product_id, qty_milli: Math.round(Number(qtyOf(l).replace(',', '.') || 0) * 1000), unit_cost: Math.round(Number(priceOf(l) || 0)) }))
            .filter((l) => l.qty_milli > 0),
        },
      }),
    onSuccess: (si) => {
      qc.invalidateQueries({ queryKey: ['supplier-invoices'] });
      onSaved(si.id);
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Record supplier invoice" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        {(receipts.isPending || inbox.isPending) && <p className="text-slate-500">Loading…</p>}
        {receipts.isError && <p role="alert" className="text-red-700">Could not load goods receipts: {receipts.error.message}</p>}
        {receipts.data && receipts.data.length === 0 && <p className="rounded border border-dashed p-3 text-slate-500">Every goods receipt already has an invoice.</p>}
        {inbox.data && inbox.data.length > 0 && (
          <label>Start from a confirmed PDF in the invoice inbox (optional)
            <select className={field} value={extractionId ?? ''} onChange={(e) => fromInbox(e.target.value)}>
              <option value="">Enter by hand</option>
              {inbox.data.map((x) => <option key={x.id} value={x.id}>{x.supplier_name ?? 'Unknown supplier'} · {x.invoice_number ?? x.file_name}{x.total !== null ? ` · ${formatRupiah(x.total)}` : ''}</option>)}
            </select>
          </label>
        )}
        {notice && <p className="rounded bg-blue-50 px-3 py-2 text-blue-800">{notice}</p>}
        <label>Goods receipt
          <select className={field} value={receiptId} required onChange={(e) => { setReceiptId(e.target.value); setEdits({}); setError(null); }}>
            <option value="">Choose a receipt to invoice…</option>
            {receipts.data?.map((r) => <option key={r.id} value={r.id}>{r.number} · {r.supplier_name} · {r.order_number} · {formatRupiah(r.value)}</option>)}
          </select>
        </label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label>Supplier invoice no.
            <input className={field} required maxLength={60} value={no} onChange={(e) => setNo(e.target.value)} />
          </label>
          <label>Total printed on the invoice, incl. PPN (optional)
            <input className={field} inputMode="numeric" pattern="[0-9]*" value={stated} onChange={(e) => setStated(e.target.value)} />
          </label>
          <label>Invoice date
            <input type="date" className={field} value={date} required onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>Due date (blank = from the supplier&apos;s payment terms)
            <input type="date" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {receipt.isPending && receiptId !== '' && <p className="text-slate-500">Loading receipt…</p>}
        {receipt.isError && <p role="alert" className="text-red-700">Could not load the receipt: {receipt.error.message}</p>}
        {receipt.data && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-1">Product</th><th className="text-right">Received</th><th className="w-28 text-right">Qty invoiced</th><th className="w-32 text-right">Unit price excl. PPN</th></tr></thead>
              <tbody className="divide-y">
                {lines.map((l) => (
                  <tr key={l.product_id}>
                    <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku} · order price {formatRupiah(l.unit_cost)} / {l.base_unit}</div></td>
                    <td className="text-right">{qty(l.qty_milli)}</td>
                    <td className="text-right"><input aria-label={`Qty invoiced ${l.name}`} className={`${field} text-right`} inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,3})?" value={qtyOf(l)} onChange={(e) => setEdit(l.product_id, { qty: e.target.value })} /></td>
                    <td className="text-right"><input aria-label={`Unit price ${l.name}`} className={`${field} text-right`} inputMode="numeric" pattern="[0-9]+" value={priceOf(l)} onChange={(e) => setEdit(l.product_id, { price: e.target.value })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-slate-500">Enter 0 for a product the supplier did not bill. Differences from the receipt or the order price are allowed and shown as warnings on the invoice.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending || !receipt.data} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Record invoice</button>
        </div>
      </form>
    </Modal>
  );
}
