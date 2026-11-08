import { hashPassword } from './auth.js';
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
    seedSuppliers(db);
    seedCustomers(db);
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
