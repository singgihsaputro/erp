/** Parses a user-typed amount ("12.500", "12500") into whole Rupiah; NaN if invalid. */
export function parseRupiahInput(text: string): number {
  const digits = text.replace(/[.\s]/g, '').replace(/^Rp/i, '');
  if (!/^\d+$/.test(digits)) return NaN;
  return Number(digits);
}
