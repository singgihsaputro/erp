import { describe, expect, it } from 'vitest';
import { checkInvoice } from '@erp/shared';
import { openDb } from '../src/db.js';
import { matchProducts, words } from '../src/invoices/match.js';
import { lastAmount, parseAmount, parseDate, parseQtyMilli } from '../src/invoices/numbers.js';
import { parseInvoice } from '../src/invoices/parse.js';
import { readPdfText, type TextLine } from '../src/invoices/pdf-text.js';
import { SAMPLE_INVOICES } from '../src/invoices/samples.js';
import { seedDemo } from '../src/seed-data.js';

describe('Indonesian and English number formats', () => {
  it('reads amounts as whole Rupiah', () => {
    expect(parseAmount('Rp 1.250.000')).toBe(1250000);
    expect(parseAmount('Rp 1.250.000,00')).toBe(1250000);
    expect(parseAmount('Rp1.250.000,-')).toBe(1250000);
    expect(parseAmount('IDR 1,250,000.00')).toBe(1250000);
    expect(parseAmount('1250000')).toBe(1250000);
    expect(parseAmount('68.000')).toBe(68000);
    expect(parseAmount('-Rp 73.200,00')).toBe(-73200);
    expect(parseAmount('(50.000)')).toBe(-50000);
    expect(parseAmount('11%')).toBeNull();
    expect(parseAmount('pcs')).toBeNull();
    expect(parseAmount('12,5 kg')).toBeNull();
  });

  it('reads quantities in thousandths, with a comma as the Indonesian decimal point', () => {
    expect(parseQtyMilli('20')).toBe(20000);
    expect(parseQtyMilli('12,5')).toBe(12500);
    expect(parseQtyMilli('0,250')).toBe(250);
    expect(parseQtyMilli('1.5')).toBe(1500);
    expect(parseQtyMilli('1.000')).toBe(1000000); // a thousand, not one
    expect(parseQtyMilli('dus')).toBeNull();
  });

  it('reads dates day first, in Indonesian and English', () => {
    expect(parseDate('2 November 2026')).toBe('2026-11-02');
    expect(parseDate(': 16 Desember 2026')).toBe('2026-12-16');
    expect(parseDate('1 Agustus 2026')).toBe('2026-08-01');
    expect(parseDate('5 Mei 2026')).toBe('2026-05-05');
    expect(parseDate('03 Okt 2026')).toBe('2026-10-03');
    expect(parseDate('November 4, 2026')).toBe('2026-11-04');
    expect(parseDate('03/11/2026')).toBe('2026-11-03');
    expect(parseDate('02-11-2026')).toBe('2026-11-02');
    expect(parseDate('02.11.26')).toBe('2026-11-02');
    expect(parseDate('2026-11-04')).toBe('2026-11-04');
    expect(parseDate('31/04/2026')).toBeNull(); // there is no 31 April
    expect(parseDate('30 hari')).toBeNull();
  });

  it('takes the rightmost amount on a totals line and never a rate', () => {
    expect(lastAmount('PPN 11%   Rp 312.400')).toBe(312400);
    expect(lastAmount('PPN (11%)')).toBeNull();
    expect(lastAmount('Total   Rp 3.152.400,-')).toBe(3152400);
  });
});

