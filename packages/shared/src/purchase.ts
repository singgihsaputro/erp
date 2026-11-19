import { z } from 'zod';

export const PO_STATUSES = [
  ['draft', 'Draft'],
  ['submitted', 'Waiting for approval'],
  ['approved', 'Approved'],
  ['cancelled', 'Cancelled'],
] as const;
export type PoStatus = (typeof PO_STATUSES)[number][0];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a real date');

export const poInputSchema = z
  .object({
    supplier_id: z.number().int().min(1),
    warehouse_id: z.number().int().min(1),
    order_date: isoDate.optional(),
    expected_date: isoDate.nullable().optional(),
    note: z.string().trim().max(200).default(''),
    lines: z
      .array(
        z.object({
          product_id: z.number().int().min(1),
          /** Quantity in thousandths of the base unit. */
          qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
          /** Price per base unit in Rupiah, excluding PPN. */
          unit_cost: z.number().int('Price must be whole Rupiah').min(0, 'Price cannot be negative').max(1_000_000_000),
        }),
      )
      .min(1, 'Add at least one line')
      .max(200),
  })
  .refine((v) => !v.order_date || !v.expected_date || v.expected_date >= v.order_date, { path: ['expected_date'], message: 'Expected date cannot be before the order date' });
export type PoInput = z.input<typeof poInputSchema>;

