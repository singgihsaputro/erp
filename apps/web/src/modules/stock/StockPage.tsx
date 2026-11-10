import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type Page, type Product, type Role, type StockHistory, type StockRow, type Warehouse } from '@erp/shared';
import { api } from '../../lib/api';

export const STOCK_WRITERS: Role[] = ['super_admin', 'owner', 'admin', 'warehouse'];

const PAGE_SIZE = 50;
const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const field = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
const SOURCES: Record<string, string> = { opening: 'Opening balance' };

export default function StockPage({ canManage }: { canManage: boolean }) {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<StockRow | null>(null);
  const [opening, setOpening] = useState(false);
  const warehouses = useQuery({ queryKey: ['warehouses', false], queryFn: () => api<Warehouse[]>('/warehouses') });

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQ(q);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const list = useQuery({
    queryKey: ['stock', debouncedQ, warehouseId, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) });
      if (debouncedQ) p.set('q', debouncedQ);
      if (warehouseId) p.set('warehouse_id', warehouseId);
      return api<Page<StockRow>>(`/stock?${p}`);
    },
    placeholderData: keepPreviousData,
  });
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Stock</h1>
        <input type="search" aria-label="Search stock" placeholder="Search name, SKU or barcode" className="ml-auto w-56 rounded border border-slate-300 px-2 py-1.5 text-sm" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Warehouse" className="rounded border border-slate-300 px-2 py-1.5 text-sm" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}>
          <option value="">All warehouses</option>
          {warehouses.data?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        {canManage && <button className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white" onClick={() => setOpening(true)}>Enter opening stock</button>}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        On-hand is the sum of the stock ledger. Cost is the moving average over all warehouses. Click a product to see every movement.
      </p>
      {list.isPending && <p className="text-sm text-slate-500">Loading stock…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">Could not load stock: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button></p>
      )}
      {data?.items.length === 0 && (
        <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">
          {debouncedQ || warehouseId ? 'No stock matches.' : 'No stock yet. Enter opening balances to start the ledger.'}
        </p>
      )}
      {data && data.items.length > 0 && (
        <div className="overflow-x-auto rounded border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="p-2">Product</th><th className="p-2">Warehouse</th><th className="p-2 text-right">On hand</th><th className="p-2 text-right">Avg cost</th><th className="p-2 text-right">Value</th></tr>
            </thead>
            <tbody className="divide-y">
              {data.items.map((r) => (
                <tr key={`${r.product_id}-${r.warehouse_id}`}>
                  <td className="p-2"><button className="text-left text-blue-700 hover:underline" onClick={() => setHistory(r)}>{r.name}</button><div className="text-xs text-slate-500">{r.sku}</div></td>
                  <td className="p-2">{r.warehouse_name}</td>
                  <td className="p-2 text-right">{qty(r.qty_milli)} {r.base_unit}</td>
                  <td className="p-2 text-right">{formatRupiah(r.avg_cost)}</td>
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
      {history && <HistoryDialog row={history} onClose={() => setHistory(null)} />}
      {opening && <OpeningDialog warehouses={warehouses.data ?? []} onClose={() => setOpening(false)} />}
    </section>
  );
}

function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`max-h-full w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} overflow-auto rounded bg-white p-5 shadow`}>
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="ml-auto text-slate-500 hover:text-slate-800" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HistoryDialog({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [onlyThis, setOnlyThis] = useState(false);
  const h = useQuery({
    queryKey: ['stock', 'history', row.product_id, onlyThis ? row.warehouse_id : 'all'],
    queryFn: () => api<StockHistory>(`/stock/products/${row.product_id}/moves${onlyThis ? `?warehouse_id=${row.warehouse_id}` : ''}`),
  });
  return (
    <Modal title={`Movements: ${row.name}`} wide onClose={onClose}>
      <label className="mb-2 flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> Only {row.warehouse_name}
      </label>
      {h.isPending && <p className="text-sm text-slate-500">Loading movements…</p>}
      {h.isError && <p role="alert" className="text-sm text-red-700">Could not load movements: {h.error.message}</p>}
      {h.data?.moves.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">No movements.</p>}
      {h.data && h.data.moves.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500">
              <tr><th className="py-1">Date</th><th>Warehouse</th><th>Source</th><th className="text-right">Qty</th><th className="text-right">Unit cost</th><th className="text-right">Balance</th><th className="text-right">Avg cost</th></tr>
            </thead>
            <tbody className="divide-y">
              {[...h.data.moves].reverse().map((m) => (
                <tr key={m.id}>
                  <td className="py-1.5">{m.created_at.slice(0, 10)}</td>
                  <td>{m.warehouse_code}</td>
                  <td>{SOURCES[m.source_type] ?? m.source_type}{m.note && m.note !== 'Opening balance' ? <div className="text-xs text-slate-500">{m.note}</div> : null}</td>
                  <td className={`text-right ${m.qty_milli < 0 ? 'text-red-700' : 'text-green-700'}`}>{m.qty_milli > 0 ? '+' : ''}{qty(m.qty_milli)}</td>
                  <td className="text-right">{formatRupiah(m.unit_cost)}</td>
                  <td className="text-right">{qty(m.balance_milli)} {h.data.product.base_unit}</td>
                  <td className="text-right">{formatRupiah(m.avg_cost_after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

interface Line { product_id: string; qty: string; cost: string }

function OpeningDialog({ warehouses, onClose }: { warehouses: Warehouse[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState(String(warehouses[0]?.id ?? ''));
  const [lines, setLines] = useState<Line[]>([{ product_id: '', qty: '', cost: '' }]);
  const [error, setError] = useState<string | null>(null);
  const products = useQuery({ queryKey: ['products', 'all-active'], queryFn: () => api<Page<Product>>('/products?page_size=200') });
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const pick = (i: number, id: string) => {
    const p = products.data?.items.find((x) => String(x.id) === id);
    set(i, { product_id: id, cost: p ? String(p.cost) : '' });
  };
  const save = useMutation({
    mutationFn: () =>
      api('/stock/opening', {
        method: 'POST',
        body: {
          warehouse_id: Number(warehouseId),
          lines: lines.map((l) => ({ product_id: Number(l.product_id), qty_milli: Math.round(Number(l.qty.replace(',', '.')) * 1000), unit_cost: Number(l.cost) })),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  return (
    <Modal title="Enter opening stock" wide onClose={onClose}>
      <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <label>Warehouse
          <select className={field} value={warehouseId} required onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
        {products.isError && <p role="alert" className="text-red-700">Could not load products: {products.error.message}</p>}
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7rem_8rem_auto]">
            <select aria-label={`Line ${i + 1} product`} className={`${field} col-span-2 sm:col-span-1`} value={l.product_id} required onChange={(e) => pick(i, e.target.value)}>
              <option value="">Choose product…</option>
              {products.data?.items.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
            <input aria-label={`Line ${i + 1} quantity`} className={field} inputMode="decimal" placeholder="Qty" value={l.qty} required pattern="[0-9]+([.,][0-9]{1,3})?" onChange={(e) => set(i, { qty: e.target.value })} />
            <input aria-label={`Line ${i + 1} cost`} className={field} inputMode="numeric" placeholder="Cost (Rp)" value={l.cost} required pattern="[0-9]+" onChange={(e) => set(i, { cost: e.target.value })} />
            <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
        <div><button type="button" className="text-blue-700 hover:underline" onClick={() => setLines([...lines, { product_id: '', qty: '', cost: '' }])}>Add line</button></div>
        <p className="text-xs text-slate-500">Quantities are in each product's base unit (decimals allowed, e.g. 1,5 kg). Opening balances are posted to the ledger and cannot be edited; correct them later with a stock adjustment.</p>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Post opening stock</button>
        </div>
      </form>
    </Modal>
  );
}
