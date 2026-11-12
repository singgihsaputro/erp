import { z } from 'zod';

export const openingLineSchema = z.object({
  product_id: z.number().int().min(1),
  /** Quantity in thousandths of the product's base unit. */
  qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
  /** Cost per base unit in whole Rupiah. */
  unit_cost: z.number().int('Cost must be whole Rupiah').min(0),
});

export const openingInputSchema = z.object({
  warehouse_id: z.number().int().min(1),
  note: z.string().trim().max(200).default(''),
  lines: z.array(openingLineSchema).min(1, 'Add at least one line').max(500),
});
export type OpeningInput = z.input<typeof openingInputSchema>;

export const stockListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  warehouse_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface StockRow {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  qty_milli: number;
  /** Moving-average cost per base unit, in Rupiah. */
  avg_cost: number;
  /** qty × average cost, in Rupiah. */
  value: number;
}

export interface StockMoveRow {
  id: number;
  created_at: string;
  warehouse_id: number;
  warehouse_code: string;
  qty_milli: number;
  unit_cost: number;
  source_type: string;
  source_id: number | null;
  note: string;
  /** On-hand after this move: in the filtered warehouse, or in all warehouses. */
  balance_milli: number;
  /** Moving-average cost of the product (all warehouses) after this move. */
  avg_cost_after: number;
}

export interface StockHistory {
  product: { id: number; sku: string; name: string; base_unit: string; cost: number };
  moves: StockMoveRow[];
}

/** Moving average after an inbound move; `onHand` is the product's total before it. */
export function nextAverageCost(onHandMilli: number, avgCost: number, inMilli: number, inCost: number): number {
  if (onHandMilli <= 0) return inCost;
  return Math.round((onHandMilli * avgCost + inMilli * inCost) / (onHandMilli + inMilli));
}

export const ADJUSTMENT_REASONS = [
  ['damaged', 'Damaged'],
  ['lost', 'Lost'],
  ['expired', 'Expired'],
  ['correction', 'Correction'],
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number][0];

export const adjustmentLineSchema = z.object({
  product_id: z.number().int().min(1),
  /** Signed, in thousandths of the base unit: negative removes stock, positive adds it. */
  qty_milli: z
    .number()
    .int('Quantity must be a whole number of thousandths')
    .refine((n) => n !== 0, 'Quantity cannot be zero')
    .refine((n) => Math.abs(n) <= 1_000_000_000, 'Quantity is too large'),
  /** Cost per base unit for added stock; defaults to the current average. Ignored when removing. */
  unit_cost: z.number().int('Cost must be whole Rupiah').min(0).optional(),
});

export const adjustmentInputSchema = z
  .object({
    warehouse_id: z.number().int().min(1),
    reason: z.enum(['damaged', 'lost', 'expired', 'correction']),
    note: z.string().trim().max(200).default(''),
    lines: z.array(adjustmentLineSchema).min(1, 'Add at least one line').max(200),
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'correction') return;
    v.lines.forEach((l, i) => {
      if (l.qty_milli > 0) ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty_milli'], message: `Stock that is ${v.reason} can only be removed; use Correction to add` });
    });
  });
export type AdjustmentInput = z.input<typeof adjustmentInputSchema>;

export const adjustmentListQuerySchema = z.object({
  warehouse_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface AdjustmentSummary {
  id: number;
  number: string;
  created_at: string;
  warehouse_id: number;
  warehouse_name: string;
  reason: AdjustmentReason;
  note: string;
  created_by_name: string;
  line_count: number;
  /** Signed value of the change at the booked costs, in Rupiah. */
  value: number;
}

export interface AdjustmentLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_cost: number;
}

export interface AdjustmentDetail extends AdjustmentSummary {
  lines: AdjustmentLine[];
}

export const TRANSFER_STATUSES = [
  ['in_transit', 'In transit'],
  ['received', 'Received'],
  ['cancelled', 'Cancelled'],
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number][0];

export const transferInputSchema = z
  .object({
    from_warehouse_id: z.number().int().min(1),
    to_warehouse_id: z.number().int().min(1),
    note: z.string().trim().max(200).default(''),
    lines: z
      .array(
        z.object({
          product_id: z.number().int().min(1),
          /** Quantity in thousandths of the base unit. */
          qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
        }),
      )
      .min(1, 'Add at least one line')
      .max(200),
  })
  .refine((v) => v.from_warehouse_id !== v.to_warehouse_id, { path: ['to_warehouse_id'], message: 'Choose a different destination warehouse' });
export type TransferInput = z.input<typeof transferInputSchema>;

export const transferListQuerySchema = z.object({
  status: z.enum(['in_transit', 'received', 'cancelled']).optional(),
  warehouse_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface TransferSummary {
  id: number;
  number: string;
  created_at: string;
  status: TransferStatus;
  from_warehouse_id: number;
  from_warehouse_name: string;
  to_warehouse_id: number;
  to_warehouse_name: string;
  note: string;
  created_by_name: string;
  received_at: string | null;
  cancelled_at: string | null;
  line_count: number;
  /** Value of the goods at the cost booked when they were sent, in Rupiah. */
  value: number;
}

export interface TransferLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_cost: number;
}

export interface TransferDetail extends TransferSummary {
  lines: TransferLine[];
}
