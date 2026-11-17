-- A purchase order asks a supplier for goods. It is a draft until submitted, then waits for
-- approval; an approved order is frozen (goods receipt, F017, receives against it). Prices are
-- tax-exclusive; the PPN rate in force when the order is created is kept on the order.
CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'cancelled')),
  order_date TEXT NOT NULL,
  expected_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL DEFAULT 1100,
  created_by INTEGER NOT NULL REFERENCES users (id),
  submitted_at TEXT,
  approved_by INTEGER REFERENCES users (id),
  approved_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES purchase_orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_cost INTEGER NOT NULL CHECK (unit_cost >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, product_id)
);
CREATE INDEX idx_purchase_orders_status ON purchase_orders (status, id DESC);
