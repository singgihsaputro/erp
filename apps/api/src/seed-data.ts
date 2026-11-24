import { hashPassword } from './auth.js';
import { postStockMove } from './stock.js';
import { postAdjustment } from './adjustments.js';
import { enterCounts, postCount, startCount } from './counts.js';
import { jakartaToday } from './batches.js';
import { receiveTransfer, sendTransfer } from './transfers.js';
import { receiveGoods } from './goods-receipts.js';
import { createSupplierInvoice } from './supplier-invoices.js';
import { paySupplier } from './supplier-payments.js';
import { returnGoods } from './purchase-returns.js';
import { createDelivery } from './deliveries.js';
import { createSalesInvoice } from './sales-invoices.js';
import { convertQuotation, createQuotation, createSalesOrder, transitionQuotation } from './sales-orders.js';
import { createPurchaseOrder, transitionPurchaseOrder } from './purchase-orders.js';
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
    seedCatalog(db);
    seedWarehouses(db);
    seedAdjustments(db);
    seedTransfers(db);
    seedCounts(db);
    seedReorderPoints(db);
    seedBatches(db);
    seedSuppliers(db);
    seedCustomers(db);
    seedCompany(db);
    seedPurchaseOrders(db);
    seedSales(db);
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

const CATEGORIES: Record<string, string[]> = {
  'Beras & Tepung': ['BRS-PRM-5', 'BRS-CUR', 'TPG-TRG-1'],
  'Minyak & Bumbu': ['MYK-GRG-2L', 'GLA-PSR-1', 'SRI-KTL-ML', 'GRM-DPR-250', 'BWG-MRH', 'BWG-PTH', 'CBE-RWT'],
  'Makanan & Minuman': ['KPI-BBK-200', 'TEH-CEL-25', 'MIE-GRG-85', 'MIE-KRT-DUS', 'BSK-MRI-135', 'WFR-CKL-140', 'SSU-UHT-1L', 'TLR-AYM', 'KRP-UDG-250'],
  'Air Minum': ['AQA-600', 'AQA-GLN'],
  'Kebutuhan Rumah': ['SBN-MND-90', 'SMP-SCH-10', 'DTR-BBK-800', 'PLP-GRG-HTM'],
  'Elektronik & Rokok': ['ROK-FLT-16', 'BTR-AA-4', 'LMP-LED-9', 'KBL-ROL-3M'],
};

// 1 <unit> = factor / 1000 of the base unit
const CONVERSIONS: [sku: string, unit: string, factorMilli: number][] = [
  ['MIE-GRG-85', 'dus', 40_000],
  ['AQA-600', 'dus', 24_000],
  ['SSU-UHT-1L', 'dus', 12_000],
  ['BRS-CUR', 'karung', 25_000],
  ['GLA-PSR-1', 'karung', 50_000],
  ['SBN-MND-90', 'lusin', 12_000],
  ['TEH-CEL-25', 'box', 12_000],
  ['BSK-MRI-135', 'box', 24_000],
];

function seedCatalog(db: Db): void {
  const cat = db.prepare('INSERT OR IGNORE INTO categories (name) VALUES (?)');
  const assign = db.prepare(
    'UPDATE products SET category_id = (SELECT id FROM categories WHERE name = ?) WHERE sku = ? AND category_id IS NULL',
  );
  for (const [name, skus] of Object.entries(CATEGORIES)) {
    cat.run(name);
    for (const sku of skus) assign.run(name, sku);
  }
  const conv = db.prepare(
    'INSERT OR IGNORE INTO product_units (product_id, unit, factor_milli) SELECT id, ?, ? FROM products WHERE sku = ?',
  );
  for (const [sku, unit, factor] of CONVERSIONS) conv.run(unit, factor, sku);
}

const WAREHOUSES: [code: string, name: string, address: string][] = [
  ['GDG-BEL', 'Gudang Belakang', 'Jl. Raya Pasar Minggu No. 18, Jakarta Selatan'],
  ['GDG-CKR', 'Gudang Cikarang', 'Kawasan Industri Jababeka Blok C-7, Cikarang'],
];

