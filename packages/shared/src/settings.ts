import { z } from 'zod';
import { npwpField } from './supplier.js';

export const DOCUMENT_TYPES = [
  ['quotation', 'Quotation'],
  ['sales_order', 'Sales order'],
  ['delivery', 'Surat Jalan'],
  ['sales_invoice', 'Sales invoice (Faktur)'],
  ['sales_return', 'Sales return'],
  ['purchase_order', 'Purchase order'],
  ['goods_receipt', 'Goods receipt'],
  ['supplier_invoice', 'Supplier invoice'],
  ['purchase_return', 'Purchase return'],
  ['payment', 'Payment'],
  ['stock_adjustment', 'Stock adjustment'],
  ['stock_transfer', 'Stock transfer'],
  ['stock_opname', 'Stock opname'],
  ['pos_sale', 'POS receipt'],
  ['journal', 'Journal'],
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number][0];
const docTypeIds = DOCUMENT_TYPES.map((d) => d[0]) as [DocumentType, ...DocumentType[]];

export const MAX_LOGO_CHARS = 300_000;
const LOGO_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

export const prefixField = z
  .string()
  .trim()
  .toUpperCase()
  .min(1, 'Prefix is required')
  .max(8, 'At most 8 characters')
  .regex(/^[A-Z0-9-]+$/, 'Use letters, digits and dash only');

export const companyInputSchema = z.object({
  name: z.string().trim().min(1, 'Company name is required').max(120),
  address: z.string().trim().max(300).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.union([z.literal(''), z.string().trim().email('Not a valid email').max(120)]).default(''),
  npwp: z.union([z.literal(''), npwpField]).default(''),
  /** Basis points: 1100 = 11%. Whole or half percentages up to 100%. */
  ppn_rate_bp: z.number().int().min(0, 'Rate cannot be negative').max(10000, 'Rate cannot exceed 100%'),
  logo_data_url: z
    .string()
    .max(MAX_LOGO_CHARS, 'Logo is too large (keep it under about 200 KB)')
    .refine((v) => v === '' || LOGO_RE.test(v), 'Logo must be a PNG, JPEG or WebP image')
    .default(''),
});
export type CompanyInput = z.input<typeof companyInputSchema>;

export interface CompanySettings {
  name: string;
  address: string;
  phone: string;
  email: string;
  npwp: string;
  ppn_rate_bp: number;
  logo_data_url: string;
  updated_at: string;
}

export const prefixesInputSchema = z
  .object({ prefixes: z.record(z.enum(docTypeIds), prefixField) })
  .superRefine((v, ctx) => {
    // Two kinds of document sharing a prefix would share one number series.
    const seen = new Map<string, string>();
    for (const [type, prefix] of Object.entries(v.prefixes)) {
      const other = seen.get(prefix);
      if (other) ctx.addIssue({ code: 'custom', path: ['prefixes', type], message: `${prefix} is already used by ${other}` });
      else seen.set(prefix, type);
    }
  });

export interface DocumentPrefix {
  doc_type: DocumentType;
  label: string;
  prefix: string;
  /** What the next number would look like this month. */
  next_number: string;
}

/** The text of a document number, e.g. INV/2026/11/0007. */
export function formatDocumentNumber(prefix: string, period: string, no: number): string {
  const [year, month] = period.split('-');
  return `${prefix}/${year}/${month}/${String(no).padStart(4, '0')}`;
}
