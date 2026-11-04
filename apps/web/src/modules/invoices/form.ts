import type { InvoiceData, InvoiceStatus } from '@erp/shared';
import { formatRupiah } from '@erp/shared';
import { parseQtyInput, parseRupiahInput, qtyToInput } from '../../lib/format';

/** The review form keeps what the person typed as text and converts it on every change. */
export interface LineForm {
  description: string;
  product_id: number | null;
  qty: string;
  unit: string;
  unit_price: string;
  amount: string;
}

export interface InvoiceForm {
  supplier_name: string;
  supplier_npwp: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  lines: LineForm[];
  subtotal: string;
  discount: string;
  ppn_rate: string;
  ppn: string;
  total: string;
}

const grouped = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
/** 1360000 → "1.360.000", which parseRupiahInput reads back. */
const money = (n: number | null) => (n === null ? '' : grouped.format(n));

export function toForm(d: InvoiceData): InvoiceForm {
  return {
    supplier_name: d.supplier_name ?? '',
    supplier_npwp: d.supplier_npwp ?? '',
    invoice_number: d.invoice_number ?? '',
    invoice_date: d.invoice_date ?? '',
    due_date: d.due_date ?? '',
    lines: d.lines.map((l) => ({
      description: l.description,
      product_id: l.product_id,
      qty: qtyToInput(l.qty_milli),
      unit: l.unit ?? '',
      unit_price: money(l.unit_price),
      amount: money(l.amount),
    })),
    subtotal: money(d.subtotal),
    discount: d.discount ? money(d.discount) : '',
    ppn_rate: d.ppn_rate === null ? '' : String(d.ppn_rate).replace('.', ','),
    ppn: money(d.ppn),
    total: money(d.total),
  };
}

export const emptyLine = (): LineForm => ({ description: '', product_id: null, qty: '1', unit: '', unit_price: '', amount: '' });

/** Converts the form; `invalid` names every field whose text is not a valid number. */
export function fromForm(f: InvoiceForm): { data: InvoiceData; invalid: Set<string> } {
  const invalid = new Set<string>();
  const amount = (key: string, text: string, nullable: boolean): number | null => {
    if (text.trim() === '') {
      if (!nullable) invalid.add(key);
      return nullable ? null : 0;
    }
    const v = parseRupiahInput(text);
    if (Number.isNaN(v)) {
      invalid.add(key);
      return 0;
    }
    return v;
  };
  const lines = f.lines.map((l, i) => {
    const qty = parseQtyInput(l.qty);
    if (Number.isNaN(qty) || qty <= 0) invalid.add(`lines.${i}.qty`);
    return {
      description: l.description,
      product_id: l.product_id,
      qty_milli: Number.isNaN(qty) ? 0 : qty,
      unit: l.unit.trim() || null,
      unit_price: amount(`lines.${i}.unit_price`, l.unit_price, false) ?? 0,
      amount: amount(`lines.${i}.amount`, l.amount, false) ?? 0,
    };
  });
  let ppnRate: number | null = null;
  if (f.ppn_rate.trim()) {
    ppnRate = Number(f.ppn_rate.replace(',', '.').replace('%', '').trim());
    if (Number.isNaN(ppnRate) || ppnRate < 0 || ppnRate > 100) {
      invalid.add('ppn_rate');
      ppnRate = null;
    }
  }
  const data: InvoiceData = {
    supplier_name: f.supplier_name.trim() || null,
    supplier_npwp: f.supplier_npwp.trim() || null,
    invoice_number: f.invoice_number.trim() || null,
    invoice_date: f.invoice_date || null,
    due_date: f.due_date || null,
    lines,
    subtotal: amount('subtotal', f.subtotal, true),
    discount: amount('discount', f.discount, true) ?? 0,
    ppn_rate: ppnRate,
    ppn: amount('ppn', f.ppn, true),
    total: amount('total', f.total, true),
  };
  return { data, invalid };
}

export const STATUS_LABEL: Record<InvoiceStatus, string> = { review: 'To review', confirmed: 'Confirmed', rejected: 'Rejected' };
export const STATUS_STYLE: Record<InvoiceStatus, string> = {
  review: 'bg-blue-100 text-blue-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-slate-200 text-slate-700',
};

export const rupiahOrDash = (n: number | null) => (n === null ? '—' : formatRupiah(n));
