import { z } from 'zod';

export const PAYMENT_TERMS = ['cash', 'net_14', 'net_30'] as const;
export type PaymentTerms = (typeof PAYMENT_TERMS)[number];
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  cash: 'Cash',
  net_14: 'Net 14 days',
  net_30: 'Net 30 days',
};
/** Days until payment is due. */
export const PAYMENT_TERMS_DAYS: Record<PaymentTerms, number> = { cash: 0, net_14: 14, net_30: 30 };

/** Formats 15 digits as 01.234.567.8-412.000; 16-digit NPWP (NIK) stays plain digits. Returns null if neither. */
export function normalizeNpwp(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 15) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}.${digits.slice(8, 9)}-${digits.slice(9, 12)}.${digits.slice(12)}`;
  }
  return digits.length === 16 ? digits : null;
}

const npwpField = z
  .string()
  .trim()
  .default('')
  .transform((v, ctx) => {
    if (v === '') return '';
    const n = normalizeNpwp(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'NPWP must have 15 or 16 digits' });
      return z.NEVER;
    }
    return n;
  });

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  contact_person: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.union([z.literal(''), z.string().trim().max(120).email('Enter a valid email')]).default(''),
  address: z.string().trim().max(300).default(''),
  npwp: npwpField,
  payment_terms: z.enum(PAYMENT_TERMS).default('cash'),
  note: z.string().trim().max(300).default(''),
});
export type SupplierInput = z.input<typeof supplierInputSchema>;

export interface Supplier {
  id: number;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  npwp: string;
  payment_terms: PaymentTerms;
  note: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}
