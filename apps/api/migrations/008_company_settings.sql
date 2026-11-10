-- One row of company settings (id is always 1).
CREATE TABLE company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  npwp TEXT NOT NULL DEFAULT '',
  -- PPN rate in basis points: 1100 = 11%.
  ppn_rate_bp INTEGER NOT NULL DEFAULT 1100 CHECK (ppn_rate_bp BETWEEN 0 AND 10000),
  -- A small PNG/JPEG/WebP as a data URL; empty when there is no logo.
  logo_data_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO company_settings (id, name) VALUES (1, 'Toko Maju Jaya');

-- The prefix each kind of document is numbered with: PREFIX/YYYY/MM/NNNN.
CREATE TABLE document_prefixes (
  id INTEGER PRIMARY KEY,
  doc_type TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO document_prefixes (doc_type, prefix) VALUES
  ('quotation', 'QT'), ('sales_order', 'SO'), ('delivery', 'SJ'), ('sales_invoice', 'INV'),
  ('sales_return', 'SR'), ('purchase_order', 'PO'), ('goods_receipt', 'GR'),
  ('supplier_invoice', 'BILL'), ('purchase_return', 'PR'), ('payment', 'PAY'),
  ('stock_adjustment', 'ADJ'), ('stock_transfer', 'TRF'), ('stock_opname', 'OPN'),
  ('pos_sale', 'POS'), ('journal', 'JV');

-- Last number issued per prefix per month (period is YYYY-MM, Asia/Jakarta).
CREATE TABLE document_sequences (
  id INTEGER PRIMARY KEY,
  prefix TEXT NOT NULL,
  period TEXT NOT NULL,
  last_no INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (prefix, period)
);
