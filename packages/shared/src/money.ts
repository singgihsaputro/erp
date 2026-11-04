const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/** Money is an integer number of Rupiah. */
export function formatRupiah(amount: number): string {
  return rupiah.format(amount);
}

/** Quantities are integers in thousandths of the base unit. */
export function formatQty(qtyMilli: number): string {
  const value = qtyMilli / 1000;
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(value);
}
