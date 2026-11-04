import { describe, expect, it } from 'vitest';
import { formatQty, formatRupiah, productInputSchema, productUnitInputSchema, toBaseMilli } from '../src/index.js';

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

describe('unit conversion helpers', () => {
  it('converts 2 boxes of 12 to 24 pcs and flags fractions', () => {
    expect(toBaseMilli(2000, 12000)).toBe(24000);
    expect(toBaseMilli(1, 1)).toBeNull();
    expect(productUnitInputSchema.safeParse({ unit: 'box', factor_milli: 0 }).success).toBe(false);
  });
});
