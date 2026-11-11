-- A stock adjustment is a posted document: header plus lines, each line also a row in
-- stock_moves (source_type 'stock_adjustment', source_id = stock_adjustments.id).
-- Never edited; a mistake is corrected by a further adjustment.
CREATE TABLE stock_adjustments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  reason TEXT NOT NULL CHECK (reason IN ('damaged', 'lost', 'expired', 'correction')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE stock_adjustment_lines (
  id INTEGER PRIMARY KEY,
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli != 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (adjustment_id, product_id)
);
CREATE INDEX idx_stock_adjustments_created ON stock_adjustments (id DESC);
