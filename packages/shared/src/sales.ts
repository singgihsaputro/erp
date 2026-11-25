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
  delivery_status: 'none' | 'partial' | 'complete';
  ordered_milli: number;
  delivered_milli: number;
}
export interface SalesOrderLine extends SaleLine {
  /** Stock in the order's warehouse that is on hand, and how much of it open orders hold (this order included). */
  on_hand_milli: number;
  reserved_milli: number;
  /** Already delivered on Surat Jalan; what is still to deliver is qty_milli minus this. */
  delivered_milli: number;
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

// ---------- Surat Jalan (delivery notes) ----------

export const deliveryInputSchema = z.object({
  order_id: z.number().int().min(1),
  delivery_date: isoDate.optional(),
  driver: z.string().trim().max(80).default(''),
  vehicle: z.string().trim().max(40).default(''),
  note: z.string().trim().max(200).default(''),
  lines: z
    .array(
      z.object({
        product_id: z.number().int().min(1),
        qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
      }),
    )
    .min(1, 'Deliver at least one line')
    .max(200),
});
export type DeliveryInput = z.input<typeof deliveryInputSchema>;

export const deliveryListQuerySchema = z.object({
  order_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface DeliverySummary {
  id: number;
  number: string;
  order_id: number;
  order_number: string;
  customer_name: string;
  warehouse_name: string;
  delivery_date: string;
  driver: string;
  vehicle: string;
  note: string;
  delivered_by_name: string;
  line_count: number;
  created_at: string;
}
export interface DeliveryLine {
  product_id: number;
  sku: string;
  name: string;
  base_unit: string;
  qty_milli: number;
  /** Ordered on the sales order. */
  ordered_milli: number;
}
export interface DeliveryDetail extends DeliverySummary {
  customer_address: string;
  customer_npwp: string;
  lines: DeliveryLine[];
}

// ---------- Sales invoices (Faktur) ----------

export const salesInvoiceInputSchema = z.object({
  order_id: z.number().int().min(1),
  invoice_date: isoDate.optional(),
  note: z.string().trim().max(200).default(''),
  lines: z
    .array(
      z.object({
        product_id: z.number().int().min(1),
        qty_milli: z.number().int('Quantity must be a whole number of thousandths').min(1, 'Quantity must be above zero').max(1_000_000_000),
      }),
    )
    .min(1, 'Invoice at least one line')
    .max(200),
});
export type SalesInvoiceInput = z.input<typeof salesInvoiceInputSchema>;

export const salesInvoiceListQuerySchema = z.object({
  customer_id: z.coerce.number().int().min(1).optional(),
  order_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface SalesInvoiceSummary {
  id: number;
  number: string;
  order_id: number;
  order_number: string;
  customer_id: number;
  customer_name: string;
  invoice_date: string;
  due_date: string;
  payment_terms: string;
  note: string;
  created_by_name: string;
  ppn_rate_bp: number;
  line_count: number;
  dpp: number;
  ppn: number;
  total: number;
  /** Settled by customer payments (F024). */
  amount_paid: number;
  outstanding: number;
}
export interface SalesInvoiceDetail extends SalesInvoiceSummary {
  customer_address: string;
  customer_npwp: string;
  lines: SaleLine[];
}
/** What can still be invoiced on an order: delivered minus invoiced, at the order price. */
export interface InvoiceableLine extends SaleLine {
  delivered_milli: number;
  invoiced_milli: number;
  invoiceable_milli: number;
}
export interface InvoiceableOrder {
  order_id: number;
  order_number: string;
  customer_name: string;
  payment_terms: string;
  ppn_rate_bp: number;
  lines: InvoiceableLine[];
}

// ---- Customer payments and receivables (F024) ----

export const cpInputSchema = z.object({
  customer_id: z.number().int().min(1),
  payment_date: isoDate,
  method: z.enum(['transfer', 'cash', 'giro']),
  /** Bank reference, transfer number or giro number. */
  reference: z.string().trim().max(60).default(''),
  note: z.string().trim().max(200).default(''),
  allocations: z
    .array(
      z.object({
        invoice_id: z.number().int().min(1),
        amount: z.number().int('Amount must be whole Rupiah').min(1, 'Amount must be above zero').max(100_000_000_000),
      }),
    )
    .min(1, 'Choose at least one invoice to settle')
    .max(100),
});
export type CpInput = z.input<typeof cpInputSchema>;

export const cpListQuerySchema = z.object({
  customer_id: z.coerce.number().int().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export interface CpSummary {
  id: number;
  number: string;
  customer_id: number;
  customer_name: string;
  payment_date: string;
  method: 'transfer' | 'cash' | 'giro';
  reference: string;
  total: number;
  invoice_count: number;
  created_at: string;
}

export interface CpAllocation {
  invoice_id: number;
  invoice_number: string;
  amount: number;
}

export interface CpDetail extends CpSummary {
  note: string;
  created_by_name: string;
  allocations: CpAllocation[];
}

/** An unpaid sales invoice that a customer payment can settle. */
export interface CpOpenInvoice {
  id: number;
  number: string;
  invoice_date: string;
  due_date: string;
  total: number;
  outstanding: number;
  days_overdue: number;
}

export type ReceivableBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';

export interface ReceivableRow {
  customer_id: number;
  customer_name: string;
  credit_limit: number;
  invoice_count: number;
  total: number;
  /** Receivables plus what open orders will still bill; compared with the credit limit. */
  exposure: number;
  over_limit: boolean;
  buckets: Record<ReceivableBucket, number>;
}

export interface ReceivablesReport {
  as_of: string;
  rows: ReceivableRow[];
  totals: Record<ReceivableBucket, number> & { total: number };
}

/** A customer's credit position, shown when an order is refused or about to be taken. */
export interface CreditStatus {
  customer_id: number;
  credit_limit: number;
  receivables: number;
  open_orders: number;
  exposure: number;
  /** Null when the customer has no credit limit (the limit is not enforced). */
  available: number | null;
}
