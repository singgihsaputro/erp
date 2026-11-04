import { describe, expect, it } from 'vitest';
import { formatQty, formatRupiah, productInputSchema } from '../src/index.js';

describe('shared', () => {
  it('formats rupiah without decimals', () => {
    expect(formatRupiah(15000).replace(/\s/g, ' ')).toMatch(/^Rp\s?15\.000$/);
  });
  it('formats milli quantities', () => {
    expect(formatQty(1500)).toBe('1,5');
  });
  it('rejects fractional prices', () => {
    expect(productInputSchema.safeParse({ sku: 'A', name: 'B', base_unit: 'pcs', cost: 1.5, price: 2 }).success).toBe(false);
  });
});
