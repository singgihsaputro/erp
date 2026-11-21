import { z } from 'zod';

export const QUOTE_STATUSES = [
  ['draft', 'Draft'],
  ['sent', 'Sent to customer'],
  ['converted', 'Converted to order'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number][0];

export const SO_STATUSES = [
  ['open', 'Open'],
  ['cancelled', 'Cancelled'],
] as const;
export type SoStatus = (typeof SO_STATUSES)[number][0];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Not a real date');

const saleLines = z
  .array(
    z.object({
      product_id: z.number().int().min(1),
      /** Quantity in thousandths of the base unit. */
      qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
      /** Price per base unit in Rupiah, excluding PPN. */
      unit_price: z.number().int('Price must be whole Rupiah').min(0, 'Price cannot be negative').max(1_000_000_000),
    }),
  )
  .min(1, 'Add at least one line')
  .max(200);

export const quotationInputSchema = z
  .object({
    customer_id: z.number().int().min(1),
    warehouse_id: z.number().int().min(1),
    quote_date: isoDate.optional(),
    /** Defaults to 14 days after the quote date. */
    valid_until: isoDate.optional(),
    note: z.string().trim().max(200).default(''),
    lines: saleLines,
  })
  .refine((v) => !v.quote_date || !v.valid_until || v.valid_until >= v.quote_date, { path: ['valid_until'], message: 'Valid-until date cannot be before the quote date' });
export type QuotationInput = z.input<typeof quotationInputSchema>;

export const salesOrderInputSchema = z.object({
  customer_id: z.number().int().min(1),
  warehouse_id: z.number().int().min(1),
  order_date: isoDate.optional(),
  delivery_date: isoDate.nullable().optional(),
  note: z.string().trim().max(200).default(''),
  lines: saleLines,
});
export type SalesOrderInput = z.input<typeof salesOrderInputSchema>;

export const quotationListQuerySchema = z.object({
  status: z.enum(['draft', 'sent', 'converted', 'rejected', 'cancelled']).optional(),
  customer_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});
export const salesOrderListQuerySchema = z.object({
  status: z.enum(['open', 'cancelled']).optional(),
  customer_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface SaleLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  unit_price: number;
  amount: number;
}

interface SaleDocSummary {
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  warehouse_id: number;
  warehouse_name: string;
  note: string;
  created_by_name: string;
  ppn_rate_bp: number;
  line_count: number;
  /** DPP: the sum of the lines, before PPN, in Rupiah. */
  dpp: number;
  ppn: number;
  total: number;
}

export interface QuotationSummary extends SaleDocSummary {
  status: QuoteStatus;
  quote_date: string;
  valid_until: string;
  /** Still draft or sent, but past its valid-until date, so it can no longer be converted. */
  expired: boolean;
  sales_order_id: number | null;
  sales_order_number: string | null;
}
export interface QuotationDetail extends QuotationSummary {
  customer_address: string;
  customer_npwp: string;
  lines: SaleLine[];
}

export interface SalesOrderSummary extends SaleDocSummary {
  status: SoStatus;
  order_date: string;
  delivery_date: string | null;
  quotation_id: number | null;
  quotation_number: string | null;
  cancelled_at: string | null;
}
export interface SalesOrderLine extends SaleLine {
  /** Stock in the order's warehouse that is on hand, and how much of it open orders hold (this order included). */
  on_hand_milli: number;
  reserved_milli: number;
}
export interface SalesOrderDetail extends SalesOrderSummary {
  customer_address: string;
  customer_npwp: string;
  lines: SalesOrderLine[];
}

export interface Availability {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  price: number;
  on_hand_milli: number;
  reserved_milli: number;
  available_milli: number;
}
