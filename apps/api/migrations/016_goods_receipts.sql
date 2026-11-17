-- A goods receipt books what a supplier actually delivered against an approved purchase order,
-- partially or in full. It is posted the moment it is saved: each line is an inbound ledger move
-- (source_type 'goods_receipt') at the order's price, which re-averages the product cost.
-- Posted receipts are never edited or deleted.
CREATE TABLE goods_receipts (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES purchase_orders (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  receipt_date TEXT NOT NULL,
  supplier_ref TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  received_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE goods_receipt_lines (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (receipt_id, product_id)
);
CREATE INDEX idx_goods_receipts_order ON goods_receipts (order_id);
