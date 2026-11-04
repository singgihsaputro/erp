import type { InvoiceIssue, Product } from '@erp/shared';
import { emptyLine, type LineForm } from './form';

interface Props {
  lines: LineForm[];
  onChange: (lines: LineForm[]) => void;
  products: Product[];
  invalid: Set<string>;
  issues: InvoiceIssue[];
  disabled: boolean;
}

export default function LinesEditor({ lines, onChange, products, invalid, issues, disabled }: Props) {
  const set = (i: number, patch: Partial<LineForm>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cell = (bad: boolean) =>
    `w-full rounded border px-1.5 py-1 text-sm disabled:border-transparent disabled:bg-transparent ${bad ? 'border-red-400 bg-red-50' : 'border-slate-300'}`;

  return (
    <div>
      <div className="overflow-x-auto rounded border">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-slate-100 text-xs uppercase text-slate-500">
            <tr>
              <th className="w-6 px-2 py-2">#</th>
              <th className="px-2 py-2">Description and product</th>
              <th className="w-16 px-2 py-2 text-right">Qty</th>
              <th className="w-16 px-2 py-2">Unit</th>
              <th className="w-24 px-2 py-2 text-right">Unit price</th>
              <th className="w-28 px-2 py-2 text-right">Amount</th>
              {!disabled && <th className="w-8 px-1 py-2" />}
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const rowIssues = issues.filter((x) => x.field === `lines.${i}`);
              return (
                <tr key={i} className={`border-t align-top ${rowIssues.length ? 'bg-amber-50/60' : ''}`}>
                  <td className="px-2 py-1.5 text-xs text-slate-400">{i + 1}</td>
                  <td className="px-2 py-1">
                    <input aria-label={`Line ${i + 1} description`} className={cell(!l.description.trim())} value={l.description} disabled={disabled}
                      onChange={(e) => set(i, { description: e.target.value })} />
                    <select aria-label={`Line ${i + 1} product`} className={`${cell(false)} mt-1 text-slate-600`} value={l.product_id ?? ''} disabled={disabled}
                      onChange={(e) => set(i, { product_id: e.target.value ? Number(e.target.value) : null })}>
                      <option value="">— not matched —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>
                      ))}
                    </select>
                    {rowIssues.map((x, k) => (
                      <p key={k} className="mt-0.5 text-xs text-amber-700">{x.message}</p>
                    ))}
                  </td>
                  <td className="px-2 py-1">
                    <input aria-label={`Line ${i + 1} quantity`} inputMode="decimal" className={`${cell(invalid.has(`lines.${i}.qty`))} text-right`} value={l.qty}
                      disabled={disabled} onChange={(e) => set(i, { qty: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input aria-label={`Line ${i + 1} unit`} className={cell(false)} value={l.unit} disabled={disabled} maxLength={20}
                      onChange={(e) => set(i, { unit: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input aria-label={`Line ${i + 1} unit price`} inputMode="numeric" className={`${cell(invalid.has(`lines.${i}.unit_price`))} text-right tabular-nums`}
                      value={l.unit_price} disabled={disabled} onChange={(e) => set(i, { unit_price: e.target.value })} />
                  </td>
                  <td className="px-2 py-1">
                    <input aria-label={`Line ${i + 1} amount`} inputMode="numeric" className={`${cell(invalid.has(`lines.${i}.amount`))} text-right tabular-nums`}
                      value={l.amount} disabled={disabled} onChange={(e) => set(i, { amount: e.target.value })} />
                  </td>
                  {!disabled && (
                    <td className="px-1 py-1.5 text-center">
                      <button type="button" aria-label={`Remove line ${i + 1}`} className="text-slate-400 hover:text-red-600"
                        onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button>
                    </td>
                  )}
                </tr>
              );
            })}
            {lines.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">No lines were found in the PDF. Add them by hand.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {!disabled && (
        <button type="button" onClick={() => onChange([...lines, emptyLine()])} className="mt-2 rounded border bg-white px-3 py-1 text-sm">
          + Add line
        </button>
      )}
    </div>
  );
}
