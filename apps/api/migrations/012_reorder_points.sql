-- A reorder point is the minimum a warehouse should hold of a product. It is a setting, not a
-- document: it can be changed or removed. Stock below it is listed as needing a reorder.
CREATE TABLE reorder_points (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  min_qty_milli INTEGER NOT NULL CHECK (min_qty_milli > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (product_id, warehouse_id)
);