// Opening balances, as ledger rows: sku, warehouse code, quantity in base units.
const OPENING: [sku: string, wh: string, qty: number][] = [
  ['BRS-PRM-5', 'TOKO', 24], ['MYK-GRG-2L', 'TOKO', 36], ['GLA-PSR-1', 'TOKO', 48],
  ['MIE-GRG-85', 'TOKO', 200], ['AQA-600', 'TOKO', 120], ['SBN-MND-90', 'TOKO', 60],
  ['BRS-PRM-5', 'GDG-BEL', 120], ['MYK-GRG-2L', 'GDG-BEL', 240], ['GLA-PSR-1', 'GDG-BEL', 300],
  ['TPG-TRG-1', 'GDG-BEL', 180], ['MIE-GRG-85', 'GDG-BEL', 1200], ['AQA-600', 'GDG-BEL', 960],
  ['SSU-UHT-1L', 'GDG-CKR', 480], ['DTR-BBK-800', 'GDG-CKR', 150], ['BSK-MRI-135', 'GDG-CKR', 360],
];

function seedWarehouses(db: Db): void {
  const add = db.prepare('INSERT OR IGNORE INTO warehouses (code, name, address) VALUES (?, ?, ?)');
  for (const [code, name, address] of WAREHOUSES) add.run(code, name, address);
  db.prepare("UPDATE warehouses SET name = 'Toko Utama', address = 'Jl. Melati No. 5, Jakarta Timur' WHERE code = 'TOKO' AND address = ''").run();
  const has = db.prepare("SELECT 1 FROM stock_moves WHERE source_type = 'opening' LIMIT 1").get();
  if (has) return;
  const move = db.prepare(
    `INSERT INTO stock_moves (product_id, warehouse_id, qty_milli, unit_cost, source_type, note)
     SELECT p.id, w.id, ?, p.cost, 'opening', 'Opening balance' FROM products p, warehouses w WHERE p.sku = ? AND w.code = ?`,
  );
  for (const [sku, wh, qty] of OPENING) move.run(qty * 1000, sku, wh);
  // A later restock at a higher price, so the movement history shows the moving average at work.
  const id = (sql: string, v: string) => (db.prepare(sql).get(v) as { id: number }).id;
  const restock = (sku: string, wh: string, qty: number, cost: number, note: string) =>
    postStockMove(db, {
      productId: id('SELECT id FROM products WHERE sku = ?', sku),
      warehouseId: id('SELECT id FROM warehouses WHERE code = ?', wh),
      qtyMilli: qty * 1000, unitCost: cost, sourceType: 'goods_receipt', note,
    });
  restock('BRS-PRM-5', 'GDG-BEL', 60, 71000, 'Restock from PT Sumber Pangan Lestari');
  restock('MYK-GRG-2L', 'TOKO', 24, 35000, 'Restock from CV Berkah Niaga Grosir');
}

/** A few posted adjustments, so the list and the ledger show reasons at work. */
function seedAdjustments(db: Db): void {
  if (db.prepare('SELECT 1 FROM stock_adjustments LIMIT 1').get()) return;
  const user = db.prepare("SELECT id FROM users ORDER BY (role = 'warehouse') DESC, id LIMIT 1").get() as { id: number } | undefined;
  if (!user) return;
  const pid = (sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number }).id;
  const wid = (code: string) => (db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code) as { id: number }).id;
  postAdjustment(db, { warehouse_id: wid('GDG-BEL'), reason: 'damaged', note: 'Kardus basah kena bocor atap', lines: [{ product_id: pid('MIE-GRG-85'), qty_milli: -24_000 }, { product_id: pid('AQA-600'), qty_milli: -48_000 }] }, user.id);
  postAdjustment(db, { warehouse_id: wid('GDG-CKR'), reason: 'expired', note: 'Lewat tanggal kedaluwarsa', lines: [{ product_id: pid('SSU-UHT-1L'), qty_milli: -12_000 }] }, user.id);
  postAdjustment(db, { warehouse_id: wid('GDG-BEL'), reason: 'correction', note: 'Selisih hitung rak gula', lines: [{ product_id: pid('GLA-PSR-1'), qty_milli: 5_000 }] }, user.id);
}

