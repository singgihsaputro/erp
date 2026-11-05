import { z } from 'zod';

export const warehouseInputSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Code is required')
    .max(20)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore only'),
  name: z.string().trim().min(1, 'Name is required').max(80),
  address: z.string().trim().max(300).default(''),
});
export type WarehouseInput = z.input<typeof warehouseInputSchema>;

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  address: string;
  is_default: boolean;
  archived_at: string | null;
  /** Products with a non-zero balance here. */
  product_count: number;
  /** Sum of on-hand quantities, in thousandths (mixed units, a rough size only). */
  stock_milli: number;
  /** On-hand value at the moves' unit cost, in Rupiah. */
  stock_value: number;
  move_count: number;
  created_at: string;
  updated_at: string;
}

export interface WarehouseStockRow {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
}
