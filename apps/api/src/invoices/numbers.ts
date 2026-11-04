/**
 * Number and date formats as they appear on Indonesian invoices, with the
 * English forms some suppliers use. Indonesian groups thousands with dots and
 * uses a comma for decimals: "Rp 1.250.000,00". English is the reverse.
 */

const stripCurrency = (s: string) =>
  s
    .replace(/\b(rp|idr)\.?/gi, '')
    .replace(/,-$/, '')
    .replace(/\s+/g, '');

/** "Rp 1.250.000,00", "1,250,000.00", "1250000", "(50.000)" → whole Rupiah; null if it is not an amount. */
export function parseAmount(raw: string): number | null {
  let s = stripCurrency(raw.trim());
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  let value: number;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) value = Number(s.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) value = Number(s.replace(/,/g, ''));
  else if (/^\d+,\d{1,2}$/.test(s)) value = Number(s.replace(',', '.'));
  else if (/^\d+(\.\d{1,2})?$/.test(s)) value = Number(s);
  else return null;
  const rounded = Math.round(value);
  return negative ? -rounded : rounded;
}

/** "12,5" (Indonesian decimal), "1.5", "1.000" (a thousand), "20" → thousandths; null if not a quantity. */
export function parseQtyMilli(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, '');
  let value: number;
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) value = Number(s.replace(/\./g, ''));
  else if (/^\d+,\d{1,3}$/.test(s)) value = Number(s.replace(',', '.'));
  else if (/^\d+\.\d{1,2}$/.test(s)) value = Number(s);
  else if (/^\d+$/.test(s)) value = Number(s);
  else return null;
  return Math.round(value * 1000);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, mei: 5, may: 5, jun: 6, jul: 7,
  agu: 8, agt: 8, aug: 8, sep: 9, okt: 10, oct: 10, nov: 11, des: 12, dec: 12,
};

function iso(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null; // 31 April and the like
  return date.toISOString().slice(0, 10);
}

/**
 * The first date in the text, as YYYY-MM-DD. Numeric dates are day first, as
 * written in Indonesia: 03/11/2026 is 3 November.
 */
export function parseDate(text: string): string | null {
  let m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3,10})\.?,?\s+(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (month) return iso(Number(m[3]), month, Number(m[1]));
  }
  m = text.match(/\b([A-Za-z]{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (month) return iso(Number(m[3]), month, Number(m[2]));
  }
  m = text.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  m = text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})\b/);
  if (m) return iso(2000 + Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pulls the last amount out of a text such as "PPN 11%   Rp 312.400": the rightmost money-shaped token. */
export function lastAmount(text: string): number | null {
  const tokens = [...text.matchAll(/\(?-?(?:rp\.?\s*)?\d[\d.,]*(?:,-)?\)?/gi)]
    // a rate such as "11%" is not an amount
    .filter((m) => !/^\s*%/.test(text.slice(m.index! + m[0].length)))
    .map((m) => m[0].replace(/[.,]$/, ''));
  for (let i = tokens.length - 1; i >= 0; i--) {
    const v = parseAmount(tokens[i]);
    if (v !== null) return v;
  }
  return null;
}
