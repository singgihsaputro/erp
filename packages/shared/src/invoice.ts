import { z } from 'zod';
import { formatQty, formatRupiah } from './money.js';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const text = (max: number) => z.preprocess(emptyToNull, z.string().trim().max(max).nullable());
const isoDate = z.preprocess(
  emptyToNull,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date')
    .nullable(),
);

export const invoiceLineSchema = z.object({
  description: z.string().trim().min(1, 'Description is required').max(300),
  product_id: z.number().int().positive().nullable(),
  qty_milli: z.number().int('Quantity is in thousandths, a whole number').positive('Quantity must be more than zero'),
  unit: text(20),
  unit_price: z.number().int('Unit price must be whole Rupiah').min(0),
  amount: z.number().int('Amount must be whole Rupiah').min(0),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** What a supplier invoice says, as extracted from its PDF and then corrected by a person. */
export const invoiceDataSchema = z.object({
  supplier_name: text(200),
  supplier_npwp: text(30),
  invoice_number: text(60),
  invoice_date: isoDate,
  due_date: isoDate,
  lines: z.array(invoiceLineSchema).max(500),
  subtotal: z.number().int().min(0).nullable(),
  discount: z.number().int().min(0),
  ppn_rate: z.number().min(0).max(100).nullable(),
  ppn: z.number().int().min(0).nullable(),
  total: z.number().int().min(0).nullable(),
});
export type InvoiceData = z.infer<typeof invoiceDataSchema>;

/** Header fields the extractor looks for; `found` maps each to the PDF line it came from. */
export const INVOICE_FIELDS = [
  'supplier_name',
  'supplier_npwp',
  'invoice_number',
  'invoice_date',
  'due_date',
  'subtotal',
  'discount',
  'ppn',
  'total',
] as const;
export type InvoiceField = (typeof INVOICE_FIELDS)[number];
export type FoundFields = Record<InvoiceField, string | null>;

export const INVOICE_STATUSES = ['review', 'confirmed', 'rejected'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoiceListQuerySchema = z.object({
  status: z.enum([...INVOICE_STATUSES, 'all']).default('all'),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const rejectInvoiceSchema = z.object({
  reason: z.string().trim().min(1, 'Say why it is rejected').max(500),
});

export interface InvoiceIssue {
  level: 'error' | 'warning';
  /** A header field, or `lines.<index>` for a line. */
  field: string;
  message: string;
}

export interface InvoiceExtractionSummary {
  id: number;
  file_name: string;
  status: InvoiceStatus;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number | null;
  errors: number;
  warnings: number;
  uploaded_by_name: string;
  created_at: string;
}

export interface InvoiceExtraction extends InvoiceExtractionSummary {
  page_count: number;
  file_size: number;
  data: InvoiceData;
  /** What the extractor produced, kept unchanged so corrections stay visible. */
  extracted: InvoiceData;
  found: FoundFields;
  issues: InvoiceIssue[];
  raw_text: string;
  rejected_reason: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  /** Another extraction with the same supplier and invoice number, if any. */
  duplicate_of: { id: number; status: InvoiceStatus } | null;
  updated_at: string;
}

export const sumLines = (d: InvoiceData) => d.lines.reduce((s, l) => s + l.amount, 0);

/**
 * Checks an invoice before it can be confirmed. Errors block confirmation;
 * warnings are worth a look but can be accepted. The API enforces this on
 * confirm, and the review screen runs it live as fields are corrected.
 */
export function checkInvoice(d: InvoiceData): InvoiceIssue[] {
  const issues: InvoiceIssue[] = [];
  const error = (field: string, message: string) => issues.push({ level: 'error', field, message });
  const warn = (field: string, message: string) => issues.push({ level: 'warning', field, message });

  if (!d.supplier_name) error('supplier_name', 'Supplier name is missing.');
  if (!d.invoice_number) error('invoice_number', 'Invoice number is missing.');
  if (!d.invoice_date) error('invoice_date', 'Invoice date is missing.');
  if (d.invoice_date && d.due_date && d.due_date < d.invoice_date) {
    error('due_date', 'The due date is before the invoice date.');
  }
  if (d.lines.length === 0) error('lines', 'The invoice has no lines.');
  if (d.subtotal === null) error('subtotal', 'Subtotal (DPP) is missing.');
  if (d.total === null) error('total', 'Total is missing.');

  d.lines.forEach((l, i) => {
    const expected = Math.round((l.qty_milli * l.unit_price) / 1000);
    if (Math.abs(expected - l.amount) > 1) {
      warn(
        `lines.${i}`,
        `Line ${i + 1}: ${formatQty(l.qty_milli)} × ${formatRupiah(l.unit_price)} is ${formatRupiah(expected)}, but the line says ${formatRupiah(l.amount)}.`,
      );
    }
    if (l.product_id === null) warn(`lines.${i}`, `Line ${i + 1} is not matched to a product.`);
  });

  const lines = sumLines(d);
  if (d.subtotal !== null && d.lines.length > 0 && Math.abs(lines - d.subtotal) > d.lines.length) {
    error('subtotal', `The lines add up to ${formatRupiah(lines)}, but the subtotal says ${formatRupiah(d.subtotal)}.`);
  }
  if (d.subtotal !== null && d.total !== null) {
    const expected = d.subtotal - d.discount + (d.ppn ?? 0);
    if (Math.abs(expected - d.total) > 1) {
      error(
        'total',
        `Subtotal − discount + PPN is ${formatRupiah(expected)}, but the total says ${formatRupiah(d.total)}.`,
      );
    }
  }
  if (d.subtotal !== null && d.ppn !== null && d.ppn_rate !== null) {
    const expected = Math.round(((d.subtotal - d.discount) * d.ppn_rate) / 100);
    if (Math.abs(expected - d.ppn) > 1) {
      warn('ppn', `PPN ${d.ppn_rate}% of ${formatRupiah(d.subtotal - d.discount)} is ${formatRupiah(expected)}, but the invoice says ${formatRupiah(d.ppn)}.`);
    }
  }
  if ((d.ppn ?? 0) > 0 && !d.supplier_npwp) warn('supplier_npwp', 'PPN is charged but no supplier NPWP was found.');
  return issues;
}
