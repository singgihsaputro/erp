-- A quotation offers goods to a customer at a price; accepting it converts it to a sales order.
-- An open sales order reserves stock in its warehouse: the reserved quantity is the sum of its lines,
-- and what can still be promised is on hand minus reserved. Cancelling the order releases it.
-- (Deliveries, F022, will reduce the reservation as goods leave.) Prices are tax-exclusive and the
-- PPN rate in force when the document is created is kept on it.
CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  quotation_id INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cancelled')),
  order_date TEXT NOT NULL,
  delivery_date TEXT,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL DEFAULT 1100,
  created_by INTEGER NOT NULL REFERENCES users (id),
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE sales_order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES sales_orders (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (order_id, product_id)
);
CREATE TABLE quotations (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses (id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'converted', 'rejected', 'cancelled')),
  quote_date TEXT NOT NULL,
  valid_until TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL DEFAULT 1100,
  sales_order_id INTEGER REFERENCES sales_orders (id),
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE quotation_lines (
  id INTEGER PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES quotations (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (quotation_id, product_id)
);
CREATE INDEX idx_sales_orders_status ON sales_orders (status, id DESC);
CREATE INDEX idx_quotations_status ON quotations (status, id DESC);
CREATE INDEX idx_sales_order_lines_product ON sales_order_lines (product_id);
