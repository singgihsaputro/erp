import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROMOTION_KINDS, PROMOTION_KIND_LABELS, formatRupiah, type Page, type PriceListProduct, type Promotion, type PromotionKind, type PromotionStatus } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const milli = (s: string) => Math.round(Number(s.replace(',', '.')) * 1000);
const STATUS: Record<PromotionStatus, { label: string; cls: string }> = {
  running: { label: 'Running', cls: 'bg-green-100 text-green-800' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-800' },
  ended: { label: 'Ended', cls: 'bg-slate-100 text-slate-600' },
  disabled: { label: 'Switched off', cls: 'bg-amber-100 text-amber-800' },
};

function describe(p: Promotion): string {
  const min = p.min_qty_milli > 1000 ? ` from ${qty(p.min_qty_milli)} ${p.base_unit}` : '';
  if (p.kind === 'percent') return `${p.percent_off}% off${min}`;
  if (p.kind === 'fixed') return `${formatRupiah(p.amount_off ?? 0)} off per ${p.base_unit}${min}`;
  return `Buy ${qty(p.buy_qty_milli ?? 0)}, get ${qty(p.free_qty_milli ?? 0)} ${p.base_unit} free`;
}

export default function PromotionsPage({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['promotions', search, status, page],
    queryFn: () => api<Page<Promotion>>(`/promotions?q=${encodeURIComponent(search)}${status ? `&status=${status}` : ""}&page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['promotions'] });
  const toggle = useMutation({
    mutationFn: (p: Promotion) => api<Promotion>(`/promotions/${p.id}/${p.active ? 'disable' : 'enable'}`, { method: 'POST' }),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: number) => api<null>(`/promotions/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Promotions</h1>
        <select aria-label="Filter by status" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="scheduled">Scheduled</option>
          <option value="ended">Ended</option>
          <option value="disabled">Switched off</option>
        </select>
        <input aria-label="Search promotions" className="w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Search promotion or product" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        {canManage && <button className="ml-auto rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setEditing('new')}>New promotion</button>}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Percentage or fixed discounts and buy-X-get-Y offers on a product between two dates (Jakarta business days, both included). Only one promotion applies to a line: the one that takes the most off. Prices exclude PPN.
      </p>
      {list.isPending && <p className="text-sm text-slate-500">Loading promotions…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load promotions: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {(toggle.isError || remove.isError) && <p role="alert" className="mb-2 text-sm text-red-700">Could not change the promotion: {(toggle.error ?? remove.error)?.message}</p>}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No promotions found.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Promotion</th><th className="p-2">Product</th><th className="p-2">Offer</th><th className="p-2">Dates</th><th className="p-2">Status</th>{canManage && <th className="p-2" />}</tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="p-2">{p.name}<div className="text-xs text-slate-500">{PROMOTION_KIND_LABELS[p.kind]}</div></td>
                  <td className="p-2">{p.product_name}<div className="text-xs text-slate-500">{p.product_sku}</div></td>
                  <td className="p-2">{describe(p)}</td>
                  <td className="whitespace-nowrap p-2">{p.starts_on} – {p.ends_on}</td>
                  <td className="p-2"><span className={`rounded px-2 py-0.5 text-xs ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span></td>
                  {canManage && (
                    <td className="space-x-3 whitespace-nowrap p-2 text-right">
                      <button className="text-blue-700 hover:underline" onClick={() => setEditing(p)}>Edit</button>
                      <button className="text-blue-700 hover:underline" onClick={() => toggle.mutate(p)}>{p.active ? 'Switch off' : 'Switch on'}</button>
                      <button className="text-red-700 hover:underline" onClick={() => window.confirm(`Delete "${p.name}"? Documents already made keep their price.`) && remove.mutate(p.id)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > PAGE_SIZE && (
        <div className="mt-3 flex items-center gap-3 text-sm">
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button className="rounded border px-2 py-1 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {editing && <PromotionForm promotion={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={refresh} />}
    </section>
  );
}

function PromotionForm({ promotion, onClose, onSaved }: { promotion: Promotion | null; onClose: () => void; onSaved: () => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [name, setName] = useState(promotion?.name ?? '');
  const [kind, setKind] = useState<PromotionKind>(promotion?.kind ?? 'percent');
  const [productId, setProductId] = useState(promotion ? String(promotion.product_id) : '');
  const [percent, setPercent] = useState(String(promotion?.percent_off ?? '10'));
  const [amount, setAmount] = useState(String(promotion?.amount_off ?? ''));
  const [buy, setBuy] = useState(promotion?.buy_qty_milli ? String(promotion.buy_qty_milli / 1000) : '5');
  const [free, setFree] = useState(promotion?.free_qty_milli ? String(promotion.free_qty_milli / 1000) : '1');
  const [min, setMin] = useState(String((promotion?.min_qty_milli ?? 1000) / 1000));
  const [start, setStart] = useState(promotion?.starts_on ?? today);
  const [end, setEnd] = useState(promotion?.ends_on ?? today);
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({ queryKey: ['price-lists', '', 1, 200], queryFn: () => api<Page<PriceListProduct>>('/price-lists?page=1&page_size=200') });
  const save = useMutation({
    mutationFn: () =>
      api<Promotion>(promotion ? `/promotions/${promotion.id}` : '/promotions', {
        method: promotion ? 'PUT' : 'POST',
        body: {
          name, kind, product_id: Number(productId), starts_on: start, ends_on: end,
          ...(kind === 'percent' && { percent_off: Math.round(Number(percent)), min_qty_milli: milli(min) }),
          ...(kind === 'fixed' && { amount_off: Math.round(Number(amount)), min_qty_milli: milli(min) }),
          ...(kind === 'buy_x_get_y' && { buy_qty_milli: milli(buy), free_qty_milli: milli(free) }),
        },
      }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={promotion ? 'Edit promotion' : 'New promotion'} onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <label>Name<input className={field} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Product
          <select className={field} required value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">{products.isPending ? 'Loading…' : 'Choose a product'}</option>
            {products.data?.items.map((p) => <option key={p.product_id} value={p.product_id}>{p.name} ({formatRupiah(p.price)})</option>)}
          </select>
        </label>
        <label>Type
          <select className={field} value={kind} onChange={(e) => setKind(e.target.value as PromotionKind)}>
            {PROMOTION_KINDS.map((k) => <option key={k} value={k}>{PROMOTION_KIND_LABELS[k]}</option>)}
          </select>
        </label>
        {kind === 'percent' && <label>Percentage off (1–100)<input className={field} inputMode="numeric" required pattern="[0-9]+" value={percent} onChange={(e) => setPercent(e.target.value)} /></label>}
        {kind === 'fixed' && <label>Rp off per unit (excl. PPN)<input className={field} inputMode="numeric" required pattern="[0-9]+" value={amount} onChange={(e) => setAmount(e.target.value)} /></label>}
        {kind !== 'buy_x_get_y' && <label>Minimum quantity<input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={min} onChange={(e) => setMin(e.target.value)} /></label>}
        {kind === 'buy_x_get_y' && (
          <div className="grid grid-cols-2 gap-3">
            <label>Buy<input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={buy} onChange={(e) => setBuy(e.target.value)} /></label>
            <label>Get free<input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={free} onChange={(e) => setFree(e.target.value)} /></label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label>Starts on<input type="date" className={field} required value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>Ends on<input type="date" className={field} required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save promotion</button>
        </div>
      </form>
    </Modal>
  );
}
