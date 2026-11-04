import { describe, expect, it } from 'vitest';
import { parseRupiahInput } from './format';

describe('parseRupiahInput', () => {
  it('accepts plain and dotted amounts', () => {
    expect(parseRupiahInput('12500')).toBe(12500);
    expect(parseRupiahInput('12.500')).toBe(12500);
    expect(parseRupiahInput('Rp 1.250.000')).toBe(1250000);
  });
  it('rejects junk and decimals', () => {
    expect(parseRupiahInput('')).toBeNaN();
    expect(parseRupiahInput('12,5')).toBeNaN();
    expect(parseRupiahInput('abc')).toBeNaN();
  });
});
