-- A sales invoice (Faktur) bills goods that were delivered on a Surat Jalan. It is posted when
-- created and immutable; prices and the PPN rate come from the sales order. What can still be
-- invoiced per order line is delivered minus already invoiced. Customer payments (F024) and
-- credit notes (F025) will settle or correct it.
CREATE TABLE sales_invoices (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  order_id INTEGER NOT NULL REFERENCES sales_orders (id),
  customer_id INTEGER NOT NULL REFERENCES customers (id),
  invoice_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  payment_terms TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  ppn_rate_bp INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE sales_invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES sales_invoices (id),
  product_id INTEGER NOT NULL REFERENCES products (id),
  qty_milli INTEGER NOT NULL CHECK (qty_milli > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (invoice_id, product_id)
);
CREATE INDEX idx_sales_invoices_order ON sales_invoices (order_id);
CREATE INDEX idx_sales_invoices_customer ON sales_invoices (customer_id);
