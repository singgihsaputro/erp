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
