import { INVOICE_FIELDS, type FoundFields, type InvoiceData, type InvoiceLine } from '@erp/shared';
import { addDays, lastAmount, parseAmount, parseDate, parseQtyMilli } from './numbers.js';
import type { TextCell, TextLine } from './pdf-text.js';

/**
 * Reads a supplier invoice from the text lines of its PDF. Heuristic, not
 * magic: it knows the labels Indonesian and English invoices use, finds the
 * line-item table by its header, and records the PDF line every field came
 * from so a person can check it. Whatever it cannot find stays empty.
 */

export interface ParsedInvoice {
  data: InvoiceData;
  found: FoundFields;
  /** Per extracted line, the full row text, for matching to products. */
  rowTexts: string[];
}

// ------------------------------------------------------------------ labels

const BILL_TO = /^(kepada(\s+yth\.?)?|ditagihkan\s+kepada|bill(ed)?\s*to|sold\s*to|pembeli|customer|pelanggan)\b\s*:?/i;
const SUPPLIER_LABEL = /^(dari|from|supplier|pemasok|penjual|vendor|seller)\s*:\s*(.+)$/i;
const COMPANY = /^(PT\.?|CV\.?|UD\.?|PD\.?|Fa\.|Firma|Toko|Koperasi)\s+\S/i;
const DOC_TITLE = /^(faktur(\s+penjualan)?|invoice|nota(\s+penjualan)?|tagihan|kwitansi|sales\s+invoice|tax\s+invoice)$/i;

