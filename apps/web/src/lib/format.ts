/** Parses a user-typed amount ("12.500", "12500") into whole Rupiah; NaN if invalid. */
export function parseRupiahInput(text: string): number {
  const digits = text.replace(/[.\s]/g, '').replace(/^Rp/i, '');
  if (!/^\d+$/.test(digits)) return NaN;
  return Number(digits);
}

/** Parses a user-typed quantity ("12,5", "12.5", "20") into thousandths; NaN if invalid. */
export function parseQtyInput(text: string): number {
  const s = text.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 1000);
}

/** Thousandths back to what a person types: 12500 → "12,5". */
export function qtyToInput(qtyMilli: number): string {
  return String(qtyMilli / 1000).replace('.', ',');
}

const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const stamp = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Jakarta',
});

/** "2026-11-02" → "2 Nov 2026". */
export const formatDate = (iso: string | null) => (iso ? day.format(new Date(`${iso}T00:00:00Z`)) : '—');
/** A UTC timestamp shown in Jakarta time: "4 Nov 2026, 10:20". */
export const formatStamp = (iso: string | null) => (iso ? stamp.format(new Date(iso)) : '—');
