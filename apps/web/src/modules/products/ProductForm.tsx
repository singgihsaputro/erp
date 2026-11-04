import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, Product, ProductUnit, Unit } from '@erp/shared';
import { api, ApiError } from '../../lib/api';
import { parseQtyInput, parseRupiahInput, qtyToInput } from '../../lib/format';

interface ConversionRow {
  unit: string;
  factor: string;
}

export default function ProductForm({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    base_unit: product?.base_unit ?? 'pcs',
    cost: String(product?.cost ?? 0),
    price: String(product?.price ?? 0),
    category_id: product?.category_id ? String(product.category_id) : '',
  });
  const units = useQuery({ queryKey: ['units'], queryFn: () => api<Unit[]>('/units') });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/categories') });
  const [rows, setRows] = useState<ConversionRow[] | null>(null);
  const existing = useQuery({
    queryKey: ['product-units', product?.id],
    enabled: !!product,
    queryFn: () => api<{ units: ProductUnit[] }>(`/products/${product!.id}/units`),
  });
  const conversions: ConversionRow[] =
    rows ?? existing.data?.units.map((u) => ({ unit: u.unit, factor: qtyToInput(u.factor_milli) })) ?? [];
  const setRow = (i: number, patch: Partial<ConversionRow>) =>
    setRows(conversions.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string[] | undefined>>({});

  const save = useMutation({
    mutationFn: async ({ body, units: conv }: { body: unknown; units: ProductUnit[] | null }) => {
      const saved = product
        ? await api<Product>(`/products/${product.id}`, { method: 'PUT', body })
        : await api<Product>('/products', { method: 'POST', body });
      if (conv) await api(`/products/${saved.id}/units`, { method: 'PUT', body: { units: conv } });
      return saved;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product-units'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
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
    let conv: ProductUnit[] | null = null;
    if (rows) {
      conv = [];
      for (const r of rows) {
        const factor = parseQtyInput(r.factor);
        if (!r.unit || Number.isNaN(factor) || factor < 1) {
          setError('Each conversion needs a unit and a positive number of base units (up to 3 decimals).');
          return;
        }
        conv.push({ unit: r.unit, factor_milli: factor });
      }
    }
    setError(null);
    setFields({});
    save.mutate({ body: { ...f, cost, price, category_id: f.category_id ? Number(f.category_id) : null }, units: conv });
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
              {[...new Set([...(units.data?.map((u) => u.code) ?? []), f.base_unit])].map((u) => (
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
        <label className="block text-sm">
          Category
          <select className={input} value={f.category_id} onChange={set('category_id')}>
            <option value="">No category</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {fieldError('category_id')}
        </label>
        <fieldset className="space-y-2 rounded border border-slate-200 p-3">
          <legend className="px-1 text-sm">Other units (conversions to {f.base_unit})</legend>
          {product && existing.isPending && <p className="text-xs text-slate-500">Loading conversions…</p>}
          {conversions.length === 0 && !existing.isPending && (
            <p className="text-xs text-slate-500">None. Add one if you also buy or sell this product by the dus, karung, lusin…</p>
          )}
          {conversions.map((r, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
              <span>1</span>
              <select aria-label={`Conversion ${i + 1} unit`} className="rounded border border-slate-300 px-2 py-1" value={r.unit}
                onChange={(e) => setRow(i, { unit: e.target.value })}>
                <option value="">Unit…</option>
                {units.data?.filter((u) => u.code.toLowerCase() !== f.base_unit.toLowerCase()).map((u) => (
                  <option key={u.id} value={u.code}>{u.code}</option>
                ))}
              </select>
              <span>=</span>
              <input aria-label={`Conversion ${i + 1} quantity`} inputMode="decimal" className="w-24 rounded border border-slate-300 px-2 py-1"
                value={r.factor} onChange={(e) => setRow(i, { factor: e.target.value })} />
              <span>{f.base_unit}</span>
              <button type="button" className="text-red-700 hover:underline" onClick={() => setRows(conversions.filter((_, j) => j !== i))}>
                Remove
              </button>
            </div>
          ))}
          {fieldError('units')}
          <button type="button" className="text-sm text-blue-700 hover:underline"
            disabled={!!product && existing.isPending}
            onClick={() => setRows([...conversions, { unit: '', factor: '' }])}>
            + Add unit
          </button>
        </fieldset>
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
