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
