import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Product } from '@erp/shared';
import { api, ApiError } from '../../lib/api';
import { parseRupiahInput } from '../../lib/format';

const UNITS = ['pcs', 'kg', 'gram', 'liter', 'meter', 'pack', 'box'];

export default function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    base_unit: product?.base_unit ?? 'pcs',
    cost: String(product?.cost ?? 0),
    price: String(product?.price ?? 0),
  });
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});

  const save = useMutation({
    mutationFn: (body: unknown) =>
      product ? api<Product>(`/products/${product.id}`, { method: 'PUT', body }) : api<Product>('/products', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (e) => {
      setError(e.message);
      setFields(e instanceof ApiError ? (e.fields ?? {}) : {});
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const cost = parseRupiahInput(f.cost);
    const price = parseRupiahInput(f.price);
    if (Number.isNaN(cost) || Number.isNaN(price)) {
      setError('Cost and price must be whole Rupiah amounts.');
      return;
    }
    setError(null);
    setFields({});
    save.mutate({ ...f, cost, price });
  }

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });
  const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm';
  const fieldError = (k: string) => fields[k]?.[0] && <p className="text-xs text-red-600">{fields[k]![0]}</p>;

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-y-auto bg-black/40 p-4" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="mt-8 w-full max-w-lg space-y-3 rounded-lg bg-white p-5 shadow-lg">
        <h2 className="text-lg font-semibold">{product ? 'Edit product' : 'New product'}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            SKU
            <input className={input} value={f.sku} onChange={set('sku')} required maxLength={40} />
            {fieldError('sku')}
          </label>
          <label className="block text-sm">
            Barcode
            <input className={input} value={f.barcode} onChange={set('barcode')} maxLength={40} />
            {fieldError('barcode')}
          </label>
        </div>
        <label className="block text-sm">
          Name
          <input className={input} value={f.name} onChange={set('name')} required maxLength={200} />
          {fieldError('name')}
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            Base unit
            <select className={input} value={f.base_unit} onChange={set('base_unit')}>
              {[...new Set([...UNITS, f.base_unit])].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Cost (Rp)
            <input className={input} inputMode="numeric" value={f.cost} onChange={set('cost')} />
          </label>
          <label className="block text-sm">
            Selling price (Rp)
            <input className={input} inputMode="numeric" value={f.price} onChange={set('price')} />
          </label>
        </div>
        {error && <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded border px-3 py-1.5 text-sm">Cancel</button>
          <button type="submit" disabled={save.isPending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
