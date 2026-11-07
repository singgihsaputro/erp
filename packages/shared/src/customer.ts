import { z } from 'zod';
import { PAYMENT_TERMS, npwpField, type PaymentTerms } from './supplier.js';

export const PRICE_TIERS = ['retail', 'grosir', 'member'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
export const PRICE_TIER_LABELS: Record<PriceTier, string> = { retail: 'Retail', grosir: 'Grosir', member: 'Member' };

export const customerInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  contact_person: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.union([z.literal(''), z.string().trim().max(120).email('Enter a valid email')]).default(''),
  address: z.string().trim().max(300).default(''),
  npwp: npwpField,
  /** Maximum open receivables in whole Rupiah; 0 means no credit. */
  credit_limit: z.number().int('Credit limit must be whole Rupiah').min(0, 'Credit limit cannot be negative').max(100_000_000_000).default(0),
  payment_terms: z.enum(PAYMENT_TERMS).default('cash'),
  price_tier: z.enum(PRICE_TIERS).default('retail'),
  note: z.string().trim().max(300).default(''),
});
export type CustomerInput = z.input<typeof customerInputSchema>;

export interface Customer {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  npwp: string;
  credit_limit: number;
  payment_terms: PaymentTerms;
  price_tier: PriceTier;
  note: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
