import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Demo supplier invoices, drawn as real text PDFs in three deliberately
 * different layouts. Every company, address and NPWP here is made up.
 * Used by the seed, the tests, and `npm run samples` (which writes them to
 * mock/invoices/ so they can be uploaded by hand).
 */

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

interface TextOpts {
  size?: number;
  bold?: boolean;
  right?: boolean;
  color?: [number, number, number];
}

function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts = {}) {
  const font = o.bold ? ctx.bold : ctx.font;
  const size = o.size ?? 9;
  const left = o.right ? x - font.widthOfTextAtSize(s, size) : x;
  ctx.page.drawText(s, { x: left, y, size, font, color: rgb(...(o.color ?? [0.1, 0.1, 0.12])) });
}

interface Column {
  title: string;
  width: number;
  right?: boolean;
}

/** Draws a table with a shaded header; returns the y just below it. */
function table(ctx: Ctx, x: number, y: number, columns: Column[], rows: string[][], rowHeight = 18): number {
  const width = columns.reduce((s, c) => s + c.width, 0);
  ctx.page.drawRectangle({ x, y: y - 6, width, height: rowHeight, color: rgb(0.9, 0.92, 0.95) });
  let cx = x;
  for (const c of columns) {
    text(ctx, c.title, cx + 4, y, { bold: true });
    cx += c.width;
  }
  let ry = y - rowHeight;
  for (const row of rows) {
    cx = x;
    row.forEach((cell, i) => {
      const c = columns[i];
      if (cell) text(ctx, cell, c.right ? cx + c.width - 4 : cx + (i > 0 && !columns[i - 1].right ? 4 : 10), ry, { right: c.right });
      cx += c.width;
    });
    ry -= rowHeight;
  }
  ctx.page.drawLine({ start: { x, y: ry + rowHeight - 6 }, end: { x: x + width, y: ry + rowHeight - 6 }, thickness: 0.6, color: rgb(0.6, 0.6, 0.65) });
  return ry;
}

async function newDoc(): Promise<{ doc: PDFDocument; ctx: Ctx }> {
  const doc = await PDFDocument.create();
  doc.setCreator('ERP demo data');
  doc.setProducer('ERP demo data');
  const page = doc.addPage([595.28, 841.89]); // A4
  const ctx = { page, font: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, ctx };
}

const rp = (n: number, decimals = false) => `Rp ${new Intl.NumberFormat('id-ID').format(n)}${decimals ? ',00' : ''}`;
const num = (n: number) => new Intl.NumberFormat('id-ID').format(n);

// ------------------------------------------------------------------ 1. Indonesian, two-column header, PPN 11%

