import { z } from 'zod';

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, 'SKU is required').max(40),
  barcode: z.preprocess(emptyToNull, z.string().trim().max(40).nullable().optional()).transform((v) => v ?? null),
  name: z.string().trim().min(1, 'Name is required').max(200),
  base_unit: z.string().trim().min(1, 'Base unit is required').max(20),
  cost: z.number().int('Cost must be whole Rupiah').min(0),
  price: z.number().int('Price must be whole Rupiah').min(0),
});
export type ProductInput = z.infer<typeof productInputSchema>;

export const productStatusSchema = z.enum(['active', 'archived', 'all']);

export const productListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: productStatusSchema.default('active'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export interface Product {
  id: number;
  sku: string;
  barcode: string | null;
  name: string;
  base_unit: string;
  cost: number;
  price: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
