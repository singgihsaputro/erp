import type { Db } from './db.js';
import { ingestInvoicePdf } from './invoices/routes.js';
import { SAMPLE_INVOICES } from './invoices/samples.js';

type Row = [sku: string, barcode: string | null, name: string, unit: string, cost: number, price: number];

const products: Row[] = [
  ['BRS-PRM-5', '8990000000011', 'Beras Premium Pandan Wangi 5 kg', 'pcs', 68000, 76000],
  ['BRS-CUR', '8990000000028', 'Beras Curah Medium (per kg)', 'kg', 11500, 13500],
  ['MYK-GRG-2L', '8990000000035', 'Minyak Goreng Sawit 2 liter', 'pcs', 33500, 37500],
  ['GLA-PSR-1', '8990000000042', 'Gula Pasir Putih 1 kg', 'pcs', 15200, 17500],
  ['TPG-TRG-1', '8990000000059', 'Tepung Terigu Segitiga Biru 1 kg', 'pcs', 11000, 13000],
  ['KPI-BBK-200', '8990000000066', 'Kopi Bubuk Tubruk Nusantara 200 g', 'pcs', 17000, 21000],
  ['TEH-CEL-25', '8990000000073', 'Teh Celup Melati isi 25', 'pack', 6200, 8000],
  ['MIE-GRG-85', '8990000000080', 'Mi Instan Goreng Spesial 85 g', 'pcs', 2700, 3500],
  ['MIE-KRT-DUS', null, 'Mi Instan Goreng Spesial (dus isi 40)', 'box', 104000, 122000],
  ['SRI-KTL-ML', '8990000000097', 'Kecap Manis 520 ml', 'pcs', 21500, 25500],
  ['GRM-DPR-250', '8990000000103', 'Garam Dapur Beryodium 250 g', 'pcs', 2400, 3500],
  ['SBN-MND-90', '8990000000110', 'Sabun Mandi Batang Lavender 90 g', 'pcs', 3300, 4500],
  ['SMP-SCH-10', '8990000000127', 'Sampo Sachet Anti Ketombe (renceng 12)', 'pack', 11800, 15000],
  ['DTR-BBK-800', '8990000000134', 'Deterjen Bubuk Cuci Bersih 800 g', 'pcs', 17500, 21500],
  ['AQA-600', '8990000000141', 'Air Mineral Botol 600 ml', 'pcs', 2100, 3000],
  ['AQA-GLN', '8990000000158', 'Air Mineral Galon Isi Ulang 19 liter', 'pcs', 14000, 19000],
  ['TLR-AYM', null, 'Telur Ayam Ras (per kg)', 'kg', 26500, 30000],
  ['BWG-MRH', null, 'Bawang Merah (per kg)', 'kg', 31000, 38000],
  ['BWG-PTH', null, 'Bawang Putih (per kg)', 'kg', 33000, 40000],
  ['CBE-RWT', null, 'Cabai Rawit Merah (per kg)', 'kg', 52000, 65000],
  ['BSK-MRI-135', '8990000000165', 'Biskuit Marie Susu 135 g', 'pcs', 6800, 8500],
  ['WFR-CKL-140', '8990000000172', 'Wafer Cokelat 140 g', 'pcs', 8200, 10500],
  ['SSU-UHT-1L', '8990000000189', 'Susu UHT Full Cream 1 liter', 'pcs', 16800, 19500],
  ['ROK-FLT-16', '8990000000196', 'Rokok Filter Kretek 16 batang', 'pack', 27500, 31000],
  ['BTR-AA-4', '8990000000202', 'Baterai AA Alkaline isi 4', 'pack', 24000, 30000],
  ['LMP-LED-9', '8990000000219', 'Lampu LED 9 watt', 'pcs', 17000, 23000],
  ['KBL-ROL-3M', null, 'Kabel Roll Listrik 3 meter', 'pcs', 38000, 49000],
  ['PLP-GRG-HTM', null, 'Plastik Kresek Hitam (per kg, ukuran 40)', 'kg', 24000, 29000],
];

/** Demo data. Idempotent per SKU, so it can also be applied on top of an existing database. */
export function seedDemo(db: Db): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO products (sku, barcode, name, base_unit, cost, price) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    for (const [sku, barcode, name, unit, cost, price] of products) insert.run(sku, barcode, name, unit, cost, price);
    // A discontinued item, so the "archived" filter has something to show.
    insert.run('KRP-UDG-250', '8990000000226', 'Kerupuk Udang Mentah 250 g', 'pcs', 9000, 12000);
    db.prepare(
      "UPDATE products SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE sku = 'KRP-UDG-250' AND archived_at IS NULL",
    ).run();
  })();
}

/**
 * Two supplier invoices in the inbox: one waiting for review, one already
 * confirmed. The third sample (mock/invoices/berkah-niaga-grosir-…) is left
 * out on purpose, so there is a real PDF to try uploading.
 */
export async function seedInvoices(db: Db): Promise<void> {
  const admin = db.prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1").get() as { id: number };
  const [sumber, , makmur] = SAMPLE_INVOICES;
  const confirmedId = await ingestInvoicePdf(db, { fileName: makmur.file, bytes: await makmur.build(), userId: admin.id });
  db.prepare(
    "UPDATE invoice_extractions SET status = 'confirmed', decided_by = ?, decided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
  ).run(admin.id, confirmedId);
  await ingestInvoicePdf(db, { fileName: sumber.file, bytes: await sumber.build(), userId: admin.id });
}
