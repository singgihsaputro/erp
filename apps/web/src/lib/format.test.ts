import { describe, expect, it } from 'vitest';
import { formatDate, formatStamp, parseQtyInput, parseRupiahInput, qtyToInput } from './format';

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

describe('parseQtyInput', () => {
  it('reads whole and decimal quantities, comma or dot, into thousandths', () => {
    expect(parseQtyInput('20')).toBe(20000);
    expect(parseQtyInput('12,5')).toBe(12500);
    expect(parseQtyInput('0.250')).toBe(250);
  });
  it('rejects junk and more than three decimals', () => {
    expect(parseQtyInput('')).toBeNaN();
    expect(parseQtyInput('1,2345')).toBeNaN();
    expect(parseQtyInput('-1')).toBeNaN();
  });
  it('round-trips through the input form', () => {
    expect(qtyToInput(12500)).toBe('12,5');
    expect(parseQtyInput(qtyToInput(4500))).toBe(4500);
  });
});

describe('dates', () => {
  it('shows business dates as written and timestamps in Jakarta time', () => {
    expect(formatDate('2026-11-02')).toBe('2 Nov 2026');
    expect(formatDate(null)).toBe('—');
    expect(formatStamp('2026-11-03T23:30:00.000Z')).toBe('4 Nov 2026, 06:30');
  });
});
