-- A stock opname (physical count) of one warehouse. Creating it snapshots what the books say
-- is on hand (system_qty_milli) per product; people then enter what they counted. While a
-- count is a draft the counted quantities can change. Posting turns every variance into one
-- stock adjustment (reason 'correction', see stock_adjustments) and freezes the count.
CREATE TABLE stock_counts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users (id),
  posted_by INTEGER REFERENCES users (id),
  posted_at TEXT,
  cancelled_at TEXT,
  adjustment_id INTEGER REFERENCES stock_adjustments (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE stock_count_lines (
  id INTEGER PRIMARY KEY,
  count_id INTEGER NOT NULL REFERENCES stock_counts (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  system_qty_milli INTEGER NOT NULL,
  counted_qty_milli INTEGER CHECK (counted_qty_milli IS NULL OR counted_qty_milli >= 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (count_id, product_id)
);
CREATE INDEX idx_stock_counts_status ON stock_counts (status, id DESC);
