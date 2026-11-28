import { z } from 'zod';

export const PROMOTION_KINDS = ['percent', 'fixed', 'buy_x_get_y'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];
export const PROMOTION_KIND_LABELS: Record<PromotionKind, string> = { percent: 'Percentage off', fixed: 'Rp off per unit', buy_x_get_y: 'Buy X get Y free' };

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD').refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), 'Not a real date');
const qty = (label: string) => z.number().int(`${label} must be a whole number of thousandths`).min(1, `${label} must be above zero`).max(1_000_000_000);

export const promotionInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    kind: z.enum(PROMOTION_KINDS),
    product_id: z.number().int().min(1),
    percent_off: z.number().int('Percentage must be whole').min(1, 'Percentage must be at least 1').max(100, 'Percentage cannot pass 100').optional(),
    /** Rupiah off per base unit, excluding PPN. */
    amount_off: z.number().int('Amount must be whole Rupiah').min(1, 'Amount must be above zero').max(1_000_000_000).optional(),
    buy_qty_milli: qty('Buy quantity').optional(),
    free_qty_milli: qty('Free quantity').optional(),
    /** Smallest quantity a percentage or fixed discount needs. */
    min_qty_milli: qty('Minimum quantity').default(1000),
    starts_on: day,
    ends_on: day,
  })
  .superRefine((v, ctx) => {
    const need = (ok: boolean, path: string, message: string) => ok || ctx.addIssue({ code: 'custom', path: [path], message });
    if (v.kind === 'percent') need(v.percent_off !== undefined, 'percent_off', 'Percentage is required');
    if (v.kind === 'fixed') need(v.amount_off !== undefined, 'amount_off', 'Amount off is required');
    if (v.kind === 'buy_x_get_y') {
      need(v.buy_qty_milli !== undefined, 'buy_qty_milli', 'Buy quantity is required');
      need(v.free_qty_milli !== undefined, 'free_qty_milli', 'Free quantity is required');
    }
    need(v.ends_on >= v.starts_on, 'ends_on', 'End date cannot be before the start date');
  });
export type PromotionInput = z.input<typeof promotionInputSchema>;

export const promotionQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['scheduled', 'running', 'ended', 'disabled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const promotionEvaluateQuerySchema = z.object({
  product_id: z.coerce.number().int().min(1),
  qty_milli: z.coerce.number().int().min(1).default(1000),
  /** Defaults to the product's normal price. */
  unit_price: z.coerce.number().int().min(0).optional(),
  /** Business day, defaults to today in Asia/Jakarta. */
  date: day.optional(),
});

export type PromotionStatus = 'scheduled' | 'running' | 'ended' | 'disabled';

export interface Promotion {
  id: number;
  name: string;
  kind: PromotionKind;
  product_id: number;
  product_sku: string;
  product_name: string;
  base_unit: string;
  percent_off: number | null;
  amount_off: number | null;
  buy_qty_milli: number | null;
  free_qty_milli: number | null;
  min_qty_milli: number;
  starts_on: string;
  ends_on: string;
  active: boolean;
  status: PromotionStatus;
  created_at: string;
  updated_at: string;
}

export interface PromotionOffer {
  promotion_id: number;
  name: string;
  kind: PromotionKind;
  /** Rupiah taken off the line, excluding PPN. */
  discount: number;
  /** Quantity handed over free (buy X get Y), in thousandths. */
  free_qty_milli: number;
}

export interface PromotionEvaluation {
  product_id: number;
  qty_milli: number;
  unit_price: number;
  date: string;
  line_total: number;
  /** The offer with the largest discount; promotions do not stack. */
  best: PromotionOffer | null;
  offers: PromotionOffer[];
  net_total: number;
}
