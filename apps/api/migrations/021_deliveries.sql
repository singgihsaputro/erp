-- A delivery (Surat Jalan) sends goods against an open sales order, partially or in full, and posts
-- the stock out of the order's warehouse. Delivered quantities reduce the order's reservation.
-- Deliveries are immutable once posted.
CREATE TABLE deliveries (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES sales_orders (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  delivery_date TEXT NOT NULL,
  driver TEXT NOT NULL DEFAULT '',
  vehicle TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  delivered_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE delivery_lines (
  id INTEGER PRIMARY KEY,
  delivery_id INTEGER NOT NULL REFERENCES deliveries (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (delivery_id, product_id)
);
CREATE INDEX idx_deliveries_order ON deliveries (order_id);
CREATE INDEX idx_delivery_lines_product ON delivery_lines (product_id);
