import { useState } from 'react';
import { createPortal } from 'react-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COUNT_STATUSES, formatRupiah, type CountDetail, type CountStatus, type CountSummary, type Page, type Warehouse } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from './StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const signed = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3, signDisplay: 'exceptZero' }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const statusLabel = (s: string) => COUNT_STATUSES.find((x) => x[0] === s)?.[1] ?? s;
const badge: Record<string, string> = { draft: 'bg-amber-100 text-amber-800', posted: 'bg-green-100 text-green-800', cancelled: 'bg-slate-200 text-slate-600' };

export default function CountsPage({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<'' | CountStatus>('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });
  const list = useQuery({
    queryKey: ['stock-counts', status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (status) p.set('status', status);
      return api<Page<CountSummary>>(`/stock/counts?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Stock opname</h1>
        <select aria-label="Status" className="ml-auto rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as '' | CountStatus); setPage(1); }}>
          <option value="">All statuses</option>
          {COUNT_STATUSES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        {canManage && <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setCreating(true)}>New count</button>}
      </div>
      <p className="mb-4 text-sm text-slate-500">Start a count for a warehouse, print the count sheet, enter what was counted, review the variance and post it. Posting adjusts the stock ledger and cannot be undone.</p>
      {list.isPending && <p className="text-sm text-slate-500">Loading counts…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load counts: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No stock counts yet.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Number</th><th className="p-2">Date</th><th className="p-2">Warehouse</th><th className="p-2">Status</th><th className="p-2 text-right">Counted</th><th className="p-2 text-right">Variances</th><th className="p-2 text-right">Variance value</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((c) => (
                <tr key={c.id}>
                  <td className="p-2"><button className="text-blue-700 hover:underline" onClick={() => setOpen(c.id)}>{c.number}</button></td>
                  <td className="p-2">{c.created_at.slice(0, 10)}</td>
                  <td className="p-2">{c.warehouse_name}{c.note && <div className="text-xs text-slate-500">{c.note}</div>}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${badge[c.status]}`}>{statusLabel(c.status)}</span></td>
                  <td className="p-2 text-right">{c.counted_count} / {c.line_count}</td>
                  <td className="p-2 text-right">{c.variance_count}</td>
                  <td className={`p-2 text-right ${c.variance_value < 0 ? 'text-red-700' : c.variance_value > 0 ? 'text-green-700' : ''}`}>{formatRupiah(c.variance_value)}</td>
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
      {creating && <NewDialog warehouses={warehouses.data ?? []} onCreated={(id) => { setCreating(false); setOpen(id); }} onClose={() => setCreating(false)} />}
    </section>
  );
}

function NewDialog({ warehouses, onCreated, onClose }: { warehouses: Warehouse[]; onCreated: (id: number) => void; onClose: () => void }) {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState(String(warehouses[0]?.id ?? ''));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api<CountDetail>('/stock/counts', { method: 'POST', body: { warehouse_id: Number(warehouseId), note } }),
    onSuccess: (d) => { qc.invalidateQueries({ queryKey: ['stock-counts'] }); onCreated(d.id); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="New stock count" onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <label>Warehouse
          <select className={field} value={warehouseId} required onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        <label>Note
          <input className={field} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-xs text-slate-500">The count sheet lists every product the books say is in this warehouse right now.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Start count</button>
        </div>
      </form>
    </Modal>
  );
}

function DetailDialog({ id, canManage, onClose }: { id: number; canManage: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ['stock-counts', 'detail', id], queryFn: () => api<CountDetail>(`/stock/counts/${id}`) });
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const draft = d.data?.status === 'draft';
  const refresh = (fresh: CountDetail) => {
    qc.setQueryData(['stock-counts', 'detail', id], fresh);
    qc.invalidateQueries({ queryKey: ['stock-counts'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['stock-adjustments'] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };
  const parseQty = (s: string) => Math.round(Number(s.replace(',', '.')) * 1000);
  const saveCounts = async () => {
    const counts = Object.entries(edits).map(([pid, s]) => ({ product_id: Number(pid), counted_qty_milli: s.trim() === '' ? null : parseQty(s) }));
    if (counts.length === 0) return d.data;
    const fresh = await api<CountDetail>(`/stock/counts/${id}/counts`, { method: 'PUT', body: { counts } });
    setEdits({});
    refresh(fresh);
    return fresh;
  };
  const save = useMutation({ mutationFn: saveCounts, onError: (e) => setError(e.message) });
  const post = useMutation({
    mutationFn: async () => {
      await saveCounts();
      return api<CountDetail>(`/stock/counts/${id}/post`, { method: 'POST' });
    },
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => api<CountDetail>(`/stock/counts/${id}/cancel`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });
  const invalid = Object.values(edits).some((s) => s.trim() !== '' && !/^[0-9]+([.,][0-9]{1,3})?$/.test(s.trim()));
  const c = d.data;
  const shown = (pid: number, counted: number | null) => (pid in edits ? edits[pid] : counted === null ? '' : String(counted / 1000));

  return (
    <Modal title={c ? c.number : 'Stock count'} wide onClose={onClose}>
      {d.isPending && <p className="text-sm text-slate-500">Loading…</p>}
      {d.isError && <p role="alert" className="text-sm text-red-700">Could not load the count: {d.error.message}</p>}
      {c && (
        <>
          <p className="mb-2 text-sm text-slate-600">
            {c.warehouse_name} · {statusLabel(c.status)} · {c.created_at.slice(0, 10)} · {c.created_by_name}{c.note ? ` · ${c.note}` : ''}
          </p>
          <p className="mb-2 text-sm">
            Counted {c.counted_count} of {c.line_count} · {c.variance_count} with a variance ·{' '}
            <span className={c.variance_value < 0 ? 'text-red-700' : c.variance_value > 0 ? 'text-green-700' : ''}>{formatRupiah(c.variance_value)}</span>
          </p>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase text-slate-500">
                <tr><th className="py-1">Product</th><th className="text-right">Books</th><th className="w-28 text-right">Counted</th><th className="text-right">Variance</th><th className="text-right">Value</th></tr>
              </thead>
              <tbody className="divide-y">
                {c.lines.map((l) => {
                  const pending = l.product_id in edits;
                  const counted = pending ? (edits[l.product_id].trim() === '' ? null : parseQty(edits[l.product_id])) : l.counted_qty_milli;
                  const v = counted === null || Number.isNaN(counted) ? null : counted - l.system_qty_milli;
                  return (
                    <tr key={l.product_id}>
                      <td className="py-1.5">{l.name}<div className="text-xs text-slate-500">{l.sku}</div></td>
                      <td className="text-right">{qty(l.system_qty_milli)} {l.base_unit}</td>
                      <td className="text-right">
                        {draft && canManage ? (
                          <input aria-label={`Counted ${l.name}`} className={`${field} text-right`} inputMode="decimal" value={shown(l.product_id, l.counted_qty_milli)} onChange={(e) => setEdits({ ...edits, [l.product_id]: e.target.value })} />
                        ) : l.counted_qty_milli === null ? <span className="text-slate-400">—</span> : qty(l.counted_qty_milli)}
                      </td>
                      <td className={`text-right ${v === null ? 'text-slate-400' : v < 0 ? 'text-red-700' : v > 0 ? 'text-green-700' : ''}`}>{v === null ? '—' : signed(v)}</td>
                      <td className="text-right">{v === null ? '' : formatRupiah(Math.round((v * l.unit_cost) / 1000))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {c.status === 'posted' && <p className="mt-3 text-sm text-slate-600">Posted {c.posted_at?.slice(0, 10)}. {c.adjustment_id ? 'The variances were booked as a stock adjustment (see Stock adjustments).' : 'There were no variances, so nothing was adjusted.'}</p>}
          {draft && <p className="mt-3 text-xs text-slate-500">Lines left empty are not counted and are not adjusted. Variances are measured against the books when the count was started.</p>}
          {error && <p role="alert" className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2 text-sm">
            <button className="rounded border px-3 py-1.5" onClick={() => window.print()}>Print count sheet</button>
            {draft && canManage && (
              <>
                <button className="rounded border border-red-300 px-3 py-1.5 text-red-700 disabled:opacity-50" disabled={cancel.isPending} onClick={() => { if (window.confirm(`Cancel count ${c.number}? Entered quantities are kept but nothing is adjusted.`)) { setError(null); cancel.mutate(); } }}>Cancel count</button>
                <button className="rounded border px-3 py-1.5 disabled:opacity-50" disabled={save.isPending || invalid || Object.keys(edits).length === 0} onClick={() => { setError(null); save.mutate(); }}>Save counts</button>
                <button className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50" disabled={post.isPending || invalid} onClick={() => { if (window.confirm(`Post ${c.number}? Stock will be adjusted to the counted quantities. This cannot be undone.`)) { setError(null); post.mutate(); } }}>Post count</button>
              </>
            )}
          </div>
          {createPortal(<SheetPrint c={c} />, document.body)}
        </>
      )}
    </Modal>
  );
}

function SheetPrint({ c }: { c: CountDetail }) {
  return (
    <div className="print-root">
      <h1 style={{ fontSize: '16pt', fontWeight: 600 }}>Count sheet {c.number}</h1>
      <p style={{ marginBottom: '6mm' }}>{c.warehouse_name} · {c.created_at.slice(0, 10)}{c.note ? ` · ${c.note}` : ''}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
        <thead>
          <tr>{['SKU', 'Product', 'Unit', 'Counted', 'Initials'].map((h) => <th key={h} style={{ border: '1px solid #000', padding: '2mm', textAlign: 'left' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {c.lines.map((l) => (
            <tr key={l.product_id}>
              <td style={{ border: '1px solid #000', padding: '2mm' }}>{l.sku}</td>
              <td style={{ border: '1px solid #000', padding: '2mm' }}>{l.name}</td>
              <td style={{ border: '1px solid #000', padding: '2mm' }}>{l.base_unit}</td>
              <td style={{ border: '1px solid #000', padding: '2mm', width: '30mm' }} />
              <td style={{ border: '1px solid #000', padding: '2mm', width: '20mm' }} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
