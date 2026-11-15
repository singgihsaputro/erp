import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-31').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a real date');

export const batchReceiptSchema = z.object({
  product_id: z.number().int().min(1),
  warehouse_id: z.number().int().min(1),
  batch_no: z.string().trim().min(1, 'Batch number is required').max(40),
  /** Last day the goods are good; empty for goods that do not expire. */
  expiry_date: isoDate.nullish(),
  /** Quantity in thousandths of the base unit. */
  qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
  unit_cost: z.number().int('Cost must be whole Rupiah').min(0),
});
export type BatchReceiptInput = z.input<typeof batchReceiptSchema>;

export const batchListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  product_id: z.coerce.number().int().min(1).optional(),
  warehouse_id: z.coerce.number().int().min(1).optional(),
  /** expired = past expiry, soon = expires within `days`, all = everything with stock. */
  filter: z.enum(['all', 'soon', 'expired']).default('all'),
  days: z.coerce.number().int().min(1).max(730).default(30),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const batchPickQuerySchema = z.object({
  product_id: z.coerce.number().int().min(1),
  warehouse_id: z.coerce.number().int().min(1),
  qty_milli: z.coerce.number().int().min(1).max(1_000_000_000),
});

export type BatchStatus = 'expired' | 'soon' | 'ok' | 'none';

export interface BatchRow {
  batch_id: number;
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  batch_no: string;
  expiry_date: string | null;
  warehouse_id: number;
  warehouse_name: string;
  qty_milli: number;
  /** Whole days until expiry (negative once expired); null without an expiry date. */
  days_left: number | null;
  status: BatchStatus;
}

export interface BatchList {
  items: BatchRow[];
  total: number;
  page: number;
  page_size: number;
  expired_count: number;
  soon_count: number;
  /** Today in Asia/Jakarta, YYYY-MM-DD. */
  today: string;
}

export interface BatchPick {
  allocations: { batch_id: number; batch_no: string; expiry_date: string | null; qty_milli: number }[];
  /** Part of the request that no good batch can cover. */
  shortfall_milli: number;
  /** Quantity skipped because its batch is already expired. */
  expired_milli: number;
}