async function sumberPangan(): Promise<Uint8Array> {
  const { doc, ctx } = await newDoc();
  text(ctx, 'PT Sumber Pangan Lestari', 50, 790, { size: 16, bold: true });
  text(ctx, 'FAKTUR PENJUALAN', 545, 792, { size: 13, bold: true, right: true, color: [0.15, 0.3, 0.55] });
  text(ctx, 'Jl. Raya Narogong KM 12 No. 8, Bekasi 17117', 50, 772);
  text(ctx, 'Telp. (021) 8250 4411', 50, 760);
  text(ctx, 'NPWP: 01.234.567.8-412.000', 50, 748);

  text(ctx, 'No. Faktur', 50, 718, { bold: true });
  text(ctx, ': INV/SPL/2026/11/0042', 125, 718);
  text(ctx, 'Tanggal', 50, 704, { bold: true });
  text(ctx, ': 2 November 2026', 125, 704);
  text(ctx, 'Jatuh Tempo', 50, 690, { bold: true });
  text(ctx, ': 16 November 2026', 125, 690);

  text(ctx, 'Kepada:', 340, 718, { bold: true });
  text(ctx, 'Toko Maju Jaya', 340, 704);
  text(ctx, 'Jl. Pasar Baru No. 17, Bekasi', 340, 690);
  text(ctx, 'NPWP: 09.876.543.2-432.000', 340, 676);

  const items: [string, string, number, string, number][] = [
    ['BRS-PRM-5', 'Beras Premium Pandan Wangi 5 kg', 20, 'pcs', 68000],
    ['MYK-GRG-2L', 'Minyak Goreng Sawit 2 liter', 24, 'pcs', 33500],
    ['GLA-PSR-1', 'Gula Pasir Putih 1 kg', 30, 'pcs', 15200],
    ['TPG-TRG-1', 'Tepung Terigu Segitiga Biru 1 kg', 20, 'pcs', 11000],
  ];
  const y = table(
    ctx,
    50,
    640,
    [
      { title: 'No', width: 25 },
      { title: 'Kode', width: 70 },
      { title: 'Nama Barang', width: 170 },
      { title: 'Qty', width: 40, right: true },
      { title: 'Satuan', width: 45 },
      { title: 'Harga Satuan', width: 70, right: true },
      { title: 'Jumlah', width: 75, right: true },
    ],
    items.map(([code, name, qty, unit, price], i) => [String(i + 1), code, name, String(qty), unit, num(price), num(qty * price)]),
  );
  const subtotal = items.reduce((s, [, , q, , p]) => s + q * p, 0); // 2.840.000
  const ppn = Math.round(subtotal * 0.11);
  text(ctx, 'Subtotal', 380, y - 4);
  text(ctx, rp(subtotal), 541, y - 4, { right: true });
  text(ctx, 'PPN 11%', 380, y - 20);
  text(ctx, rp(ppn), 541, y - 20, { right: true });
  text(ctx, 'Total', 380, y - 38, { bold: true, size: 11 });
  text(ctx, rp(subtotal + ppn), 541, y - 38, { bold: true, size: 11, right: true });
  text(ctx, 'Terbilang: tiga juta seratus lima puluh dua ribu empat ratus rupiah', 50, y - 70, { size: 8 });
  text(ctx, 'Pembayaran ditransfer ke rekening Bank Contoh 123-456-7890 a.n. PT Sumber Pangan Lestari', 50, y - 84, { size: 8 });
  return doc.save();
}

// ------------------------------------------------------------------ 2. English, stacked bill-to, discount, "Rp …,00", wrapped line

async function berkahNiaga(): Promise<Uint8Array> {
  const { doc, ctx } = await newDoc();
  text(ctx, 'INVOICE', 50, 790, { size: 22, bold: true, color: [0.55, 0.2, 0.15] });
  text(ctx, 'CV Berkah Niaga Grosir', 50, 762, { size: 13, bold: true });
  text(ctx, 'Jl. Kapten Tendean No. 45, Jakarta Selatan 12790', 50, 748);
  text(ctx, 'NPWP: 0023 4567 8901 5000', 50, 736);
  text(ctx, 'Invoice No: CBN-2611-0087', 360, 762);
  text(ctx, 'Invoice Date: 03/11/2026', 360, 748);
  text(ctx, 'Due Date: 17/11/2026', 360, 736);

  text(ctx, 'Bill To:', 50, 706, { bold: true });
  text(ctx, 'Toko Maju Jaya', 50, 692);
  text(ctx, 'Jl. Pasar Baru No. 17, Bekasi', 50, 680);

  const columns: Column[] = [
    { title: 'Description', width: 225 },
    { title: 'Qty', width: 60 },
    { title: 'Unit Price', width: 100, right: true },
    { title: 'Amount', width: 110, right: true },
  ];
  const rows = [
    ['Mi Instan Goreng Spesial (dus isi 40)', '10 dus', rp(104000, true), rp(1040000, true)],
    ['Kecap Manis 520 ml', '24', rp(21500, true), rp(516000, true)],
    ['Teh Celup Melati isi 25', '36', rp(6200, true), rp(223200, true)],
    ['Kopi Bubuk Tubruk 200 g', '12', rp(17000, true), rp(204000, true)],
    ['kemasan sachet', '', '', ''],
    ['Biskuit Kelapa Renyah 250 g', '20', rp(9500, true), rp(190000, true)],
  ];
  const y = table(ctx, 50, 640, columns, rows);
  text(ctx, 'Subtotal', 360, y - 4);
  text(ctx, rp(2173200, true), 541, y - 4, { right: true });
  text(ctx, 'Discount (promo)', 360, y - 20);
  text(ctx, `-${rp(73200, true)}`, 541, y - 20, { right: true });
  text(ctx, 'DPP', 360, y - 36);
  text(ctx, rp(2100000, true), 541, y - 36, { right: true });
  text(ctx, 'PPN 11%', 360, y - 52);
  text(ctx, rp(231000, true), 541, y - 52, { right: true });
  text(ctx, 'Grand Total', 360, y - 72, { bold: true, size: 11 });
  text(ctx, rp(2331000, true), 541, y - 72, { bold: true, size: 11, right: true });
  text(ctx, 'Thank you for your business. Payment within 14 days.', 50, y - 110, { size: 8 });
  return doc.save();
}