export const poListQuerySchema = z.object({
  status: z.enum(['draft', 'submitted', 'approved', 'cancelled']).optional(),
  supplier_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface PoSummary {
  id: number;
  number: string;
  status: PoStatus;
  supplier_id: number;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  order_date: string;
  expected_date: string | null;
  note: string;
  created_by_name: string;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  cancelled_at: string | null;
  ppn_rate_bp: number;
  line_count: number;
  /** How much of the order has arrived so far. */
  receive_status: ReceiveStatus;
  /** DPP: the sum of the lines, before PPN, in Rupiah. */
  dpp: number;
  ppn: number;
  total: number;
}

export interface PoLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_cost: number;
  amount: number;
  /** Quantity received so far on goods receipts. */
  received_milli: number;
}

export interface PoDetail extends PoSummary {
  supplier_address: string;
  supplier_npwp: string;
  lines: PoLine[];
}

// ---- Goods receipt (F017) ----

export const grInputSchema = z.object({
  order_id: z.number().int().min(1),
  receipt_date: isoDate.optional(),
  /** The supplier's own delivery note number. */
  supplier_ref: z.string().trim().max(60).default(''),
  note: z.string().trim().max(200).default(''),
  lines: z
    .array(
      z.object({
        product_id: z.number().int().min(1),
        /** Quantity received now, in thousandths of the base unit. */
        qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
      }),
    )
    .min(1, 'Receive at least one line')
    .max(200),
});
export type GrInput = z.input<typeof grInputSchema>;

export const grListQuerySchema = z.object({
  order_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface GrSummary {
  id: number;
  number: string;
  order_id: number;
  order_number: string;
  supplier_name: string;
  warehouse_id: number;
  warehouse_name: string;
  receipt_date: string;
  supplier_ref: string;
  note: string;
  received_by_name: string;
  created_at: string;
  line_count: number;
  /** Value received at cost, excluding PPN. */
  value: number;
}

export interface GrLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_cost: number;
  amount: number;
}

export interface GrDetail extends GrSummary {
  lines: GrLine[];
}

export type ReceiveStatus = 'none' | 'partial' | 'complete';

// ---- Supplier invoice (F018) ----

export const siInputSchema = z
  .object({
    receipt_id: z.number().int().min(1),
    /** The number printed on the supplier's invoice. */
    supplier_invoice_no: z.string().trim().min(1, 'The supplier invoice number is required').max(60),
    invoice_date: isoDate,
    /** Defaults to the invoice date plus the supplier's payment terms. */
    due_date: isoDate.nullable().optional(),
    note: z.string().trim().max(200).default(''),
    /** The total (incl. PPN) the supplier printed, to be checked against the lines. */
    stated_total: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
    /** A confirmed PDF from the invoice inbox this invoice is created from. */
    extraction_id: z.number().int().min(1).nullable().optional(),
    lines: z
      .array(
        z.object({
          product_id: z.number().int().min(1),
          /** Quantity billed, in thousandths of the base unit. */
          qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
          /** Billed price per base unit in Rupiah, excluding PPN. */
          unit_cost: z.number().int('Price must be whole Rupiah').min(0, 'Price cannot be negative').max(1_000_000_000),
        }),
      )
      .min(1, 'Add at least one line')
      .max(200),
  })
  .refine((v) => !v.due_date || v.due_date >= v.invoice_date, { path: ['due_date'], message: 'Due date cannot be before the invoice date' });
export type SiInput = z.input<typeof siInputSchema>;

export const siListQuerySchema = z.object({
  status: z.enum(['open', 'overdue', 'paid', 'all']).default('all'),
  supplier_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface SiSummary {
  id: number;
  number: string;
  supplier_invoice_no: string;
  supplier_id: number;
  supplier_name: string;
  receipt_id: number;
  receipt_number: string;
  order_number: string;
  invoice_date: string;
  due_date: string;
  dpp: number;
  ppn: number;
  total: number;
  amount_paid: number;
  /** What is still owed: total minus payments. */
  outstanding: number;
  status: 'open' | 'overdue' | 'paid';
  /** How many three-way match warnings the invoice has. */
  warning_count: number;
  created_at: string;
}

export interface SiMatchWarning {
  /** Product id, or null for a warning about the whole invoice. */
  product_id: number | null;
  kind: 'qty' | 'price' | 'not_invoiced' | 'total';
  message: string;
}

export interface SiLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_cost: number;
  amount: number;
  /** What the goods receipt booked for this product (null if not received). */
  received_milli: number | null;
  /** The price on the goods receipt, i.e. the purchase order price. */
  receipt_unit_cost: number | null;
}

export interface SiDetail extends SiSummary {
  note: string;
  ppn_rate_bp: number;
  stated_total: number | null;
  extraction_id: number | null;
  created_by_name: string;
  lines: SiLine[];
  warnings: SiMatchWarning[];
}

export interface SiPayableSummary {
  open_count: number;
  overdue_count: number;
  outstanding: number;
  overdue_outstanding: number;
}

/** A goods receipt that has not been invoiced yet. */
export interface SiReceiptOption {
  id: number;
  number: string;
  order_number: string;
  supplier_id: number;
  supplier_name: string;
  receipt_date: string;
  value: number;
}

/** A confirmed inbox PDF that has not been turned into an invoice yet. */
export interface SiExtractionOption {
  id: number;
  file_name: string;
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: number | null;
}

/** What the form starts from when an inbox PDF is chosen. */
export interface SiPrefill {
  extraction_id: number;
  supplier_id: number | null;
  /** The uninvoiced receipt that best fits the PDF, if any. */
  receipt_id: number | null;
  supplier_invoice_no: string;
  invoice_date: string | null;
  due_date: string | null;
  stated_total: number | null;
  lines: { product_id: number; qty_milli: number; unit_cost: number }[];
  /** Lines of the PDF that were not matched to a product and are left out. */
  skipped_lines: number;
}

// ---- Supplier payments (F019) ----

export const PAYMENT_METHODS = [
  ['transfer', 'Bank transfer'],
  ['cash', 'Cash'],
  ['giro', 'Giro'],
] as const;

export const spInputSchema = z.object({
  supplier_id: z.number().int().min(1),
  payment_date: isoDate,
  method: z.enum(['transfer', 'cash', 'giro']),
  /** Bank reference, transfer number or giro number. */
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(200).default(''),
  allocations: z
    .array(
      z.object({
        invoice_id: z.number().int().min(1),
        amount: z.number().int('Amount must be whole Rupiah').min(1, 'Amount must be above zero').max(100_000_000_000),
      }),
    )
    .min(1, 'Choose at least one invoice to pay')
    .max(100),
});
export type SpInput = z.input<typeof spInputSchema>;

export const spListQuerySchema = z.object({
  supplier_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface SpSummary {
  id: number;
  number: string;
  supplier_id: number;
  supplier_name: string;
  payment_date: string;
  method: 'transfer' | 'cash' | 'giro';
  reference: string;
  total: number;
  invoice_count: number;
  created_at: string;
}

export interface SpAllocation {
  invoice_id: number;
  invoice_number: string;
  supplier_invoice_no: string;
  amount: number;
}

export interface SpDetail extends SpSummary {
  note: string;
  created_by_name: string;
  allocations: SpAllocation[];
}

/** An unpaid invoice that a payment can settle. */
export interface SpOpenInvoice {
  id: number;
  number: string;
  supplier_invoice_no: string;
  invoice_date: string;
  due_date: string;
  total: number;
  outstanding: number;
  days_overdue: number;
}

export const AGING_BUCKETS = [
  ['current', 'Not yet due'],
  ['d1_30', '1–30 days'],
  ['d31_60', '31–60 days'],
  ['d61_90', '61–90 days'],
  ['d90_plus', 'Over 90 days'],
] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number][0];

export interface AgingRow {
  supplier_id: number;
  supplier_name: string;
  invoice_count: number;
  total: number;
  buckets: Record<AgingBucket, number>;
}

export interface AgingReport {
  as_of: string;
  rows: AgingRow[];
  totals: Record<AgingBucket, number> & { total: number };
}
