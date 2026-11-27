import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRICE_TIERS, PRICE_TIER_LABELS, formatRupiah, type Page, type PriceListProduct, type PriceRule, type PriceTier } from '@erp/shared';
import { api } from '../../lib/api';
import { Modal } from '../stock/StockPage';

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';

export default function PriceListsPage({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState<PriceListProduct | null>(null);
  const list = useQuery({
    queryKey: ['price-lists', search, page],
    queryFn: () => api<Page<PriceListProduct>>(`/price-lists?q=${encodeURIComponent(search)}&page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: keepPreviousData,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api<null>(`/price-lists/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-lists'] }),
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const ruleChip = (r: PriceRule) => (
    <li key={r.id} className="flex items-center gap-1 whitespace-nowrap">
      <span>{r.min_qty_milli > 1000 ? `from ${qty(r.min_qty_milli)}: ` : 'any qty: '}<b>{formatRupiah(r.price)}</b></span>
      {canManage && (
        <button aria-label={`Delete ${PRICE_TIER_LABELS[r.tier]} price from ${qty(r.min_qty_milli)}`} className="text-red-700 hover:underline" onClick={() => window.confirm('Delete this price? Documents already made keep their price.') && remove.mutate(r.id)}>✕</button>
      )}
    </li>
  );
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Price lists</h1>
        <input aria-label="Search products" className="ml-auto w-64 rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Search product or SKU" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Prices per customer tier and quantity break (for example grosir from 10 pcs). Quotations and sales orders use them automatically, from the customer's tier and the quantity ordered; where no price is set the product's normal price applies. Prices exclude PPN.
      </p>
      {list.isPending && <p className="text-sm text-slate-500">Loading price lists…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load price lists: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {remove.isError && <p role="alert" className="mb-2 text-sm text-red-700">Could not delete: {remove.error.message}</p>}
      {data?.items.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No products match.</p>}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Product</th><th className="p-2 text-right">Normal price</th>{PRICE_TIERS.map((t) => <th key={t} className="p-2">{PRICE_TIER_LABELS[t]}</th>)}{canManage && <th className="p-2" />}</tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((p) => (
                <tr key={p.product_id} className="align-top">
                  <td className="p-2"><div>{p.name}</div><div className="text-xs text-slate-500">{p.sku} · per {p.base_unit}</div></td>
                  <td className="p-2 text-right">{formatRupiah(p.price)}</td>
                  {PRICE_TIERS.map((t) => {
                    const rules = p.rules.filter((r) => r.tier === t);
                    return <td key={t} className="p-2">{rules.length === 0 ? <span className="text-slate-400">—</span> : <ul>{rules.map(ruleChip)}</ul>}</td>;
                  })}
                  {canManage && <td className="p-2 text-right"><button className="text-blue-700 hover:underline" onClick={() => setAdding(p)}>Add price</button></td>}
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
      {adding && <RuleForm product={adding} onClose={() => setAdding(null)} />}
    </section>
  );
}

function RuleForm({ product, onClose }: { product: PriceListProduct; onClose: () => void }) {
  const qc = useQueryClient();
  const [tier, setTier] = useState<PriceTier>('grosir');
  const [min, setMin] = useState('10');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api<PriceRule>('/price-lists/rules', {
        method: 'PUT',
        body: { product_id: product.product_id, tier, min_qty_milli: Math.round(Number(min.replace(',', '.')) * 1000), price: Math.round(Number(price)) },
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-lists'] }); onClose(); },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title={`Add price — ${product.name}`} onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <p className="text-slate-500">Normal price {formatRupiah(product.price)} per {product.base_unit}. A price with the same tier and quantity is replaced.</p>
        <label>Customer tier
          <select className={field} value={tier} onChange={(e) => setTier(e.target.value as PriceTier)}>
            {PRICE_TIERS.map((t) => <option key={t} value={t}>{PRICE_TIER_LABELS[t]}</option>)}
          </select>
        </label>
        <label>From quantity ({product.base_unit})
          <input className={field} inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,3})?" value={min} onChange={(e) => setMin(e.target.value)} />
        </label>
        <label>Price per {product.base_unit} (Rp, excl. PPN)
          <input className={field} inputMode="numeric" required pattern="[0-9]+" value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save price</button>
        </div>
      </form>
    </Modal>
  );
}