/** One transfer already received and one still on the road, so both states show. */
function seedTransfers(db: Db): void {
  if (db.prepare('SELECT 1 FROM stock_transfers LIMIT 1').get()) return;
  const user = db.prepare("SELECT id FROM users ORDER BY (role = 'warehouse') DESC, id LIMIT 1").get() as { id: number } | undefined;
  if (!user) return;
  const pid = (sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number }).id;
  const wid = (code: string) => (db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code) as { id: number }).id;
  const done = sendTransfer(db, { from_warehouse_id: wid('GDG-BEL'), to_warehouse_id: wid('TOKO'), note: 'Isi ulang rak toko', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 10_000 }] }, user.id);
  receiveTransfer(db, done, user.id);
  sendTransfer(db, { from_warehouse_id: wid('GDG-BEL'), to_warehouse_id: wid('GDG-CKR'), note: 'Kirim ke gudang Cikarang, mobil box', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 20_000 }, { product_id: pid('GLA-PSR-1'), qty_milli: 5_000 }] }, user.id);
}

/** Minimums per warehouse; three of them sit above the seeded stock so the "below minimum" view has rows. */
const REORDER_POINTS: [sku: string, wh: string, min: number][] = [
  ['BRS-PRM-5', 'TOKO', 40], ['GLA-PSR-1', 'TOKO', 60], ['MIE-GRG-85', 'TOKO', 150], ['SBN-MND-90', 'TOKO', 40],
  ['BRS-PRM-5', 'GDG-BEL', 100], ['MIE-GRG-85', 'GDG-BEL', 1200], ['AQA-600', 'GDG-BEL', 600],
  ['SSU-UHT-1L', 'GDG-CKR', 400], ['DTR-BBK-800', 'GDG-CKR', 100],
];

function seedReorderPoints(db: Db): void {
  const add = db.prepare(
    `INSERT OR IGNORE INTO reorder_points (product_id, warehouse_id, min_qty_milli)
     SELECT p.id, w.id, ? FROM products p, warehouses w WHERE p.sku = ? AND w.code = ?`,
  );
  for (const [sku, wh, min] of REORDER_POINTS) add.run(min * 1000, sku, wh);
}

/** Batches received on top of the stock above, dated relative to today so the expiry views always have rows. */
const BATCHES: [sku: string, wh: string, batchNo: string, expiresInDays: number, qty: number][] = [
  ['SSU-UHT-1L', 'GDG-CKR', 'UHT-2410A', -5, 60], ['SSU-UHT-1L', 'GDG-CKR', 'UHT-2411B', 12, 120], ['SSU-UHT-1L', 'GDG-CKR', 'UHT-2502C', 150, 240],
  ['BSK-MRI-135', 'GDG-CKR', 'BM-1101', 20, 96], ['TEH-CEL-25', 'TOKO', 'TH-0377', 3, 48], ['TEH-CEL-25', 'TOKO', 'TH-0412', 200, 120],
];

