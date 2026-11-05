import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRupiah, type Role, type Warehouse, type WarehouseStockRow } from '@erp/shared';
import { api } from '../../lib/api';

export const WAREHOUSE_MANAGERS: Role[] = ['super_admin', 'owner', 'admin'];

const qty = (milli: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(milli / 1000);
const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';

export default function WarehousesPage({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);
  const [viewing, setViewing] = useState<Warehouse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['warehouses', archived],
    queryFn: () => api<Warehouse[]>(`/warehouses${archived ? '?archived=1' : ''}`),
  });
  const refresh = () => {
    setError(null);
    qc.invalidateQueries({ queryKey: ['warehouses'] });
  };
  const action = useMutation({
    mutationFn: (a: { id: number; verb: 'make-default' | 'archive' | 'restore' }) =>
      api(`/warehouses/${a.id}/${a.verb}`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (e) => setError(e.message),
  });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Warehouses</h1>
        <label className="ml-auto flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
          Show archived
        </label>
        {canManage && (
          <button
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white"
            onClick={() => setEditing({ code: '', name: '', address: '' })}
          >
            Add warehouse
          </button>
        )}
      </div>
      <p className="mb-4 text-sm text-slate-500">
        Each location keeps its own stock: on-hand is the sum of its stock ledger movements.
      </p>
      {error && <p role="alert" className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {list.isPending && <p className="text-sm text-slate-500">Loading warehouses…</p>}
      {list.isError && (
        <p role="alert" className="text-sm text-red-700">
          Could not load warehouses: {list.error.message}{' '}
          <button className="underline" onClick={() => list.refetch()}>Retry</button>
        </p>
      )}
      {list.data?.length === 0 && (
        <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">
          {archived ? 'No archived warehouses.' : 'No warehouses yet.'}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.map((w) => (
          <article key={w.id} className="rounded border bg-white p-4 text-sm" aria-label={w.name}>
            <header className="mb-1 flex items-center gap-2">
              <h2 className="font-semibold">{w.name}</h2>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{w.code}</span>
              {w.is_default && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">Default</span>}
            </header>
            <p className="mb-3 text-slate-500">{w.address || 'No address'}</p>
            <dl className="mb-3 grid grid-cols-3 gap-2">
              <div><dt className="text-xs text-slate-500">Products</dt><dd className="font-medium">{w.product_count}</dd></div>
              <div><dt className="text-xs text-slate-500">Units on hand</dt><dd className="font-medium">{qty(w.stock_milli)}</dd></div>
              <div><dt className="text-xs text-slate-500">Value</dt><dd className="font-medium">{formatRupiah(w.stock_value)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-3">
              <button className="text-blue-700 hover:underline" onClick={() => setViewing(w)}>View stock</button>
              {canManage && !w.archived_at && (
                <>
                  <button className="text-blue-700 hover:underline" onClick={() => setEditing(w)}>Edit</button>
                  {!w.is_default && (
                    <button className="text-blue-700 hover:underline" onClick={() => action.mutate({ id: w.id, verb: 'make-default' })}>
                      Make default
                    </button>
                  )}
                  <button
                    className="text-red-700 hover:underline"
                    onClick={() => window.confirm(`Archive warehouse "${w.name}"?`) && action.mutate({ id: w.id, verb: 'archive' })}
                  >
                    Archive
                  </button>
                </>
              )}
              {canManage && w.archived_at && (
                <button className="text-blue-700 hover:underline" onClick={() => action.mutate({ id: w.id, verb: 'restore' })}>Restore</button>
              )}
            </div>
          </article>
        ))}
      </div>
      {editing && <WarehouseForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {viewing && <StockDialog warehouse={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-full w-full max-w-lg overflow-auto rounded bg-white p-5 shadow">
        <div className="mb-3 flex items-center">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button className="ml-auto text-slate-500 hover:text-slate-800" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function WarehouseForm({ initial, onClose, onSaved }: { initial: Partial<Warehouse>; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ code: initial.code ?? '', name: initial.name ?? '', address: initial.address ?? '' });
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      initial.id
        ? api(`/warehouses/${initial.id}`, { method: 'PUT', body: form })
        : api('/warehouses', { method: 'POST', body: form }),
    onSuccess: onSaved,
    onError: (e) => setError(e.message),
  });
  const locked = !!initial.id && (initial.move_count ?? 0) > 0;
  return (
    <Modal title={initial.id ? 'Edit warehouse' : 'Add warehouse'} onClose={onClose}>
      <form
        className="grid gap-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <label>Code
          <input className={input} value={form.code} maxLength={20} disabled={locked} required onChange={(e) => setForm({ ...form, code: e.target.value })} />
          {locked && <span className="text-xs text-slate-500">Locked: this warehouse has stock movements.</span>}
        </label>
        <label>Name
          <input className={input} value={form.name} maxLength={80} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label>Address
          <textarea className={input} rows={2} value={form.address} maxLength={300} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        </label>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5" onClick={onClose}>Cancel</button>
          <button disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-white disabled:opacity-50">Save</button>
        </div>
      </form>
    </Modal>
  );
}

function StockDialog({ warehouse, onClose }: { warehouse: Warehouse; onClose: () => void }) {
  const stock = useQuery({
    queryKey: ['warehouses', warehouse.id, 'stock'],
    queryFn: () => api<WarehouseStockRow[]>(`/warehouses/${warehouse.id}/stock`),
  });
  return (
    <Modal title={`Stock in ${warehouse.name}`} onClose={onClose}>
      {stock.isPending && <p className="text-sm text-slate-500">Loading stock…</p>}
      {stock.isError && <p role="alert" className="text-sm text-red-700">Could not load stock: {stock.error.message}</p>}
      {stock.data?.length === 0 && <p className="rounded border border-dashed p-6 text-center text-sm text-slate-500">Nothing in stock here yet.</p>}
      {stock.data && stock.data.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-slate-500">
            <tr><th className="py-1">Product</th><th className="py-1 text-right">On hand</th></tr>
          </thead>
          <tbody className="divide-y">
            {stock.data.map((r) => (
              <tr key={r.product_id}>
                <td className="py-1.5">{r.name}<div className="text-xs text-slate-500">{r.sku}</div></td>
                <td className="py-1.5 text-right">{qty(r.qty_milli)} {r.base_unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