// ------------------------------------------------------------------ 3. Market stall: no PPN, no subtotal, kg decimals, "30 hari"

async function makmurSejahtera(): Promise<Uint8Array> {
  const { doc, ctx } = await newDoc();
  text(ctx, 'UD MAKMUR SEJAHTERA', 50, 790, { size: 15, bold: true });
  text(ctx, 'Pasar Induk Kramat Jati Blok C-12, Jakarta Timur', 50, 775);
  text(ctx, 'HP 0812-8899-4411', 50, 763);
  text(ctx, 'Nota/Faktur No. 0142/UD-MS/XI/2026', 50, 735, { bold: true });
  text(ctx, 'Tgl: 02-11-2026', 380, 735);
  text(ctx, 'Kepada Yth.: Toko Maju Jaya', 50, 720);
  text(ctx, 'Jatuh Tempo: 30 hari', 380, 720);

  const items: [string, string, number, number][] = [
    ['Bawang Merah', '12,5 kg', 12500, 31000],
    ['Bawang Putih', '10 kg', 10000, 33000],
    ['Cabai Rawit Merah', '4,5 kg', 4500, 52000],
    ['Telur Ayam Ras', '15 kg', 15000, 26500],
  ];
  const y = table(
    ctx,
    50,
    685,
    [
      { title: 'No', width: 30 },
      { title: 'Keterangan', width: 215 },
      { title: 'Banyak', width: 70 },
      { title: 'Harga', width: 85, right: true },
      { title: 'Jumlah', width: 95, right: true },
    ],
    items.map(([name, qty, milli, price], i) => [String(i + 1), name, qty, num(price), num((milli * price) / 1000)]),
  );
  const total = items.reduce((s, [, , m, p]) => s + (m * p) / 1000, 0); // 1.349.000
  text(ctx, 'Total', 380, y - 6, { bold: true, size: 11 });
  text(ctx, rp(total), 541, y - 6, { bold: true, size: 11, right: true });
  text(ctx, 'Barang yang sudah dibeli tidak dapat dikembalikan.', 50, y - 40, { size: 8 });
  return doc.save();
}

export interface SampleInvoice {
  file: string;
  build: () => Promise<Uint8Array>;
}

export const SAMPLE_INVOICES: SampleInvoice[] = [
  { file: 'sumber-pangan-lestari-INV-SPL-2026-11-0042.pdf', build: sumberPangan },
  { file: 'berkah-niaga-grosir-CBN-2611-0087.pdf', build: berkahNiaga },
  { file: 'makmur-sejahtera-0142.pdf', build: makmurSejahtera },
];

/** A page with a drawing and no text at all, standing in for a scanned invoice. */
export async function scannedLookalike(): Promise<Uint8Array> {
  const { doc, ctx } = await newDoc();
  ctx.page.drawRectangle({ x: 60, y: 500, width: 470, height: 280, borderColor: rgb(0.3, 0.3, 0.3), borderWidth: 2 });
  return doc.save();
}