// A label is matched at the start of a cell; group 1 must be the label, the rest of the cell is the value.
const INVOICE_NUMBER = [
  /^((?:nota\s*\/\s*)?(?:faktur|invoice|nota|tagihan)\s*(?:no\.?|nomor|number|#))(?!\s*pajak)\s*[:.#]?\s*(.*)$/i,
  /^(no(?:mor)?\.?\s*(?:faktur|invoice|inv|nota|tagihan))(?!\s*pajak)\s*[:.#]?\s*(.*)$/i,
  /^(invoice\s*#)\s*(.*)$/i,
];
const INVOICE_DATE = [
  /^((?:tanggal|tgl\.?)(?!\s*jatuh)\s*(?:faktur|invoice|nota)?)\s*[:.]?\s*(.*)$/i,
  /^((?:invoice\s+)?date)\s*[:.]?\s*(.*)$/i,
];
const DUE_DATE = [/^((?:tanggal|tgl\.?)\s*jatuh\s*tempo|jatuh\s*tempo|due\s*date|payment\s*due)\s*[:.]?\s*(.*)$/i];
const NPWP = /^(npwp)\s*[:.]?\s*(.*)$/i;

const SUBTOTAL = [/^(sub\s*-?\s*total|jumlah\s+harga\s+jual|harga\s+jual)\b/i, /^(dpp|dasar\s+pengenaan\s+pajak)(?!\s*nilai\s+lain)\b/i];
const DISCOUNT = [/^(diskon|potongan(\s+harga)?|discount)\b/i];
const PPN = [/^(ppn|vat|pajak\s+pertambahan\s+nilai)\b/i];
const TOTAL = [
  /^(grand\s*total|total\s+tagihan|jumlah\s+tagihan|total\s+bayar|amount\s+due|total\s+amount|total\s+faktur|total\s+invoice)\b/i,
  /^(total|jumlah)\s*[:.]?$/i,
  /^(total|jumlah)\b(?!\s*(qty|item|barang|kuantitas))/i,
];
const END_OF_TABLE = /^(sub\s*-?\s*total|total|grand\s*total|dpp|ppn|diskon|potongan|discount|terbilang|catatan|keterangan\s*:|note|says|jumlah\s+tagihan)\b/i;

// Line-item table header words.
const H_DESC = /^(deskripsi|keterangan|nama\s+barang|nama\s+produk|barang|produk|item|items|description|uraian)$/i;
const H_QTY = /^(qty|kuantitas|kts|jml|jumlah\s+barang|banyak|quantity|qty\s*\/\s*unit)$/i;
const H_PRICE = /^(harga(\s+satuan)?|price|unit\s+price|harga\s*\/\s*unit|@\s*harga)$/i;
const H_AMOUNT = /^(jumlah|total|subtotal|amount|nilai|jumlah\s+harga)$/i;
const CODE = /^(?=.*[\d-])[A-Z0-9][A-Z0-9\-_./]{2,}$/;
const UNIT = /^(pcs|pc|buah|bh|unit|kg|g|gr|gram|ons|liter|ltr|l|ml|meter|m|pak|pack|pck|box|dus|karton|ctn|sak|karung|krg|lusin|rim|botol|btl|kaleng|klg|renceng|ikat|lembar|lbr|roll|set)$/i;

// ------------------------------------------------------------------ helpers

interface Hit {
  value: string;
  /** The cells the value was read from: what the review screen quotes back. */
  source: string;
}

/** Marks which cells belong to the buyer's address block, so the supplier is not read from it. */
function buyerCells(lines: TextLine[], tableStart: number): Set<TextCell> {
  const buyer = new Set<TextCell>();
  for (let i = 0; i < tableStart; i++) {
    const at = lines[i].cells.find((c) => BILL_TO.test(c.text));
    if (!at) continue;
    // Bill-to in a right-hand column: that column, from here down to the table, is the buyer's.
    // Bill-to on the left: every line from here down to the table is the buyer's.
    const rightColumn = at.x > 200;
    for (let j = i; j < tableStart; j++) {
      for (const c of lines[j].cells) if (!rightColumn || c.x >= at.x - 5) buyer.add(c);
    }
    break;
  }
  return buyer;
}

function findLabeled(lines: TextLine[], patterns: RegExp[], skip: Set<TextCell>, upTo = lines.length): Hit | null {
  for (const re of patterns) {
    for (let i = 0; i < upTo; i++) {
      const line = lines[i];
      for (let ci = 0; ci < line.cells.length; ci++) {
        const cell = line.cells[ci];
        if (skip.has(cell)) continue;
        const m = cell.text.match(re);
        if (!m) continue;
        let value = (m[2] ?? '').replace(/^[:.\-\s]+/, '').trim();
        let source = cell.text;
        if (!value) {
          value = (line.cells[ci + 1]?.text ?? '').replace(/^[:.\-\s]+/, '').trim();
          source = `${cell.text} ${line.cells[ci + 1]?.text ?? ''}`;
        }
        if (!value && lines[i + 1] && !skip.has(lines[i + 1].cells[0])) {
          value = lines[i + 1].cells[0].text;
          source = `${cell.text} ${value}`;
        }
        if (value) return { value, source: source.trim() };
      }
    }
  }
  return null;
}

/** A totals line: the label is in the first cell, the amount is the rightmost money on the line. */
function findTotal(lines: TextLine[], patterns: RegExp[], from: number, last = false): { amount: number; source: string } | null {
  for (const re of patterns) {
    let hit: { amount: number; source: string } | null = null;
    for (let i = from; i < lines.length; i++) {
      const cells = lines[i].cells;
      const at = cells.findIndex((c) => re.test(c.text));
      if (at < 0) continue;
      const amount = lastAmount(cells.slice(at).map((c) => c.text.replace(re, '')).join('   '));
      if (amount === null) continue;
      hit = { amount: Math.abs(amount), source: cells.slice(at).map((c) => c.text).join('   ') };
      if (!last) return hit;
    }
    if (hit) return hit;
  }
  return null;
}

const firstToken = (s: string) => s.match(/^[A-Z0-9][A-Z0-9/\-.]*[A-Z0-9]|^[A-Z0-9]/i)?.[0] ?? null;

function normalizeNpwp(s: string): string | null {
  const m = s.match(/\d[\d.\-\s]{13,24}\d/);
  if (!m) return null;
  const digits = m[0].replace(/\D/g, '');
  if (digits.length === 15) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}.${digits.slice(8, 9)}-${digits.slice(9, 12)}.${digits.slice(12)}`;
  }
  return digits.length === 16 ? digits : null;
}

// ------------------------------------------------------------------ table

interface Table {
  header: number;
  end: number;
}

function findTable(lines: TextLine[]): Table | null {
  for (let i = 0; i < lines.length; i++) {
    const words = lines[i].cells.map((c) => c.text);
    const hasDesc = words.some((w) => H_DESC.test(w));
    const numeric = [H_QTY, H_PRICE, H_AMOUNT].filter((re) => words.some((w) => re.test(w))).length;
    if (!hasDesc || numeric < 2) continue;
    let end = i + 1;
    while (end < lines.length && !END_OF_TABLE.test(lines[end].cells[0]?.text ?? '')) end++;
    return { header: i, end };
  }
  return null;
}

/** "12,5 kg" → qty and unit; "20" → qty only. */
function splitQty(text: string): { qty: number; unit: string | null } | null {
  const m = text.match(/^([\d.,]+)\s*([A-Za-z]+)?$/);
  if (!m) return null;
  const qty = parseQtyMilli(m[1]);
  if (qty === null || qty <= 0) return null;
  return { qty, unit: m[2] ?? null };
}

/**
 * One table row. Read from the right: the last number is the line amount, the
 * one before it the unit price, and the first number after the description is
 * the quantity — choosing the pair whose product best matches the amount, so
 * an extra column such as a discount does not throw it off.
 */
function parseRow(cells: TextCell[]): { line: InvoiceLine; text: string } | null {
  let rest = [...cells];
  if (rest.length > 1 && /^\d{1,3}\.?$/.test(rest[0].text)) rest = rest.slice(1); // "No" column
  // The description is everything before the first number; a leading product
  // code column ("BRS-PRM-5") is kept for matching but left out of the description.
  const firstNumber = rest.findIndex((c) => splitQty(c.text) !== null || parseAmount(c.text) !== null);
  if (firstNumber <= 0) return null;
  let descCells = rest.slice(0, firstNumber);
  if (descCells.length > 1 && CODE.test(descCells[0].text)) descCells = descCells.slice(1);
  const description = descCells.map((c) => c.text).join(' ');
  if (!/[A-Za-z]{2}/.test(description)) return null;
  const after = rest.slice(firstNumber);

  const qtys: { qty: number; unit: string | null; i: number }[] = [];
  const amounts: { v: number; i: number }[] = [];
  let unit: string | null = null;
  after.forEach((c, i) => {
    const q = splitQty(c.text);
    if (q) qtys.push({ ...q, i });
    const a = parseAmount(c.text);
    if (a !== null && a >= 0) amounts.push({ v: a, i });
    if (UNIT.test(c.text)) unit = c.text;
  });
  if (amounts.length < 2 || qtys.length === 0) return null;
  const amount = amounts[amounts.length - 1];
  let best: { qty: number; unit: string | null; price: number; err: number } | null = null;
  for (const q of qtys) {
    for (const p of amounts) {
      if (p.i <= q.i || p.i >= amount.i) continue;
      const err = Math.abs(Math.round((q.qty * p.v) / 1000) - amount.v);
      if (!best || err < best.err) best = { qty: q.qty, unit: q.unit, price: p.v, err };
    }
  }
  if (!best) return null;
  return {
    line: {
      description,
      product_id: null,
      qty_milli: best.qty,
      unit: best.unit ?? unit,
      unit_price: best.price,
      amount: amount.v,
    },
    text: cells.map((c) => c.text).join(' '),
  };
}

// ------------------------------------------------------------------ the document

export function parseInvoice(lines: TextLine[]): ParsedInvoice {
  const found = Object.fromEntries(INVOICE_FIELDS.map((f) => [f, null])) as FoundFields;
  const table = findTable(lines);
  const headerEnd = table?.header ?? lines.length;
  const buyer = buyerCells(lines, headerEnd);

  // supplier
  let supplier: Hit | null = findLabeled(lines, [SUPPLIER_LABEL], buyer, headerEnd);
  if (!supplier) {
    outer: for (let i = 0; i < headerEnd; i++) {
      for (const c of lines[i].cells) {
        if (!buyer.has(c) && COMPANY.test(c.text)) {
          supplier = { value: c.text, source: c.text };
          break outer;
        }
      }
    }
  }
  if (!supplier) {
    const first = lines.slice(0, headerEnd).find((l) => {
      const t = l.cells[0]?.text ?? '';
      return !buyer.has(l.cells[0]) && /[A-Za-z]{3}/.test(t) && !DOC_TITLE.test(t) && !/:/.test(t);
    });
    if (first) supplier = { value: first.cells[0].text, source: first.cells[0].text };
  }

  const number = findLabeled(lines, INVOICE_NUMBER, new Set(), headerEnd);
  const due = findLabeled(lines, DUE_DATE, new Set(), headerEnd);
  const date = findLabeled(lines, INVOICE_DATE, new Set(), headerEnd);
  const npwp = findLabeled(lines, [NPWP], buyer, headerEnd);

  const invoiceDate = date ? parseDate(date.value) : null;
  let dueDate = due ? parseDate(due.value) : null;
  const netDays = due?.value.match(/(\d{1,3})\s*(hari|days?)\b|net\s*(\d{1,3})/i);
  if (!dueDate && netDays && invoiceDate) dueDate = addDays(invoiceDate, Number(netDays[1] ?? netDays[3]));

  // lines
  const items: InvoiceLine[] = [];
  const rowTexts: string[] = [];
  if (table) {
    for (let i = table.header + 1; i < table.end; i++) {
      const row = parseRow(lines[i].cells);
      if (row) {
        items.push(row.line);
        rowTexts.push(row.text);
      } else if (items.length && lines[i].cells.length === 1 && /[A-Za-z]/.test(lines[i].cells[0].text)) {
        // a description wrapped onto the next line
        items[items.length - 1].description += ` ${lines[i].cells[0].text}`;
        rowTexts[rowTexts.length - 1] += ` ${lines[i].cells[0].text}`;
      }
    }
  }

  // totals, below the table when there is one
  const from = table ? table.end : headerEnd;
  const subtotal = findTotal(lines, SUBTOTAL, from);
  const discount = findTotal(lines, DISCOUNT, from);
  const ppn = findTotal(lines, PPN, from);
  const total = findTotal(lines, TOTAL, from, true);
  const rate = ppn?.source.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);

  const record = (field: keyof FoundFields, hit: { source: string } | null) => {
    if (hit) found[field] = hit.source;
  };
  record('supplier_name', supplier);
  record('invoice_number', number && firstToken(number.value) ? number : null);
  record('invoice_date', invoiceDate ? date : null);
  record('due_date', dueDate ? due : null);
  record('supplier_npwp', npwp && normalizeNpwp(npwp.value) ? npwp : null);
  record('subtotal', subtotal);
  record('discount', discount);
  record('ppn', ppn);
  record('total', total);

  const linesSum = items.reduce((s, l) => s + l.amount, 0);
  const data: InvoiceData = {
    supplier_name: supplier?.value.replace(/\s+/g, ' ').trim() ?? null,
    supplier_npwp: npwp ? normalizeNpwp(npwp.value) : null,
    invoice_number: number ? firstToken(number.value) : null,
    invoice_date: invoiceDate,
    due_date: dueDate,
    lines: items,
    // no subtotal printed: the lines are the subtotal
    subtotal: subtotal?.amount ?? (items.length ? linesSum : null),
    discount: discount?.amount ?? 0,
    ppn_rate: rate ? Number(rate[1].replace(',', '.')) : null,
    ppn: ppn?.amount ?? null,
    total: total?.amount ?? null,
  };
  return { data, found, rowTexts };
}
