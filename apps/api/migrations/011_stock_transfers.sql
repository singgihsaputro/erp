-- A stock transfer moves stock between two warehouses in two steps. Sending books an
-- outbound ledger move at the source (source_type 'stock_transfer_out'); the goods are then
-- in transit and in no warehouse. Receiving books the inbound move at the destination
-- ('stock_transfer_in'). A transfer still in transit can be cancelled, which returns the
-- stock to the source ('stock_transfer_cancel'). Never edited or deleted.
CREATE TABLE stock_transfers (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  from_warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  to_warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  status TEXT NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit', 'received', 'cancelled')),
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users (id),
  received_by INTEGER REFERENCES users (id),
  received_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_warehouse_id != to_warehouse_id)
);
CREATE TABLE stock_transfer_lines (
  id INTEGER PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (transfer_id, product_id)
);
CREATE INDEX idx_stock_transfers_status ON stock_transfers (status, id DESC);