function seedBatches(db: Db): void {
  if (db.prepare('SELECT 1 FROM stock_batches LIMIT 1').get()) return;
  const addDays = (n: number) => new Date(Date.parse(`${jakartaToday()}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  for (const [sku, wh, batchNo, days, qty] of BATCHES) {
    const p = db.prepare('SELECT id, cost FROM products WHERE sku = ?').get(sku) as { id: number; cost: number } | undefined;
    const w = db.prepare('SELECT id FROM warehouses WHERE code = ?').get(wh) as { id: number } | undefined;
    if (!p || !w) continue;
    const id = Number(db.prepare('INSERT INTO stock_batches (product_id, batch_no, expiry_date) VALUES (?, ?, ?)').run(p.id, batchNo, addDays(days)).lastInsertRowid);
    postStockMove(db, { productId: p.id, warehouseId: w.id, qtyMilli: qty * 1000, unitCost: p.cost, sourceType: 'batch_receipt', sourceId: id, note: `Batch ${batchNo}`, batchId: id });
  }
}

const SUPPLIERS: [name: string, contact: string, phone: string, email: string, address: string, npwp: string, terms: string][] = [
  ['PT Sumber Pangan Lestari', 'Bu Retno Wulandari', '021-82504411', 'penjualan@sumberpangan.example', 'Jl. Raya Narogong KM 12 No. 8, Bekasi 17117', '01.234.567.8-412.000', 'net_30'],
  ['UD Makmur Sejahtera', 'Pak Darmawan', '0812-5550-0142', '', 'Pasar Induk Kramat Jati Blok B-21, Jakarta Timur', '', 'cash'],
  ['CV Berkah Niaga Grosir', 'Pak Hendra Gunawan', '021-5550-1187', 'order@berkahniaga.example', 'Jl. Kapten Tendean No. 45, Jakarta Selatan 12790', '0023456789015000', 'net_14'],
  ['PT Indo Segar Distribusi', 'Ibu Siti Aminah', '021-4660-2290', 'sales@indosegar.example', 'Kawasan Industri Pulogadung Blok F-3, Jakarta Timur', '02.345.678.9-001.000', 'net_30'],
];

function seedSuppliers(db: Db): void {
  const add = db.prepare(
    `INSERT INTO suppliers (name, contact_person, phone, email, address, npwp, payment_terms)
     SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE name = ? COLLATE NOCASE)`,
  );
  for (const [name, ...rest] of SUPPLIERS) add.run(name, ...rest, name);
  // A supplier we stopped buying from, so the "archived" filter has something to show.
  add.run('CV Tani Jaya Abadi', 'Pak Slamet', '0813-5550-7731', '', 'Jl. Raya Subang Km 4, Subang', '', 'cash', 'CV Tani Jaya Abadi');
  db.prepare("UPDATE suppliers SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = 'CV Tani Jaya Abadi' AND archived_at IS NULL").run();
}

const CUSTOMERS: [name: string, contact: string, phone: string, email: string, address: string, npwp: string, limit: number, terms: string, tier: string][] = [
  ['Toko Sembako Barokah', 'Bu Aisyah', '0812-5550-3301', '', 'Jl. Pasar Lama No. 17, Tangerang', '', 5_000_000, 'net_14', 'grosir'],
  ['Warung Bu Tini', 'Bu Tini', '0857-5550-2210', '', 'Jl. Melati No. 3, Depok', '', 0, 'cash', 'retail'],
  ['CV Mitra Boga Nusantara', 'Pak Andi Prasetyo', '021-5550-9001', 'pengadaan@mitraboga.example', 'Jl. Gatot Subroto Kav. 21, Jakarta Selatan 12930', '03.456.789.0-021.000', 25_000_000, 'net_30', 'grosir'],
  ['Restoran Padang Sederhana Jaya', 'Uda Rizal', '021-5550-4478', 'rizal@padangjaya.example', 'Jl. Ciledug Raya No. 88, Jakarta Selatan', '04.567.890.1-012.000', 10_000_000, 'net_14', 'grosir'],
  ['Ibu Ratna Dewi', 'Ibu Ratna Dewi', '0813-5550-6612', '', 'Perumahan Griya Asri Blok C-5, Bekasi', '', 0, 'cash', 'member'],
  ['Pak Joko Santoso', 'Pak Joko', '0821-5550-8843', '', 'Jl. Kenanga No. 12, Bogor', '', 0, 'cash', 'member'],
];

function seedCustomers(db: Db): void {
  const add = db.prepare(
    `INSERT INTO customers (name, contact_person, phone, email, address, npwp, credit_limit, payment_terms, price_tier)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM customers WHERE name = ? COLLATE NOCASE)`,
  );
  for (const [name, ...rest] of CUSTOMERS) add.run(name, ...rest, name);
  // A customer who stopped buying, so the "archived" filter has something to show.
  add.run('Kantin SMP Harapan', 'Bu Lilis', '0819-5550-1190', '', 'Jl. Pendidikan No. 2, Cibinong', '', 0, 'cash', 'retail', 'Kantin SMP Harapan');
  db.prepare("UPDATE customers SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE name = 'Kantin SMP Harapan' AND archived_at IS NULL").run();
}

/** Demo staff, all with the password demo-12345. One is disabled, so the status filter has something to show. */
const DEMO_USERS: [username: string, name: string, role: string][] = [
  ['budi.owner', 'Budi Santoso', 'owner'],
  ['sari.admin', 'Sari Wulandari', 'admin'],
  ['dewi.kasir', 'Dewi Lestari', 'cashier'],
  ['agus.gudang', 'Agus Prasetyo', 'warehouse'],
  ['rina.kasir', 'Rina Marlina', 'cashier'],
];

/** Needs the super admin to exist already (createApp makes it), or the bootstrap rule would never fire. */
export function seedUsers(db: Db): void {
  const add = db.prepare('INSERT OR IGNORE INTO users (username, name, role, password_hash) VALUES (?, ?, ?, ?)');
  const hash = hashPassword('demo-12345');
  for (const [username, name, role] of DEMO_USERS) add.run(username, name, role, hash);
  db.prepare(
    "UPDATE users SET disabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE username = 'rina.kasir' AND disabled_at IS NULL",
  ).run();
}

/** Fills in the company profile the migration left with just a name. */
function seedCompany(db: Db): void {
  db.prepare(
    `UPDATE company_settings SET address = 'Jl. Melati No. 5, Jakarta Timur 13430', phone = '021-5550123',
       email = 'halo@majujaya.example', npwp = '02.345.678.9-001.000' WHERE id = 1 AND address = ''`,
  ).run();
}

/** One count already posted with variances, and one still being counted. */
function seedCounts(db: Db): void {
  if (db.prepare('SELECT 1 FROM stock_counts LIMIT 1').get()) return;
  const user = db.prepare("SELECT id FROM users ORDER BY (role = 'warehouse') DESC, id LIMIT 1").get() as { id: number } | undefined;
  if (!user) return;
  const wid = (code: string) => (db.prepare('SELECT id FROM warehouses WHERE code = ?').get(code) as { id: number }).id;
  const sheet = (id: number) => db.prepare('SELECT product_id, system_qty_milli AS s FROM stock_count_lines WHERE count_id = ? ORDER BY id').all(id) as { product_id: number; s: number }[];
  const done = startCount(db, { warehouse_id: wid('GDG-CKR'), note: 'Opname akhir bulan Oktober' }, user.id);
  // The count sheet found one product short by 2 units and one over by 1; the rest matched.
  enterCounts(db, done, sheet(done).map((l, i) => ({ product_id: l.product_id, counted_qty_milli: i === 0 ? Math.max(0, l.s - 2000) : i === 1 ? l.s + 1000 : l.s })));
  postCount(db, done, user.id);
  const open = startCount(db, { warehouse_id: wid('TOKO'), note: 'Opname rak toko minggu ini' }, user.id);
  // Only the first few shelves are counted so far.
  enterCounts(db, open, sheet(open).slice(0, 3).map((l, i) => ({ product_id: l.product_id, counted_qty_milli: i === 1 ? Math.max(0, l.s - 3000) : l.s })));
}

/** Orders in every state: approved, waiting for approval, a draft and a cancelled one. */
function seedPurchaseOrders(db: Db): void {
  if (db.prepare('SELECT 1 FROM purchase_orders LIMIT 1').get()) return;
  const user = db.prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!user) return;
  const pid = (sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number }).id;
  const sid = (name: string) => (db.prepare('SELECT id FROM suppliers WHERE name = ?').get(name) as { id: number }).id;
  const gdg = (db.prepare("SELECT id FROM warehouses WHERE code = 'GDG-BEL'").get() as { id: number }).id;
  const toko = (db.prepare("SELECT id FROM warehouses WHERE code = 'TOKO'").get() as { id: number }).id;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const line = (sku: string, qty: number, cost: number) => ({ product_id: pid(sku), qty_milli: qty * 1000, unit_cost: cost });
  const approved = createPurchaseOrder(db, { supplier_id: sid('PT Sumber Pangan Lestari'), warehouse_id: gdg, order_date: day(-5), expected_date: day(2), note: 'Restok bulanan beras dan minyak', lines: [line('BRS-PRM-5', 100, 66000), line('MYK-GRG-2L', 60, 33000), line('GLA-PSR-1', 120, 15000)] }, user.id);
  transitionPurchaseOrder(db, approved, 'submit', user.id);
  transitionPurchaseOrder(db, approved, 'approve', user.id);
  // The supplier has delivered part of it: the rice and oil are in, the rest of the rice and the sugar are not.
  receiveGoods(db, { order_id: approved, receipt_date: day(-2), supplier_ref: 'SJ-SPL-20871', note: 'Kiriman pertama, sisa beras menyusul', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 60_000 }, { product_id: pid('MYK-GRG-2L'), qty_milli: 60_000 }] }, user.id);
  // A second delivery of sugar, still waiting for the supplier's invoice, and the invoice for the first delivery
  // (the oil is billed above the order price, so the three-way match shows a warning).
  const first = (db.prepare('SELECT id FROM goods_receipts WHERE order_id = ? ORDER BY id LIMIT 1').get(approved) as { id: number }).id;
  receiveGoods(db, { order_id: approved, receipt_date: day(-1), supplier_ref: 'SJ-SPL-20902', note: 'Gula tiba', lines: [{ product_id: pid('GLA-PSR-1'), qty_milli: 80_000 }] }, user.id);
  createSupplierInvoice(db, { receipt_id: first, supplier_invoice_no: 'INV-SPL-2026-11-0042', invoice_date: day(-2), note: 'Faktur kiriman pertama', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 60_000, unit_cost: 66000 }, { product_id: pid('MYK-GRG-2L'), qty_milli: 60_000, unit_cost: 34500 }] }, user.id);
  // Four leaking bottles of oil go back to the supplier: stock falls and the invoice is credited.
  returnGoods(db, { receipt_id: first, return_date: day(-1), reason: 'Kemasan bocor', note: 'Empat dus minyak rusak saat bongkar', lines: [{ product_id: pid('MYK-GRG-2L'), qty_milli: 4000 }] }, user.id);
  // Older purchases from two other suppliers: one invoice 45 days overdue, another partly paid and 12 days overdue,
  // so payable aging has more than one column and a payment to show.
  const oldBuy = (supplier: string, sku: string, qty: number, cost: number, ago: number, ref: string, terms: number) => {
    const po = createPurchaseOrder(db, { supplier_id: sid(supplier), warehouse_id: gdg, order_date: day(-ago - 3), note: '', lines: [line(sku, qty, cost)] }, user.id);
    transitionPurchaseOrder(db, po, 'submit', user.id);
    transitionPurchaseOrder(db, po, 'approve', user.id);
    receiveGoods(db, { order_id: po, receipt_date: day(-ago), supplier_ref: `SJ-${ref}`, note: '', lines: [{ product_id: pid(sku), qty_milli: qty * 1000 }] }, user.id);
    const rcpt = (db.prepare('SELECT id FROM goods_receipts WHERE order_id = ?').get(po) as { id: number }).id;
    return createSupplierInvoice(db, { receipt_id: rcpt, supplier_invoice_no: ref, invoice_date: day(-ago), due_date: day(-ago + terms), note: '', lines: [{ product_id: pid(sku), qty_milli: qty * 1000, unit_cost: cost }] }, user.id);
  };
  oldBuy('PT Indo Segar Distribusi', 'SSU-UHT-1L', 100, 16500, 75, 'ISD-2026-0913', 30);
  const partly = oldBuy('CV Berkah Niaga Grosir', 'BSK-MRI-135', 300, 6700, 40, 'CBN-2611-0071', 28);
  paySupplier(db, { supplier_id: sid('CV Berkah Niaga Grosir'), payment_date: day(-10), method: 'transfer', reference: 'TRF-BCA-88213', note: 'Pembayaran sebagian', allocations: [{ invoice_id: partly, amount: 1_000_000 }] }, user.id);
  const waiting = createPurchaseOrder(db, { supplier_id: sid('CV Berkah Niaga Grosir'), warehouse_id: toko, order_date: day(-1), expected_date: day(5), note: 'Mi instan dan biskuit untuk toko', lines: [line('MIE-KRT-DUS', 30, 104000), line('BSK-MRI-135', 200, 6700)] }, user.id);
  transitionPurchaseOrder(db, waiting, 'submit', user.id);
  createPurchaseOrder(db, { supplier_id: sid('UD Makmur Sejahtera'), warehouse_id: gdg, order_date: day(0), expected_date: day(1), note: 'Sayur dan telur, kirim pagi', lines: [line('BWG-MRH', 40, 30500), line('TLR-AYM', 50, 26000)] }, user.id);
  const cancelled = createPurchaseOrder(db, { supplier_id: sid('PT Indo Segar Distribusi'), warehouse_id: gdg, order_date: day(-9), note: 'Dibatalkan, stok supplier kosong', lines: [line('SSU-UHT-1L', 120, 16500)] }, user.id);
  transitionPurchaseOrder(db, cancelled, 'cancel', user.id);
}

/** Quotations in every state and open sales orders holding stock in the main warehouse. */
function seedSales(db: Db): void {
  if (db.prepare('SELECT 1 FROM quotations LIMIT 1').get()) return;
  const user = db.prepare("SELECT id FROM users WHERE role = 'super_admin' ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!user) return;
  const pid = (sku: string) => (db.prepare('SELECT id FROM products WHERE sku = ?').get(sku) as { id: number }).id;
  const cid = (name: string) => (db.prepare('SELECT id FROM customers WHERE name = ?').get(name) as { id: number }).id;
  const gdg = (db.prepare("SELECT id FROM warehouses WHERE code = 'GDG-BEL'").get() as { id: number }).id;
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const line = (sku: string, qty: number, price: number) => ({ product_id: pid(sku), qty_milli: qty * 1000, unit_price: price });

  // Accepted quotation: became an order that holds 40 sacks of rice, 30 oil and 60 sugar.
  const accepted = createQuotation(db, { customer_id: cid('CV Mitra Boga Nusantara'), warehouse_id: gdg, quote_date: day(-6), valid_until: day(8), note: 'Kebutuhan dapur bulanan', lines: [line('BRS-PRM-5', 40, 78000), line('MYK-GRG-2L', 30, 41000), line('GLA-PSR-1', 60, 17500)] }, user.id);
  transitionQuotation(db, accepted, 'send');
  const acceptedOrder = convertQuotation(db, accepted, user.id);
  // Part of it has already gone out on a Surat Jalan; the rest is still reserved.
  createDelivery(db, { order_id: acceptedOrder, driver: 'Pak Slamet', vehicle: 'B 9087 KCF', note: 'Pengiriman tahap 1', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 25_000 }, { product_id: pid('MYK-GRG-2L'), qty_milli: 30_000 }] }, user.id);
  // Faktur for most of what was delivered; 10 cooking oil is delivered but not yet invoiced.
  createSalesInvoice(db, { order_id: acceptedOrder, note: 'Faktur pengiriman tahap 1', lines: [{ product_id: pid('BRS-PRM-5'), qty_milli: 25_000 }, { product_id: pid('MYK-GRG-2L'), qty_milli: 20_000 }] }, user.id);
  // A direct order for a restaurant, with a delivery date.
  createSalesOrder(db, { customer_id: cid('Restoran Padang Sederhana Jaya'), warehouse_id: gdg, order_date: day(-1), delivery_date: day(2), note: 'Kirim sebelum jam 8 pagi', lines: [line('BRS-PRM-5', 25, 78500), line('MYK-GRG-2L', 40, 41000)] }, user.id);
  // Waiting for the customer's answer, and a fresh draft.
  const sent = createQuotation(db, { customer_id: cid('Toko Sembako Barokah'), warehouse_id: gdg, quote_date: day(-2), valid_until: day(12), note: 'Penawaran mi dan air mineral grosir', lines: [line('MIE-GRG-85', 400, 3100), line('AQA-600', 240, 2900)] }, user.id);
  transitionQuotation(db, sent, 'send');
  createQuotation(db, { customer_id: cid('Warung Bu Tini'), warehouse_id: gdg, note: 'Sabun dan gula', lines: [line('SBN-MND-90', 24, 3500), line('GLA-PSR-1', 20, 17800)] }, user.id);
  // Turned down, and one that ran out of time.
  const rejected = createQuotation(db, { customer_id: cid('Pak Joko Santoso'), warehouse_id: gdg, quote_date: day(-10), valid_until: day(4), lines: [line('MYK-GRG-2L', 12, 42500)] }, user.id);
  transitionQuotation(db, rejected, 'send');
  transitionQuotation(db, rejected, 'reject');
  const lapsed = createQuotation(db, { customer_id: cid('Ibu Ratna Dewi'), warehouse_id: gdg, quote_date: day(-30), valid_until: day(-16), note: 'Tidak dijawab pelanggan', lines: [line('BRS-PRM-5', 4, 80000)] }, user.id);
  transitionQuotation(db, lapsed, 'send');
}
