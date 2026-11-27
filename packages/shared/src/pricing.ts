import { z } from 'zod';
import { PRICE_TIERS, type PriceTier } from './customer.js';

export const priceRuleInputSchema = z.object({
  product_id: z.number().int().min(1),
  tier: z.enum(PRICE_TIERS),
  /** The rule applies from this quantity, in thousandths of the base unit. */
  min_qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Minimum quantity must be above zero').max(1_000_000_000).default(1000),
  /** Price per base unit in Rupiah, excluding PPN. */
  price: z.number().int('Price must be whole Rupiah').min(0, 'Price cannot be negative').max(1_000_000_000),
});
export type PriceRuleInput = z.input<typeof priceRuleInputSchema>;

export const priceListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const priceResolveQuerySchema = z.object({
  customer_id: z.coerce.number().int().min(1),
  product_id: z.coerce.number().int().min(1),
  qty_milli: z.coerce.number().int().min(1).default(1000),
});

export interface PriceRule {
  id: number;
  product_id: number;
  tier: PriceTier;
  min_qty_milli: number;
  price: number;
}

export interface PriceListProduct {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  /** The normal selling price, used when no rule applies. */
  price: number;
  rules: PriceRule[];
}

export interface ResolvedPrice {
  product_id: number;
  tier: PriceTier;
  qty_milli: number;
  unit_price: number;
  /** Which price won: a rule of the customer's tier, a retail quantity break, or the product's normal price. */
  source: 'tier_rule' | 'retail_rule' | 'base';
  rule_id: number | null;
  min_qty_milli: number | null;
}
