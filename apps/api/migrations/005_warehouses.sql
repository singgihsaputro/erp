CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX idx_warehouses_one_default ON warehouses (is_default) WHERE is_default = 1;

-- The stock ledger: on-hand is the sum of qty_milli. Rows are only ever added.
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli != 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  source_type TEXT NOT NULL,
  source_id INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_stock_moves_wh_product ON stock_moves (warehouse_id, product_id);

INSERT INTO warehouses (code, name, address, is_default) VALUES ('TOKO', 'Toko Utama', '', 1);
