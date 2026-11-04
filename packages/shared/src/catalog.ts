import { z } from 'zod';

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

export interface Category {
  id: number;
  name: string;
  product_count: number;
  created_at: string;
  updated_at: string;
}

const unitCode = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(20)
  .regex(/^[\p{L}\p{N}._-]+$/u, 'Use letters, digits, dot, dash or underscore only');

export const unitCreateSchema = z.object({
  code: unitCode,
  name: z.string().trim().min(1, 'Name is required').max(60),
});
export const unitUpdateSchema = unitCreateSchema.pick({ name: true });
export type UnitInput = z.infer<typeof unitCreateSchema>;

export interface Unit {
  id: number;
  code: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** 1 <unit> = factor_milli / 1000 of the product's base unit (1 box of 12 pcs: 12000). */
export const productUnitInputSchema = z.object({
  unit: unitCode,
  factor_milli: z.number().int('Factor must be a whole number of thousandths').min(1, 'Factor must be positive').max(1_000_000_000),
});
export type ProductUnitInput = z.infer<typeof productUnitInputSchema>;

export const productUnitsInputSchema = z.object({
  units: z.array(productUnitInputSchema).max(20),
});

export interface ProductUnit {
  unit: string;
  factor_milli: number;
}

/** Converts a quantity in thousandths of `unit` to thousandths of the base unit; null if not whole. */
export function toBaseMilli(qtyMilli: number, factorMilli: number): number | null {
  const base = (qtyMilli * factorMilli) / 1000;
  return Number.isInteger(base) ? base : null;
}