describe('extracting the sample invoices', () => {
  const extract = async (i: number) => parseInvoice((await readPdfText(await SAMPLE_INVOICES[i].build())).lines);

  it('PT Sumber Pangan Lestari: Indonesian labels, two-column header, product codes, PPN 11%', async () => {
    const { data, found } = await extract(0);
    expect(data).toMatchObject({
      supplier_name: 'PT Sumber Pangan Lestari',
      supplier_npwp: '01.234.567.8-412.000', // the supplier's, not the buyer's in the Kepada block
      invoice_number: 'INV/SPL/2026/11/0042',
      invoice_date: '2026-11-02',
      due_date: '2026-11-16',
      subtotal: 2840000,
      discount: 0,
      ppn_rate: 11,
      ppn: 312400,
      total: 3152400,
    });
    expect(data.lines).toEqual([
      { description: 'Beras Premium Pandan Wangi 5 kg', product_id: null, qty_milli: 20000, unit: 'pcs', unit_price: 68000, amount: 1360000 },
      { description: 'Minyak Goreng Sawit 2 liter', product_id: null, qty_milli: 24000, unit: 'pcs', unit_price: 33500, amount: 804000 },
      { description: 'Gula Pasir Putih 1 kg', product_id: null, qty_milli: 30000, unit: 'pcs', unit_price: 15200, amount: 456000 },
      { description: 'Tepung Terigu Segitiga Biru 1 kg', product_id: null, qty_milli: 20000, unit: 'pcs', unit_price: 11000, amount: 220000 },
    ]);
    expect(found.invoice_number).toContain('No. Faktur');
    expect(found.total).toContain('3.152.400');
    expect(checkInvoice(data).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('CV Berkah Niaga Grosir: English labels, "Rp …,00", a discount, a wrapped description, a 16-digit NPWP', async () => {
    const { data, found } = await extract(1);
    // each field quotes only its own column, not the address beside it
    expect(found.invoice_date).toBe('Invoice Date: 03/11/2026');
    expect(found.invoice_number).toBe('Invoice No: CBN-2611-0087');
    expect(found.ppn).toBe('PPN 11%   Rp 231.000,00');
    expect(data).toMatchObject({
      supplier_name: 'CV Berkah Niaga Grosir', // not the "INVOICE" title above it
      supplier_npwp: '0023456789015000',
      invoice_number: 'CBN-2611-0087',
      invoice_date: '2026-11-03',
      due_date: '2026-11-17',
      subtotal: 2173200, // the Subtotal line, not DPP
      discount: 73200,
      ppn: 231000,
      total: 2331000,
    });
    expect(data.lines).toHaveLength(5);
    expect(data.lines[0]).toMatchObject({ qty_milli: 10000, unit: 'dus', unit_price: 104000, amount: 1040000 });
    expect(data.lines[3].description).toBe('Kopi Bubuk Tubruk 200 g kemasan sachet');
    expect(checkInvoice(data).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('UD Makmur Sejahtera: no PPN, no subtotal line, kg decimals, due "30 hari"', async () => {
    const { data, found } = await extract(2);
    expect(data).toMatchObject({
      supplier_name: 'UD MAKMUR SEJAHTERA',
      supplier_npwp: null,
      invoice_number: '0142/UD-MS/XI/2026',
      invoice_date: '2026-11-02',
      due_date: '2026-12-02',
      subtotal: 1349000,
      ppn: null,
      ppn_rate: null,
      total: 1349000,
    });
    expect(found.subtotal).toBeNull(); // computed from the lines, not read from the PDF
    expect(data.lines.map((l) => [l.description, l.qty_milli, l.unit])).toEqual([
      ['Bawang Merah', 12500, 'kg'],
      ['Bawang Putih', 10000, 'kg'],
      ['Cabai Rawit Merah', 4500, 'kg'],
      ['Telur Ayam Ras', 15000, 'kg'],
    ]);
    expect(checkInvoice(data).filter((i) => i.level === 'error')).toEqual([]);
  });

  it('matches lines to the catalogue by code, then by name, and leaves unknown products alone', async () => {
    const db = openDb(':memory:');
    seedDemo(db);
    const sku = (id: number | null) =>
      id === null ? null : (db.prepare('SELECT sku FROM products WHERE id = ?').get(id) as { sku: string }).sku;
    const matched = async (i: number) => {
      const r = await extract(i);
      return matchProducts(db, r.data.lines.map((l, j) => ({ description: l.description, text: r.rowTexts[j] }))).map(sku);
    };
    expect(await matched(0)).toEqual(['BRS-PRM-5', 'MYK-GRG-2L', 'GLA-PSR-1', 'TPG-TRG-1']);
    // the box of 40, not the single pack; the biscuit is not in the catalogue
    expect(await matched(1)).toEqual(['MIE-KRT-DUS', 'SRI-KTL-ML', 'TEH-CEL-25', 'KPI-BBK-200', null]);
    expect(await matched(2)).toEqual(['BWG-MRH', 'BWG-PTH', 'CBE-RWT', 'TLR-AYM']);
    expect([...words('Beras 5kg (isi 2)')]).toEqual(['beras', '5', 'kg', '2']);
  });
});

describe('layouts beyond the samples', () => {
  let y = 800;
  const line = (...cells: [number, string][]): TextLine => {
    y -= 14;
    return {
      page: 1,
      y,
      height: 9,
      cells: cells.map(([x, text]) => ({ x, end: x + text.length * 4.5, text })),
      text: cells.map(([, t]) => t).join('   '),
    };
  };

  it('uses a "Dari:" label, skips the e-Faktur serial, and reads US-style dates', () => {
    y = 800;
    const { data } = parseInvoice([
      line([50, 'Dari: Toko Grosir Sinar Abadi']),
      line([50, 'No. Faktur Pajak: 010.000-26.00012345']),
      line([50, 'Invoice #: SA-77/2026']),
      line([50, 'Date: November 4, 2026']),
      line([50, 'Ditagihkan kepada: Toko Maju Jaya']),
      line([50, 'Item'], [250, 'Qty'], [330, 'Price'], [450, 'Total']),
      line([50, 'Sabun Mandi Batang Lavender 90 g'], [250, '48'], [330, '3.300'], [450, '158.400']),
      line([300, 'Total'], [450, 'Rp 158.400']),
    ]);
    expect(data.supplier_name).toBe('Toko Grosir Sinar Abadi');
    expect(data.invoice_number).toBe('SA-77/2026');
    expect(data.invoice_date).toBe('2026-11-04');
    expect(data.lines).toEqual([
      { description: 'Sabun Mandi Batang Lavender 90 g', product_id: null, qty_milli: 48000, unit: null, unit_price: 3300, amount: 158400 },
    ]);
    expect(data.total).toBe(158400);
  });

  it('picks the price that makes the line add up when there is an extra discount column', () => {
    y = 800;
    const { data } = parseInvoice([
      line([50, 'PT Contoh Distribusi']),
      line([50, 'No. Invoice: CD-1']),
      line([50, 'Barang'], [220, 'Qty'], [280, 'Harga'], [360, 'Diskon'], [450, 'Jumlah']),
      line([50, 'Wafer Cokelat 140 g'], [220, '10'], [280, '8.200'], [360, '0'], [450, '82.000']),
      line([300, 'Total'], [450, '82.000']),
    ]);
    expect(data.lines[0]).toMatchObject({ qty_milli: 10000, unit_price: 8200, amount: 82000 });
  });

  it('leaves numbers, dates and totals it cannot find empty rather than guessing', () => {
    y = 800;
    const { data, found } = parseInvoice([line([50, 'Terima kasih atas kepercayaan Anda'])]);
    expect(data).toMatchObject({ invoice_number: null, invoice_date: null, total: null, lines: [], subtotal: null });
    expect(found.total).toBeNull();
    expect(checkInvoice(data).filter((i) => i.level === 'error').map((i) => i.field)).toEqual(
      expect.arrayContaining(['invoice_number', 'invoice_date', 'lines', 'subtotal', 'total']),
    );
  });
});
